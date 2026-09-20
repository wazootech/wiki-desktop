import { basename, dirname, join, resolve, sep } from "node:path";

import { homeDirectory } from "./config.ts";

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

/** List every editable file in the vault, Markdown first. */
export async function listVaultFiles(root: string): Promise<VaultFile[]> {
  const realRoot = await assertVaultRoot(root);
  const files: VaultFile[] = [];
  await walk(realRoot, realRoot, 0, files);
  return files.sort((left, right) => {
    if (left.isMarkdown !== right.isMarkdown) {
      return left.isMarkdown ? -1 : 1;
    }
    return left.path.localeCompare(right.path, undefined, { numeric: true });
  });
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
    if (entry.isDirectory) {
      if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
      await walk(root, full, depth + 1, out);
      continue;
    }
    if (!entry.isFile) continue;
    out.push({
      path: toVaultPath(root, full),
      name: entry.name,
      isMarkdown: MARKDOWN_EXTENSIONS.some((extension) =>
        entry.name.endsWith(extension)
      ),
    });
  }
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
