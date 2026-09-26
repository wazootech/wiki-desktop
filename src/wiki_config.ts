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
 */
import { join } from "node:path";

import { parse as parseYaml } from "@std/yaml";

/** Where a file sits relative to what the vault calls its pages. */
export type VaultScope = "input" | "asset" | "other";

export interface WikiConfig {
  /** `wiki.input` — the directories that hold the wiki's pages. */
  inputs: string[];
  /** `wiki.assets` — directories holding static files, not pages. */
  assets: string[];
  /** `wiki.exclude` — path globs left out of the listing entirely. */
  excludes: string[];
  /** The config file these came from, or null when none of them parsed. */
  source: string | null;
}

/** What a vault without a usable config looks like: every file, unchanged. */
export const EMPTY_WIKI_CONFIG: WikiConfig = {
  inputs: [],
  assets: [],
  excludes: [],
  source: null,
};

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
 * Only `wiki.input`, `wiki.assets`, and `wiki.exclude` are interpreted; the
 * rest of the file (graph, site, fmt, check) belongs to the `wiki` toolchain.
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
  return {
    inputs: pathList(wiki.input),
    assets: pathList(wiki.assets),
    excludes: pathList(wiki.exclude),
  };
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
