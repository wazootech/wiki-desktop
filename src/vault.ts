import { basename, dirname, join, resolve, sep } from "node:path";

import { homeDirectory } from "./config.ts";
import {
  isExcludedVaultPath,
  readWikiConfig,
  scopeOf,
  type VaultScope,
  type WikiConfig,
} from "./wiki_config.ts";

const MARKDOWN_EXTENSIONS = [".md", ".markdown"];
const IGNORED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".git",
  ".wiki",
  "node_modules",
]);
const VAULT_MARKER_FILES = new Set([
  "wiki.json",
  "wiki.yml",
  "wiki.yaml",
]);
const MAX_WALK_DEPTH = 12;
const MAX_VAULT_FILES = 5000;
/** Above this size the textarea editor stops being a sane way to edit a file. */
const MAX_EDITABLE_BYTES = 2 * 1024 * 1024;

/** An expected failure with a message that is safe to show in the webview. */
export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

export interface VaultFile {
  /** Path relative to the vault root, using forward slashes. */
  path: string;
  name: string;
  isMarkdown: boolean;
  /**
   * What the vault's own config calls this file: a page (`input`), a static
   * file (`asset`), or neither (`other`, which is everything when there is no
   * config to say otherwise).
   */
  scope: VaultScope;
  /**
   * Last modification time in milliseconds since the epoch, or 0 when the
   * filesystem will not say.
   *
   * The walk asks for it rather than the view that needs it. A stat per listed
   * file is the price, and it is paid once per listing, while a view that wanted
   * the times on its own would have to walk the vault a second time and carry a
   * second copy of every rule about what is listed.
   */
  modified: number;
}

/** The line ending a file uses on disk. The editor only ever holds LF. */
export type NewlineStyle = "\n" | "\r\n" | "\r";

export interface VaultFileContents {
  path: string;
  /**
   * The document text, with LF endings — what either editor can hold, and
   * never the bytes on disk. `newline` is what the file uses instead.
   */
  content: string;
  /** Last modification time in milliseconds since the epoch. */
  modified: number;
  /** The ending this file uses on disk, put back when it is saved. */
  newline: NewlineStyle;
}

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface ShortcutEntry {
  label: string;
  path: string;
}

export interface DirectoryListing {
  path: string;
  /** Parent folder, or null when `path` is a filesystem root. */
  parent: string | null;
  /** True when the folder looks like a wiki (a marker file or any Markdown). */
  looksLikeWiki: boolean;
  shortcuts: ShortcutEntry[];
  entries: DirectoryEntry[];
}

/**
 * Normalize a vault-relative path and reject anything that could reach outside
 * the vault. Bindings are a trust boundary, so every incoming path goes through
 * here before it touches the filesystem.
 */
export function normalizeVaultPath(input: string): string {
  if (typeof input !== "string") {
    throw new VaultError("A file path is required.");
  }
  if (input.includes("\0")) {
    throw new VaultError("That file path is not valid.");
  }
  const slashed = input.replace(/\\/g, "/").trim();
  if (slashed.startsWith("/") || /^[a-zA-Z]:/.test(slashed)) {
    throw new VaultError("Use a path relative to the vault root.");
  }
  const segments: string[] = [];
  for (const segment of slashed.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      throw new VaultError('A vault path cannot contain "..".');
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    throw new VaultError("A file path is required.");
  }
  return segments.join("/");
}

/** True when `candidate` is `root` itself or lives under it. */
export function isInsideRoot(root: string, candidate: string): boolean {
  const comparison = Deno.build.os === "windows"
    ? (value: string) => value.toLowerCase()
    : (value: string) => value;
  const normalizedRoot = comparison(stripTrailingSeparator(resolve(root)));
  const normalizedCandidate = comparison(resolve(candidate));
  return normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot + sep);
}

/** Resolve `root` to a real directory, or fail with a user-facing message. */
export async function assertVaultRoot(root: string): Promise<string> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(root);
  } catch {
    throw new VaultError("That folder does not exist.");
  }
  if (!info.isDirectory) {
    throw new VaultError("A vault has to be a folder.");
  }
  return await Deno.realPath(root);
}

/**
 * Turn a vault-relative path into an absolute path inside the vault. Symlinks
 * are resolved so a link cannot be used to escape the vault root.
 */
export async function resolveVaultFile(
  root: string,
  input: string,
  options: { mustExist?: boolean } = {},
): Promise<string> {
  const normalized = normalizeVaultPath(input);
  const realRoot = await assertVaultRoot(root);
  const candidate = join(realRoot, normalized);
  let resolved: string;
  if (options.mustExist === false) {
    const parent = await realPathOrNull(dirname(candidate));
    if (!parent) {
      throw new VaultError("The folder for that file does not exist.");
    }
    resolved = join(parent, basename(candidate));
  } else {
    const real = await realPathOrNull(candidate);
    if (!real) throw new VaultError("That file does not exist.");
    resolved = real;
  }
  if (!isInsideRoot(realRoot, resolved)) {
    throw new VaultError("That path is outside the vault.");
  }
  return resolved;
}

/**
 * List the vault's files, the wiki's own pages first.
 *
 * `wiki.yml` decides the shape of this: files under `wiki.input` are the pages
 * and come first, files under `wiki.assets` are the vault's static files and
 * come last, and anything matching `wiki.exclude` is left out. A vault with no
 * usable config gets every file, Markdown first — exactly the order this
 * returned before the config was read.
 */
export async function listVaultFiles(root: string): Promise<VaultFile[]> {
  const realRoot = await assertVaultRoot(root);
  const config = await readWikiConfig(realRoot);
  const files: VaultFile[] = [];
  await walk(realRoot, realRoot, 0, files, config);
  return files.sort(compareVaultFiles);
}

/**
 * Pages, then everything else, then the vault's static files; Markdown before
 * other files inside each group, then by path with numbers read as numbers.
 */
const SCOPE_ORDER: Record<VaultScope, number> = {
  input: 0,
  other: 1,
  asset: 2,
};

function compareVaultFiles(left: VaultFile, right: VaultFile): number {
  if (left.scope !== right.scope) {
    return SCOPE_ORDER[left.scope] - SCOPE_ORDER[right.scope];
  }
  if (left.isMarkdown !== right.isMarkdown) {
    return left.isMarkdown ? -1 : 1;
  }
  return left.path.localeCompare(right.path, undefined, { numeric: true });
}

/** One day of writes, and what was written on it. */
export interface ActivityDay {
  /**
   * Local midnight of the day, as a timestamp.
   *
   * Midnight local rather than midnight UTC, because "what changed today" is a
   * question about the reader's own wall clock. A UTC bucket puts a write at
   * 23:59 on the wrong day for most of the world, and the two neighbouring days
   * of the panel are then both wrong in the same direction.
   */
  day: number;
  /** The files written that day, newest write first. */
  files: VaultFile[];
}

/**
 * The listing as a history: writes grouped under the day they happened, newest
 * day first and newest file first within each day.
 *
 * This is what the sidebar's history pane draws, and it is the whole of what a
 * wiki reader can know about the past. There is no commit graph here because
 * the app has never read one: a vault is a folder of files, and the only
 * history it keeps is the time each file was last written. Grouping that by
 * day answers the question a reader opens the app with -- what moved, and
 * when -- without a second walk of the vault and without a git dependency the
 * rest of the app does not have.
 *
 * A file the filesystem could not date (`modified` of 0) is left out rather
 * than filed under the epoch: a day it was never written is worse than no day
 * at all.
 */
export function activityByDay(files: readonly VaultFile[]): ActivityDay[] {
  const days = new Map<number, VaultFile[]>();
  for (const file of files) {
    if (!file.modified) continue;
    const day = new Date(file.modified);
    day.setHours(0, 0, 0, 0);
    const bucket = days.get(day.getTime());
    if (bucket === undefined) {
      days.set(day.getTime(), [file]);
    } else {
      bucket.push(file);
    }
  }
  return [...days.entries()]
    .map(([day, dayFiles]) => ({
      day,
      files: dayFiles.sort((left, right) => right.modified - left.modified),
    }))
    .sort((left, right) => right.day - left.day);
}

export async function readVaultFile(
  root: string,
  path: string,
): Promise<VaultFileContents> {
  const file = await resolveVaultFile(root, path);
  const info = await Deno.stat(file);
  if (info.isDirectory) {
    throw new VaultError("That is a folder, not a file.");
  }
  if (info.size > MAX_EDITABLE_BYTES) {
    throw new VaultError("That file is too large to open in the editor.");
  }
  const onDisk = await Deno.readTextFile(file);
  return {
    path: normalizeVaultPath(path),
    content: toEditorText(onDisk),
    modified: info.mtime?.getTime() ?? 0,
    newline: detectNewlineStyle(onDisk),
  };
}

export async function writeVaultFile(
  root: string,
  path: string,
  content: string,
): Promise<VaultFileContents> {
  const file = await resolveVaultFile(root, path, { mustExist: false });
  // The editor hands back LF. The file keeps the convention it already had, so
  // a CRLF page does not come back as a whole-file diff the first time someone
  // fixes a typo in it.
  const newline = await newlineStyleOnDisk(file);
  await Deno.writeTextFile(file, toFileText(content, newline));
  // `content` is echoed, not re-read: it is the document the caller holds, and
  // the page marks its buffer clean against it. The disk bytes differ from it
  // by line endings, which is what `newline` records.
  return await describeFile(root, path, content, newline);
}

export async function createVaultFile(
  root: string,
  path: string,
  content = "",
): Promise<VaultFileContents> {
  const file = await resolveVaultFile(root, path, { mustExist: false });
  await Deno.writeTextFile(file, content, { createNew: true }).catch(
    (error: unknown) => {
      if (error instanceof Deno.errors.AlreadyExists) {
        throw new VaultError("A file with that name already exists.");
      }
      throw error;
    },
  );
  // A file with no history has no convention to preserve, so it takes ours.
  return await describeFile(root, path, content, "\n");
}

/** Browse one folder level for the in-app vault picker. */
export async function browseDirectory(
  path: string,
): Promise<DirectoryListing> {
  const target = await realPathOrNull(path);
  if (!target) {
    throw new VaultError("That folder does not exist.");
  }
  const entries: DirectoryEntry[] = [];
  let looksLikeWiki = false;
  try {
    for await (const entry of Deno.readDir(target)) {
      const name = entry.name;
      if (entry.isDirectory) {
        if (IGNORED_DIRECTORY_NAMES.has(name) || name.startsWith(".")) continue;
        entries.push({ name, path: join(target, name) });
      } else if (
        VAULT_MARKER_FILES.has(name.toLowerCase()) ||
        MARKDOWN_EXTENSIONS.some((extension) => name.endsWith(extension))
      ) {
        looksLikeWiki = true;
      }
    }
  } catch {
    throw new VaultError("That folder cannot be read.");
  }
  entries.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { numeric: true })
  );
  return {
    path: target,
    parent: parentOf(target),
    looksLikeWiki,
    shortcuts: await shortcuts(),
    entries,
  };
}

async function walk(
  root: string,
  directory: string,
  depth: number,
  out: VaultFile[],
  config: WikiConfig,
): Promise<void> {
  if (depth > MAX_WALK_DEPTH || out.length >= MAX_VAULT_FILES) return;
  const entries: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(directory)) {
      entries.push(entry);
    }
  } catch {
    return; // Unreadable folders are skipped rather than failing the listing.
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (out.length >= MAX_VAULT_FILES) return;
    if (entry.name.startsWith(".")) continue;
    const full = join(directory, entry.name);
    // An excluded folder is never entered, so its contents cost nothing and
    // cannot reappear one level down.
    if (isExcludedVaultPath(toVaultPath(root, full), config.excludes)) {
      continue;
    }
    if (entry.isDirectory) {
      if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
      await walk(root, full, depth + 1, out, config);
      continue;
    }
    if (!entry.isFile) continue;
    const path = toVaultPath(root, full);
    out.push({
      path,
      name: entry.name,
      isMarkdown: MARKDOWN_EXTENSIONS.some((extension) =>
        entry.name.endsWith(extension)
      ),
      scope: scopeOf(path, config),
      modified: await modifiedAt(full),
    });
  }
}

/** When a file was last written, or 0 when the filesystem will not say. */
async function modifiedAt(file: string): Promise<number> {
  try {
    return (await Deno.stat(file)).mtime?.getTime() ?? 0;
  } catch {
    return 0;
  }
}

/**
 * How many files a search reports at all, and how many matches of one file it
 * reports.
 *
 * Both are answers about the size of the question, not about the files: a query
 * that matches a word on every page of a large vault has thousands of honest
 * matches, and rendering them all is a freeze rather than an answer. The result
 * says so — a file with more matches than it carries reports `truncated`, so
 * the view can say "more" instead of quietly implying that is all of them.
 */
export const MAX_SEARCH_FILES = 200;
export const MAX_SEARCH_MATCHES = 20;

/** Characters of a matching line kept for the preview under the file's name. */
const SEARCH_PREVIEW_CHARS = 160;

/**
 * Enough of a file to tell text from a picture without reading a whole image
 * into memory. A NUL byte is the same signal every other tool uses, and it
 * appears in the first block of anything binary.
 */
const BINARY_PROBE_CHARS = 8192;

/** One line that matched, and where it is. */
export interface SearchMatch {
  /** 1-based, the way the editor and the status bar both count lines. */
  line: number;
  /** The line trimmed and clipped, for the preview. */
  text: string;
}

/** Every match a search found in one file. */
export interface SearchHit {
  path: string;
  name: string;
  scope: VaultScope;
  matches: SearchMatch[];
  /** True when the file holds more matches than `matches` carries. */
  truncated: boolean;
}

export interface SearchOptions {
  /** Most files to report at all. */
  maxFiles?: number;
  /** Most matches to report per file. */
  maxMatchesPerFile?: number;
}

/**
 * Find every line of every listed file that contains `query`.
 *
 * There is no index and no background process, and that is a decision rather
 * than an omission: the listing is already in the process, the pages are already
 * in memory's reach, and a wiki's worth of prose is small — a few hundred
 * kilobytes — so the whole vault is a scan of the same files the editor reads
 * to open them. What would make this expensive is not the text, and so the
 * bounds are the ones the listing already has: it walks the same tree, under
 * the same ignore rules, and a file too large for the editor to hold is not a
 * file to search either.
 *
 * Matching is a case-insensitive substring, which is what the file list's own
 * filter does. Anything more — words, regular expressions, whole phrases — is a
 * different question with a different answer for every user, and none of it is
 * needed to find a word in a page.
 */
export async function searchVaultFiles(
  root: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchHit[]> {
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (needle === "") return [];
  const realRoot = await assertVaultRoot(root);
  const maxFiles = options.maxFiles ?? MAX_SEARCH_FILES;
  const maxMatches = options.maxMatchesPerFile ?? MAX_SEARCH_MATCHES;
  const hits: SearchHit[] = [];
  for (const file of await listVaultFiles(realRoot)) {
    if (hits.length >= maxFiles) break;
    const text = await readTextForSearch(realRoot, file.path);
    if (text === null) continue;
    const found = matchLines(text, needle, maxMatches);
    if (found.matches.length === 0) continue;
    hits.push({
      path: file.path,
      name: file.name,
      scope: file.scope,
      matches: found.matches,
      truncated: found.truncated,
    });
  }
  return hits;
}

/**
 * The file as text, or null when it is not one to search: a picture, something
 * too big for the editor, something the walk listed and the read cannot reach.
 *
 * Normalised to LF like every other read, so the line numbers a match reports
 * are the line numbers the editor shows.
 */
async function readTextForSearch(
  root: string,
  path: string,
): Promise<string | null> {
  let file: string;
  try {
    file = await resolveVaultFile(root, path);
    if ((await Deno.stat(file)).size > MAX_EDITABLE_BYTES) return null;
  } catch {
    return null;
  }
  let onDisk: string;
  try {
    onDisk = await Deno.readTextFile(file);
  } catch {
    return null;
  }
  if (onDisk.slice(0, BINARY_PROBE_CHARS).includes("\0")) return null;
  return toEditorText(onDisk);
}

function matchLines(
  text: string,
  needle: string,
  limit: number,
): { matches: SearchMatch[]; truncated: boolean } {
  const matches: SearchMatch[] = [];
  let truncated = false;
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].toLowerCase().indexOf(needle) === -1) continue;
    // Counted after the search rather than before it: a file whose matches all
    // fit is not truncated, and one that has exactly `limit + 1` is.
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    matches.push({ line: index + 1, text: previewOf(lines[index]) });
  }
  return { matches, truncated };
}

function previewOf(line: string): string {
  const trimmed = line.trim();
  return trimmed.length <= SEARCH_PREVIEW_CHARS
    ? trimmed
    : `${trimmed.slice(0, SEARCH_PREVIEW_CHARS)}…`;
}

async function describeFile(
  root: string,
  path: string,
  content: string,
  newline: NewlineStyle,
): Promise<VaultFileContents> {
  const normalized = normalizeVaultPath(path);
  const info = await Deno.stat(await resolveVaultFile(root, normalized));
  return {
    path: normalized,
    content,
    modified: info.mtime?.getTime() ?? 0,
    newline,
  };
}

/**
 * The editor's document model holds LF, and only LF: a `<textarea>` normalizes
 * line endings when text is assigned to it, and CodeMirror's document does the
 * same on the way in. Neither can hand back the ending a file arrived with, so
 * the conversion lives here — on the way in, and again on the way out — rather
 * than being an editor's problem to get wrong.
 */
export function toEditorText(text: string): string {
  return text.replace(/\r\n|\r/g, "\n");
}

/** Put a file's own line endings back on the way out. */
export function toFileText(text: string, newline: NewlineStyle): string {
  const lines = toEditorText(text);
  return newline === "\n" ? lines : lines.replace(/\n/g, newline);
}

/**
 * A file's prevailing line ending, so saving only rewrites what changed.
 * Ties go to CRLF: genuinely mixed files are normalized to their richer
 * convention rather than silently downgraded to LF.
 */
export function detectNewlineStyle(text: string): NewlineStyle {
  const counts: Record<NewlineStyle, number> = { "\r\n": 0, "\n": 0, "\r": 0 };
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === "\r") {
      if (text[at + 1] === "\n") {
        counts["\r\n"] += 1;
        at += 1;
      } else {
        counts["\r"] += 1;
      }
    } else if (char === "\n") {
      counts["\n"] += 1;
    }
  }
  // Strictly greater, first one in this order wins a tie: a Windows file with
  // one stray LF line is CRLF, not "mixed, so maybe LF". A file with no line
  // breaks at all is the app's own convention.
  let best: NewlineStyle = "\n";
  let bestCount = 0;
  for (const style of ["\r\n", "\r", "\n"] as NewlineStyle[]) {
    if (counts[style] > bestCount) {
      best = style;
      bestCount = counts[style];
    }
  }
  return best;
}

/** Enough of a file to see how it breaks lines, without reading all of it. */
const NEWLINE_SAMPLE_BYTES = 64 * 1024;

async function newlineStyleOnDisk(file: string): Promise<NewlineStyle> {
  let handle: Deno.FsFile | undefined;
  try {
    handle = await Deno.open(file, { read: true });
    const sample = new Uint8Array(NEWLINE_SAMPLE_BYTES);
    const read = await handle.read(sample);
    const seen = sample.subarray(0, read ?? 0);
    return detectNewlineStyle(new TextDecoder().decode(seen));
  } catch {
    // A file that is not there yet has no convention, so it takes the app's.
    return "\n";
  } finally {
    handle?.close();
  }
}

/** Candidate starting points for the vault picker, existing folders only. */
async function shortcuts(): Promise<ShortcutEntry[]> {
  const home = homeDirectory();
  const candidates: ShortcutEntry[] = [
    { label: "Home", path: home },
    { label: "Documents", path: join(home, "Documents") },
    { label: "Desktop", path: join(home, "Desktop") },
    { label: "Working directory", path: Deno.cwd() },
  ];
  const seen = new Set<string>();
  const found: ShortcutEntry[] = [];
  for (const candidate of candidates) {
    const real = await realPathOrNull(candidate.path);
    if (!real || seen.has(real)) continue;
    seen.add(real);
    found.push({ label: candidate.label, path: real });
  }
  return found;
}

function parentOf(path: string): string | null {
  const parent = dirname(path);
  return parent === path ? null : parent;
}

function toVaultPath(root: string, path: string): string {
  return path.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
}

function stripTrailingSeparator(path: string): string {
  return path.length > 1 ? path.replace(/[\\/]+$/, "") : path;
}

async function realPathOrNull(path: string): Promise<string | null> {
  try {
    return await Deno.realPath(path);
  } catch {
    return null;
  }
}
