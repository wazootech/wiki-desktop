import { join } from "node:path";

import {
  isExcludedVaultPath,
  parseWikiConfig,
  readWikiConfig,
  scopeOf,
  type WikiConfig,
} from "./wiki_config.ts";

/** Dependency-free assertions, so the tests run without fetching anything. */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

/**
 * The shape the toolchain's own vault uses, including the parts this module
 * ignores: other top-level sections, a commented-out `exclude`, and inline
 * lists. A parser that only survives a minimal fixture is not much of a parser.
 */
const VAULT_CONFIG = `
# Wiki paths, assets, and filename policy (wiki check / wiki lint).
wiki:
  # Markdown and data directories to index (relative to this file).
  input:
    - wiki
  # Static files for custom CSS, logos, favicons (copied on wiki build).
  assets:
    - assets
  # Glob patterns skipped when indexing (POSIX paths relative to config root).
  # exclude:
  #   - assets/private/**
  filename_pattern: "[A-Za-z0-9_()-]+\\\\.md"

graph:
  content_predicate: schema:articleBody
  context:
    "@vocab": https://schema.org/
`;

Deno.test("wiki.yml says which files are pages and which are static", () => {
  const config = parseWikiConfig(VAULT_CONFIG, "yaml");
  assert(config !== null, "the vault's config parses");
  assertEqual(config.inputs.join(","), "wiki", "input directories");
  assertEqual(config.assets.join(","), "assets", "asset directories");
  assertEqual(
    config.excludes.length,
    0,
    "a commented-out exclude is no exclude",
  );
});

Deno.test("the JSON form of the config is read the same way", () => {
  const config = parseWikiConfig(
    JSON.stringify({
      wiki: { input: ["wiki"], assets: ["assets"], exclude: ["drafts/**"] },
    }),
    "json",
  );
  assert(config !== null, "the JSON config parses");
  assertEqual(config.inputs.join(","), "wiki", "input directories");
  assertEqual(config.excludes.join(","), "drafts/**", "exclude globs");
});

Deno.test("scope follows the config, and everything else is other", () => {
  const config: WikiConfig = {
    inputs: ["wiki"],
    assets: ["assets"],
    excludes: [],
    source: "wiki.yml",
  };
  assertEqual(scopeOf("wiki/CSS.md", config), "input", "a page");
  assertEqual(scopeOf("wiki/deep/nested.md", config), "input", "a nested page");
  assertEqual(scopeOf("assets/style.css", config), "asset", "a static file");
  assertEqual(
    scopeOf("assets/images/a.png", config),
    "asset",
    "a nested asset",
  );
  assertEqual(scopeOf("README.md", config), "other", "neither");
  assertEqual(
    scopeOf("wikipedia.md", config),
    "other",
    "a name that merely starts with the input directory's",
  );
});

Deno.test("an empty config leaves every file alone", () => {
  const empty: WikiConfig = {
    inputs: [],
    assets: [],
    excludes: [],
    source: null,
  };
  assertEqual(scopeOf("wiki/CSS.md", empty), "other", "no config, no pages");
  assertEqual(
    isExcludedVaultPath("wiki/CSS.md", empty.excludes),
    false,
    "nothing is excluded",
  );
});

Deno.test("exclude globs match the paths a vault config would write", () => {
  const inside = (path: string, pattern: string) =>
    isExcludedVaultPath(path, [pattern]);

  assert(inside("assets/private/key.pem", "assets/private/**"), "the subtree");
  assert(inside("assets/private", "assets/private/**"), "the folder itself");
  assert(
    inside("assets/private/deeper/key.pem", "assets/private/**"),
    "a nested file",
  );
  assert(!inside("assets/public/key.pem", "assets/private/**"), "a sibling");
  assert(
    inside("notes/today.md", "notes"),
    "a bare directory carries its files",
  );
  assert(inside("notes", "notes"), "a bare directory matches itself");
  assert(
    !inside("notes-old/today.md", "notes"),
    "a prefix is not a folder name",
  );
  assert(inside("build/out.png", "**/*.png"), "a pattern across segments");
  assert(inside("out.png", "**/*.png"), "zero segments, as `**` should allow");
  assert(!inside("build/out.txt", "**/*.png"), "another extension");
  assert(
    inside("wiki/scratch.tmp", "wiki/*.tmp"),
    "a wildcard inside a segment",
  );
  assert(
    !inside("wiki/deep/scratch.tmp", "wiki/*.tmp"),
    "one segment only, for a single star",
  );
});

Deno.test("a config that cannot be read is an empty one, not an error", () => {
  assertEqual(
    parseWikiConfig("wiki: [unclosed", "yaml"),
    null,
    "malformed YAML is refused",
  );
  assertEqual(
    parseWikiConfig("{ not json", "json"),
    null,
    "malformed JSON is refused",
  );
  const scalar = parseWikiConfig("wiki:\n  input: wiki\n", "yaml");
  assert(scalar !== null, "a scanner-style scalar still parses");
  assertEqual(
    scalar.inputs.join(","),
    "wiki",
    "a lone string is accepted where a list belongs",
  );
  // A document that is not a mapping is not a config document at all, which is
  // also how a file of nothing but comments reads: it is treated as absent, so
  // the next candidate filename gets a turn.
  assertEqual(
    parseWikiConfig("# only comments\n", "yaml"),
    null,
    "a file with no mapping is not a config",
  );
  const noSections = parseWikiConfig("graph:\n  base_iri: x\n", "yaml");
  assert(noSections !== null, "a config with no `wiki:` section is still one");
  assertEqual(noSections.inputs.length, 0, "and it names no directories");
});

Deno.test("a config cannot point the listing outside the vault", () => {
  const config = parseWikiConfig(
    "wiki:\n  input:\n    - ../elsewhere\n    - /etc\n    - intro/../../out\n    - wiki\n",
    "yaml",
  );
  assert(config !== null, "the config parses");
  assertEqual(
    config.inputs.join(","),
    "wiki",
    "only the entry that stays inside survives",
  );
});

Deno.test("readWikiConfig finds the config beside the vault's files", async () => {
  const root = await Deno.makeTempDir({ prefix: "wazoo-wiki-config-" });
  try {
    assertEqual(
      (await readWikiConfig(root)).source,
      null,
      "a vault with no config has none",
    );

    await Deno.writeTextFile(join(root, "wiki.yml"), VAULT_CONFIG);
    const found = await readWikiConfig(root);
    assertEqual(found.source, "wiki.yml", "the YAML config is the one found");
    assertEqual(found.inputs.join(","), "wiki", "and it is the one parsed");

    await Deno.writeTextFile(join(root, "wiki.json"), '{"wiki":{}}');
    assertEqual(
      (await readWikiConfig(root)).source,
      "wiki.yml",
      "wiki.yml outranks wiki.json, as the toolchain looks for it",
    );
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("a vault with a broken config lists its files as it always did", async () => {
  const root = await Deno.makeTempDir({ prefix: "wazoo-wiki-config-" });
  try {
    await Deno.writeTextFile(join(root, "wiki.yml"), "wiki: [unclosed\n");
    assertEqual(
      (await readWikiConfig(root)).source,
      null,
      "an unreadable config is treated as absent",
    );
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
