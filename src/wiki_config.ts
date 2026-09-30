/**
 * The slice of `wiki.yml` the vault listing cares about.
 *
 * The file list used to be a raw walk of the vault folder, which meant a vault
 * that builds its site into `assets/` listed the build output beside its pages.
 * The config already says which part of the tree holds pages, which part holds
 * static files, and what to skip, so the listing reads it instead of guessing.
 *
 * Everything here is tolerant on purpose: a vault with no config file, or with
 * one this module cannot read, lists its files exactly as it did before — which
 * is why a malformed document yields an empty config rather than an error. The
 * config is a description of the vault, not something the app can enforce.
 *
 * `graph.context` is read for the frontmatter form rather than the listing, and
 * it is the one section here that is not about which files are pages. It is the
 * prefix map that makes a page's bare `softwareVersion` and a shape's
 * `sh:path: schema:softwareVersion` the same property, so an app that cannot
 * resolve it has two unrelated lists of strings where one vocabulary should be
 * (wazootech/wiki-desktop#8). It is a description, read as one: a value that is
 * not a string is not a prefix.
 */
import { join } from "node:path";

import { parse as parseYaml } from "@std/yaml";

import { documentIri } from "./shapes.ts";

/** Where a file sits relative to what the vault calls its pages. */
export type VaultScope = "input" | "asset" | "other";

export interface WikiConfig {
  /** `wiki.input` — the directories that hold the wiki's pages. */
  inputs: string[];
  /** `wiki.assets` — directories holding static files, not pages. */
  assets: string[];
  /** `wiki.exclude` — path globs left out of the listing entirely. */
  excludes: string[];
  /**
   * `graph.context` — the CURIE prefix map, verbatim: `schema` to
   * `https://schema.org/`, `sh` to the SHACL namespace, and `@vocab` for the
   * bare keys. Read whole rather than filtered, because the form resolves terms
   * the listing never sees and a prefix dropped here is a property the app
   * cannot match.
   */
  context: Record<string, string>;
  /**
   * `graph.base_iri` — where a document's IRI starts. Null when the config does
   * not declare one, which is not the same as having none: the graph falls back
   * to `graph.context`'s `wiki` prefix, and {@link documentIri} does the same.
   */
  baseIri: string | null;
  /** The config file these came from, or null when none of them parsed. */
  source: string | null;
}

/**
 * Where a vault's pages live when the config does not say.
 *
 * This is `wiki`'s own default, established against `wiki 0.1.23` rather than
 * assumed: a vault whose `wiki.yml` has no `input` key is indexed from `wiki/`,
 * and a page at `wiki/Thing.md` is given the focus node `wiki:Thing` — the
 * input directory is not part of the name.
 *
 * The app defaulted to no input directory at all, which made it name that same
 * page `wiki/wiki/Thing`. A validation result is addressed by its focus node, so
 * the two spellings are two different subjects and a message about one of them
 * says nothing about the other.
 */
export const DEFAULT_INPUT_DIRECTORIES: readonly string[] = ["wiki"];

/**
 * What a vault without a usable config looks like.
 *
 * Its `inputs` is the default rather than none, because that is what `wiki`
 * indexes when it has nothing to go on: a vault with no `wiki.yml` at all is
 * still read from `wiki/`, and still names a page there without the directory
 * in front of it. An app that listed such a page as belonging to nowhere would
 * give it a different name from the one the build does, which is the one a
 * validation message has to match.
 *
 * The config being unreadable is a separate matter and is not a reason to
 * forget the default: the app carries on listing the whole vault, and the
 * folder it calls the page folder is still the one `wiki` would call it that.
 */
export const EMPTY_WIKI_CONFIG: WikiConfig = {
  inputs: [...DEFAULT_INPUT_DIRECTORIES],
  assets: [],
  excludes: [],
  context: {},
  baseIri: null,
  source: null,
};

/**
 * The IRI the graph gives a page, re-exported from `src/shapes.ts`.
 *
 * It lives with the term resolver because the webview needs it as well, and
 * this module reaches for `node:path`; the implementation is the same one the
 * editor and the tests use.
 */
export { documentIri };

/** The filenames `wiki` itself accepts, in the order it looks for them. */
const CONFIG_FILE_NAMES = ["wiki.yml", "wiki.yaml", "wiki.json"];

/** Read the vault's config, or the empty one when it has none we can use. */
export async function readWikiConfig(root: string): Promise<WikiConfig> {
  for (const name of CONFIG_FILE_NAMES) {
    let text: string;
    try {
      text = await Deno.readTextFile(join(root, name));
    } catch {
      continue; // Not there, or not readable: the next candidate gets a turn.
    }
    const format = name.endsWith(".json") ? "json" : "yaml";
    const parsed = parseWikiConfig(text, format);
    if (parsed !== null) return { ...parsed, source: name };
  }
  return EMPTY_WIKI_CONFIG;
}

/**
 * Parse a config document, or null when it is not one we can read.
 *
 * `wiki.input`, `wiki.assets`, `wiki.exclude` and `graph.context` are
 * interpreted; the rest of the file (site, fmt, check, lint) belongs to the
 * `wiki` toolchain.
 */
export function parseWikiConfig(
  text: string,
  format: "json" | "yaml",
): Omit<WikiConfig, "source"> | null {
  let document: unknown;
  try {
    document = format === "json" ? JSON.parse(text) : parseYaml(text);
  } catch {
    return null;
  }
  if (!isRecord(document)) return null;
  const wiki = isRecord(document.wiki) ? document.wiki : {};
  const graph = isRecord(document.graph) ? document.graph : {};
  return {
    inputs: inputDirectories(wiki.input),
    assets: pathList(wiki.assets),
    excludes: pathList(wiki.exclude),
    context: prefixMap(graph.context),
    baseIri: typeof graph.base_iri === "string" && graph.base_iri !== ""
      ? graph.base_iri
      : null,
  };
}

/**
 * The `graph.context` mapping, keeping only the pairs that are a string to a
 * string. `@vocab` is one of them and is not special here: what makes a bare key
 * mean a schema term is that it is in the map, so the form and the graph loader
 * are looking at one object.
 */
function prefixMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const prefixes: Record<string, string> = {};
  for (const [prefix, iri] of Object.entries(value)) {
    if (typeof iri !== "string" || iri === "") continue;
    prefixes[prefix] = iri;
  }
  return prefixes;
}

/**
 * Which part of the vault a path belongs to. `input` wins over `assets` when a
 * config names the same directory twice, since a page that is also an asset is
 * still a page.
 */
export function scopeOf(path: string, config: WikiConfig): VaultScope {
  if (isUnderAny(path, config.inputs)) return "input";
  if (isUnderAny(path, config.assets)) return "asset";
  return "other";
}

/**
 * True when `wiki.exclude` leaves this path out. A pattern is matched against
 * the path and against each of its parent directories, so excluding a folder
 * excludes what is inside it — which is the reading a bare directory name in
 * `exclude:` invites.
 */
export function isExcludedVaultPath(
  path: string,
  excludes: readonly string[],
): boolean {
  if (excludes.length === 0) return false;
  const candidates = ancestorPaths(path);
  for (const exclude of excludes) {
    const glob = normalizeConfigPath(exclude);
    if (glob === "") continue;
    if (candidates.some((candidate) => globToRegExp(glob).test(candidate))) {
      return true;
    }
    // A pattern with no wildcard names one path; everything under it goes too.
    if (!/[*?]/.test(glob) && path.startsWith(`${glob}/`)) return true;
  }
  return false;
}

/**
 * Translate one glob into a matcher, in the dialect the config documents: a
 * POSIX path relative to the config file, `*` inside one segment and a doubled
 * star across segments. A doubled star followed by a separator also matches
 * zero segments, so `a` + doubled star + `/b` matches `a/b` as well as `a/x/b`.
 */
function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let at = 0; at < glob.length; at += 1) {
    const char = glob[at];
    if (char === "*") {
      if (glob[at + 1] !== "*") {
        source += "[^/]*";
        continue;
      }
      at += 1;
      if (glob[at + 1] === "/") {
        // A doubled star in the middle of a pattern spans whole segments.
        at += 1;
        source += ".*";
        continue;
      }
      if (at === glob.length - 1 && source.endsWith("/")) {
        // A trailing `/**` also names the folder itself, so the walk can skip
        // the folder instead of descending into it to reject each file.
        source = `${source.slice(0, -1)}(?:/.*)?`;
        continue;
      }
      source += ".*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${source}$`);
}

/** A config path as the vault-relative, forward-slashed form used everywhere. */
function normalizeConfigPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

/** A string, or a list of them, as vault-relative paths. */
/**
 * `wiki.input`, which is not the same thing when it is missing as when it is
 * empty.
 *
 * The distinction is the CLI's and it is observable: a config with no `input`
 * key is indexed from `wiki/`, while one that writes `input: []` indexes nothing
 * at all. So an absent key takes {@link DEFAULT_INPUT_DIRECTORIES} and a present
 * one is taken as written, empty included — collapsing the two would either
 * invent pages for a vault that asked for none, or lose the default for every
 * vault that never mentioned it.
 *
 * A key present with no value parses as null rather than undefined, and that is
 * a present key: `input:` on its own line means the same as `input: []`, since
 * both say nothing should be indexed.
 */
function inputDirectories(value: unknown): string[] {
  if (value === undefined) return [...DEFAULT_INPUT_DIRECTORIES];
  return pathList(value);
}

function pathList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const paths: string[] = [];
  for (const entry of values) {
    if (typeof entry !== "string") continue;
    const raw = entry.trim().replace(/\\/g, "/");
    // A config that points outside the vault is ignored, never rebased: an
    // absolute path is not silently made relative, and `..` is not followed.
    // The listing only ever walks the one folder it was given.
    if (raw === "" || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) continue;
    const path = normalizeConfigPath(raw);
    if (path === "" || path === ".." || path.startsWith("../")) continue;
    if (path.includes("/../") || path.endsWith("/..")) continue;
    paths.push(path);
  }
  return paths;
}

function isUnderAny(path: string, directories: readonly string[]): boolean {
  return directories.some((directory) =>
    path === directory || path.startsWith(`${directory}/`)
  );
}

function ancestorPaths(path: string): string[] {
  const segments = path.split("/");
  const ancestors: string[] = [];
  for (let take = segments.length; take > 0; take -= 1) {
    ancestors.push(segments.slice(0, take).join("/"));
  }
  return ancestors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
