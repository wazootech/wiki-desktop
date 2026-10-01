/**
 * The vault census, and the one question it turns on: which files are pages.
 *
 * The listing says a file is under `wiki.input` or it does not, and the graph
 * `wiki check` validates is built by walking only those directories. So the
 * census has to ask the listing rather than ask whether a file is Markdown: a
 * vault that keeps transcripts in `raw/` has 27 Markdown files the build never
 * loads, and counting their keys offered a form fields for pages that do not
 * exist.
 */
import { join } from "node:path";

import { readVaultVocabulary } from "./vocabulary.ts";
import { listVaultFiles } from "./vault.ts";

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

async function withTempVault(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "wazoo-wiki-test-" });
  try {
    await run(root);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

const CONFIG = `wiki:
  input:
    - wiki
graph:
  context:
    "@vocab": https://schema.org/
    schema: https://schema.org/
    wiki: https://example.org/p/
    sh: http://www.w3.org/ns/shacl#
    xsd: http://www.w3.org/2001/XMLSchema#
`;

const THING_SHAPE = `---
id: wiki:ThingShape
type: sh:NodeShape
sh:targetClass: schema:Thing
sh:property:
  - sh:path: schema:name
    sh:datatype: xsd:string
    sh:minCount: 1
---
`;

/**
 * A page and a shape under `wiki.input`, and a page outside it.
 *
 * `raw/transcript.md` is the file that found this: it is Markdown, it carries
 * frontmatter, and it is the same class as the page the CLI does load, so the
 * only honest difference between the two is the directory they sit in.
 */
async function writeVault(root: string): Promise<void> {
  await Deno.writeTextFile(join(root, "wiki.yml"), CONFIG);
  await Deno.mkdir(join(root, "wiki"));
  await Deno.mkdir(join(root, "raw"), { recursive: true });
  await Deno.writeTextFile(join(root, "wiki", "Thing_Shape.md"), THING_SHAPE);
  await Deno.writeTextFile(
    join(root, "wiki", "Dune.md"),
    "---\ntype: schema:Thing\nname: Dune\n---\n\n# Dune\n",
  );
  await Deno.writeTextFile(
    join(root, "raw", "transcript.md"),
    "---\ntype: schema:Thing\nname: A transcript\ntranscriptOnly: yes\n---\n",
  );
}

Deno.test("a Markdown file outside wiki.input is not a page", async () => {
  await withTempVault(async (root) => {
    await writeVault(root);

    const files = await listVaultFiles(root);
    assertEqual(
      files.map((file) => `${file.path}:${file.scope}`).join(", "),
      "wiki/Dune.md:input, wiki/Thing_Shape.md:input, raw/transcript.md:other, wiki.yml:other",
      "the listing already draws the line, and the census has to use it",
    );

    const vocabulary = await readVaultVocabulary(root, files);

    assertEqual(
      vocabulary.observedKeys["transcriptOnly"] ?? 0,
      0,
      "a key only a file outside wiki.input carries is not a key this vault uses",
    );
    assert(
      vocabulary.observedKeys["name"] === 1,
      "`name` is on the page inside wiki.input, and only on that page: expected 1, got " +
        vocabulary.observedKeys["name"],
    );
  });
});

Deno.test("a shape outside wiki.input is not a shape either", async () => {
  await withTempVault(async (root) => {
    await writeVault(root);
    // Shapes load from the graph, and the graph walks wiki.input, so a shape
    // the config does not point at constrains nothing — the same rule as the
    // page it would have constrained.
    await Deno.writeTextFile(join(root, "raw", "Other_Shape.md"), THING_SHAPE);

    const vocabulary = await readVaultVocabulary(
      root,
      await listVaultFiles(root),
    );

    assertEqual(
      vocabulary.shapes.length,
      1,
      "only the shape under wiki/input is read; the other is a file",
    );
    assert(
      vocabulary.shapes[0].sourcePath === "wiki/Thing_Shape.md",
      "and it is the one the graph would have found: got " +
        vocabulary.shapes[0].sourcePath,
    );
  });
});
