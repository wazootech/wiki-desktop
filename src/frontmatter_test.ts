/**
 * The frontmatter parser, and the criterion it exists to keep.
 *
 * The load-bearing test here is the one-line diff: edit a field's value, and
 * nothing else in the file may move. That is criterion 1 of the editor decision
 * (wazootech/wiki-desktop#6) applied to the one part of a page this app now
 * rewrites, and a serialiser — any serialiser — fails it on the first page it
 * meets.
 *
 * The vault census at the end is opt-in, for the same reason
 * `src/fidelity_test.ts` is: a hand-rolled parser is only as good as the text
 * it has met, and the real corpus is 87 pages nobody in this repo chose.
 *
 *     WIKI_DESKTOP_VAULT=/path/to/vault deno test --allow-read --allow-env
 */
import {
  applyEdit,
  changedLineCount,
  endOfMappingAnchor,
  entryFor,
  insertEdit,
  readFrontmatter,
  removeEdit,
  setValueEdit,
  type YamlEntry,
  type YamlMapping,
} from "./frontmatter.ts";

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

/** Parse, or fail the test with the message that says why. */
function parsed(text: string) {
  const result = readFrontmatter(text);
  assert(
    result.frontmatter !== null,
    `frontmatter parses: ${result.problem ?? "no block"}`,
  );
  return result.frontmatter;
}

/** The raw text of an entry's scalar value, or null if it is not one. */
function scalarOf(mapping: YamlMapping, key: string): string | null {
  const value = entryFor(mapping, key)?.value;
  return value?.kind === "scalar" ? value.text : null;
}

const PAGE = `---
type: TechArticle
headline: CSS
description: Cascading Style Sheets for describing document presentation.
---

# CSS

Body text.
`;

Deno.test("the block is located by its fences, not by a marker", () => {
  const frontmatter = parsed(PAGE);
  assertEqual(frontmatter.from, 0, "opens at the first character");
  assertEqual(
    PAGE.slice(frontmatter.to - 3, frontmatter.to),
    "---",
    "ends just past the closing fence",
  );
  assertEqual(frontmatter.mapping.entries.length, 3, "three keys");
  assertEqual(
    frontmatter.mapping.entries.map((entry) => entry.key).join(","),
    "type,headline,description",
    "in the order the text has them",
  );
});

Deno.test("a page with no frontmatter is absent, not an error", () => {
  const result = readFrontmatter("# Just a page\n");
  assertEqual(result.frontmatter, null, "no block");
  assertEqual(result.problem, "absent", "and it says so");
});

Deno.test("a document that never closes its fence is unterminated", () => {
  // The editor's YAML parser reads the rest of this file as YAML too; the
  // structured view has to stand down rather than guess where the block ends.
  const result = readFrontmatter("---\ntype: TechArticle\n\n# CSS\n");
  assertEqual(result.frontmatter, null, "no block to edit");
  assertEqual(result.problem, "unterminated", "and it says why");
});

Deno.test("a byte-order mark is before the fence, not part of it", () => {
  const withBom = String.fromCharCode(0xfeff) + PAGE;
  const frontmatter = parsed(withBom);
  assertEqual(
    withBom.slice(frontmatter.from, frontmatter.from + 3),
    "---",
    "the fence is on the line after the mark, not before it",
  );
  assertEqual(
    frontmatter.mapping.entries.map((entry) => entry.key).join(","),
    "type,headline,description",
    "and the keys are still the keys",
  );
});

Deno.test("CRLF pages keep their line endings through an edit", () => {
  const crlf = PAGE.replace(/\n/g, "\r\n");
  const frontmatter = parsed(crlf);
  const entry = entryFor(frontmatter.mapping, "headline")!;
  const after = applyEdit(crlf, setValueEdit(crlf, entry, "Style Sheets"));
  assertEqual(
    (after.match(/\r\n/g) ?? []).length,
    (crlf.match(/\r\n/g) ?? []).length,
    "every CRLF survived",
  );
  assert(
    after.includes("\n# CSS"),
    "the body is still LF-free of a stray break",
  );
});

Deno.test("editing one value changes exactly one line", () => {
  // The criterion, stated as a test: the diff is one line, so key order,
  // quoting and indentation cannot have moved.
  const frontmatter = parsed(PAGE);
  const entry = entryFor(frontmatter.mapping, "description")!;
  const after = applyEdit(PAGE, setValueEdit(PAGE, entry, "A new summary."));
  assertEqual(changedLineCount(PAGE, after), 1, "one line changed");
  assert(
    after.includes("description: A new summary.\n"),
    "and it is the line that was asked for",
  );
  assert(
    after.includes("type: TechArticle\n"),
    "the key before it is untouched",
  );
  assert(
    after.includes("headline: CSS\n"),
    "and the one before that is untouched",
  );
});

Deno.test("an edit keeps the quoting it did not ask to change", () => {
  const page = '---\nheadline: "Quoted"\nplain: bare\n---\n';
  const frontmatter = parsed(page);
  const entry = entryFor(frontmatter.mapping, "plain")!;
  const after = applyEdit(page, setValueEdit(page, entry, "new"));
  assert(
    after.includes('headline: "Quoted"\n'),
    "the quoted line is untouched",
  );
  assertEqual(changedLineCount(page, after), 1, "one line changed");
});

Deno.test("an edit keeps a trailing comment and the space before it", () => {
  const page = "---\nname: old # the short name\n---\n";
  const frontmatter = parsed(page);
  const entry = entryFor(frontmatter.mapping, "name")!;
  const after = applyEdit(page, setValueEdit(page, entry, "new"));
  assertEqual(after, "---\nname: new # the short name\n---\n", "both survive");
  assertEqual(changedLineCount(page, after), 1, "one line changed");
});

Deno.test("a quoted value's span is the value, not the rest of the line", () => {
  const page = `---\nname: "old" # keep me\n---\n`;
  const frontmatter = parsed(page);
  const entry = entryFor(frontmatter.mapping, "name")!;
  assertEqual(
    page.slice(entry.value.span.from, entry.value.span.to),
    `"old"`,
    "the span covers the quotes",
  );
  const after = applyEdit(page, setValueEdit(page, entry, "new"));
  assertEqual(after, `---\nname: new # keep me\n---\n`, "the comment stays");
});

Deno.test("giving a key that has no value a value changes one line", () => {
  const page = "---\ntype: TechArticle\ndescription:\nheadline: CSS\n---\n";
  const frontmatter = parsed(page);
  const entry = entryFor(frontmatter.mapping, "description")!;
  const after = applyEdit(page, setValueEdit(page, entry, "A summary."));
  assertEqual(
    after,
    "---\ntype: TechArticle\ndescription: A summary.\nheadline: CSS\n---\n",
    "the value lands after the colon with a space",
  );
  assertEqual(changedLineCount(page, after), 1, "one line changed");
});

Deno.test("a key with no value and a comment keeps the comment", () => {
  const page = "---\ndescription:   # todo\n---\n";
  const frontmatter = parsed(page);
  const entry = entryFor(frontmatter.mapping, "description")!;
  const after = applyEdit(page, setValueEdit(page, entry, "A summary."));
  assertEqual(after, "---\ndescription: A summary. # todo\n---\n", "both land");
  assertEqual(changedLineCount(page, after), 1, "one line changed");
});

Deno.test("removing a key takes its line and leaves no blank behind", () => {
  const page = "---\ntype: TechArticle\nname: CSS\n---\n";
  const frontmatter = parsed(page);
  const entry = entryFor(frontmatter.mapping, "name")!;
  const after = applyEdit(page, removeEdit(page, entry));
  assertEqual(
    after,
    "---\ntype: TechArticle\n---\n",
    "the key is gone entirely",
  );
});

Deno.test("removing a key does not take the comment above it", () => {
  // Guessing that a preceding comment describes the key is a rewrite; a
  // leftover comment is a smaller mistake than a deleted one.
  const page = "---\n# the page's name\nname: CSS\ntype: TechArticle\n---\n";
  const frontmatter = parsed(page);
  const entry = entryFor(frontmatter.mapping, "name")!;
  const after = applyEdit(page, removeEdit(page, entry));
  assert(after.includes("# the page's name\n"), "the comment above survives");
  assert(!after.includes("name: CSS"), "the key is gone");
});

Deno.test("a missing field is inserted on its own line at the end", () => {
  const page = "---\ntype: TechArticle\nheadline: CSS\n---\n";
  const frontmatter = parsed(page);
  const anchor = endOfMappingAnchor(page, frontmatter.mapping);
  const after = applyEdit(
    page,
    insertEdit(anchor, 0, "description", "A summary."),
  );
  assertEqual(
    after,
    "---\ntype: TechArticle\nheadline: CSS\ndescription: A summary.\n---\n",
    "appended after the last key",
  );
});

Deno.test("a nested list of maps parses, and its items are keyed", () => {
  // This is `sh:property` in a shape document, which is the first genuinely
  // recursive thing the component has to render and the case the issue names
  // as the best available test rather than a synthetic one.
  const page = `---
type: sh:NodeShape
sh:targetClass: schema:TechArticle
sh:property:
  - sh:path: schema:headline
    sh:minCount: 1
    sh:maxCount: 1
    sh:datatype: xsd:string
    sh:message: TechArticle must have exactly one headline.
  - sh:path: schema:description
    sh:minCount: 1
    sh:datatype: xsd:string
    sh:message: TechArticle must have a description summary.
---
`;
  const frontmatter = parsed(page);
  const property = entryFor(frontmatter.mapping, "sh:property")!;
  assertEqual(property.value.kind, "sequence", "a sequence");
  if (property.value.kind !== "sequence") return;
  assertEqual(property.value.items.length, 2, "two property shapes");

  const first = property.value.items[0].value;
  assertEqual(first.kind, "mapping", "each item is a mapping");
  if (first.kind !== "mapping") return;
  assertEqual(
    first.entries.map((entry) => entry.key).join(","),
    "sh:path,sh:minCount,sh:maxCount,sh:datatype,sh:message",
    "the keys after the dash belong to the item, not the list",
  );
  const message = entryFor(first, "sh:message")!;
  assertEqual(
    message.value.kind === "scalar" ? message.value.text : "",
    "TechArticle must have exactly one headline.",
    "and the last line of the item is its own value",
  );

  // The second item's first key is at the same column as the first item's,
  // which is the part a naive indent walk gets wrong.
  const second = property.value.items[1].value;
  if (second.kind !== "mapping") return;
  assertEqual(
    scalarOf(second, "sh:path"),
    "schema:description",
    "the second item is a separate mapping",
  );
});

Deno.test("editing a value nested inside a list of maps is still one line", () => {
  const page = `---
sh:property:
  - sh:path: schema:headline
    sh:minCount: 1
---
`;
  const frontmatter = parsed(page);
  const property = entryFor(frontmatter.mapping, "sh:property")!;
  if (property.value.kind !== "sequence") throw new Error("a sequence");
  const item = property.value.items[0].value;
  if (item.kind !== "mapping") throw new Error("a mapping");
  const entry: YamlEntry = entryFor(item, "sh:minCount")!;
  const after = applyEdit(page, setValueEdit(page, entry, "2"));
  assertEqual(
    after,
    `---
sh:property:
  - sh:path: schema:headline
    sh:minCount: 2
---
`,
    "the value is replaced in place, at its own indent",
  );
  assertEqual(changedLineCount(page, after), 1, "one line changed");
});

Deno.test("a multi-line value moves under its key rather than beside it", () => {
  // `description: - first` is not a list, it is a scalar starting with a
  // dash, so the only spelling of this that YAML reads is the one below.
  const page = "---\ndescription: one line\n---\n";
  const frontmatter = parsed(page);
  const entry = entryFor(frontmatter.mapping, "description")!;
  const after = applyEdit(
    page,
    setValueEdit(page, entry, "- first\n- second"),
  );
  assertEqual(
    after,
    "---\ndescription:\n  - first\n  - second\n---\n",
    "the list hangs under the key the way a hand would write it",
  );
});

Deno.test("a value that was already a block is replaced in place", () => {
  const page = "---\ndescription:\n  - first\n  - second\n---\n";
  const frontmatter = parsed(page);
  const entry = entryFor(frontmatter.mapping, "description")!;
  const after = applyEdit(page, setValueEdit(page, entry, "- only\n- lines"));
  assertEqual(
    after,
    "---\ndescription:\n  - only\n  - lines\n---\n",
    "the same shape it already had",
  );
});

Deno.test("a nested mapping's keys are read at their own indent", () => {
  const page = `---
type: sh:NodeShape
meta:
  owner: wiki
  nested:
    deep: value
---
`;
  const frontmatter = parsed(page);
  const meta = entryFor(frontmatter.mapping, "meta")!;
  assertEqual(meta.value.kind, "mapping", "a mapping");
  if (meta.value.kind !== "mapping") return;
  assertEqual(
    meta.value.entries.map((entry) => entry.key).join(","),
    "owner,nested",
    "both keys at one level",
  );
  const nested = entryFor(meta.value, "nested")!;
  if (nested.value.kind !== "mapping") throw new Error("a mapping");
  assertEqual(
    scalarOf(nested.value, "deep"),
    "value",
    "and the deeper one is still there",
  );
});

Deno.test("a block scalar is one value, not a list of lines", () => {
  const page = `---
abstract: |
  first line
  second line
type: TechArticle
---
`;
  const frontmatter = parsed(page);
  const abstract = entryFor(frontmatter.mapping, "abstract")!;
  assertEqual(abstract.value.kind, "scalar", "a scalar");
  if (abstract.value.kind !== "scalar") return;
  assertEqual(abstract.value.style, "block", "a block scalar");
  assert(
    abstract.value.text.includes("first line"),
    "and it holds the lines under it",
  );
  // The key after a block scalar belongs to the mapping, not to the block.
  assert(
    entryFor(frontmatter.mapping, "type") !== null,
    "the mapping continues after the block",
  );
});

Deno.test("a flow list that runs onto the next line is one value", () => {
  // `type: [a, b]` is the shape `Linked_Markdown.md` writes, wrapped. A flow
  // collection that opens on the key's line is one value however many lines it
  // takes, so the form shows the class once rather than as a sequence.
  const page = `---
type: [schema:TechArticle,
       schema:SoftwareApplication]
name: Linked_Markdown
---
`;
  const frontmatter = parsed(page);
  const type = entryFor(frontmatter.mapping, "type")!;
  assertEqual(type.value.kind, "scalar", "a flow collection, not a block");
  if (type.value.kind !== "scalar") return;
  assertEqual(type.value.style, "flow", "a flow scalar");
  assert(
    type.value.text.includes("schema:SoftwareApplication"),
    "spanning both lines",
  );
  assert(entryFor(frontmatter.mapping, "name") !== null, "the map continues");
});

Deno.test("a flow list on one line is one value", () => {
  const page = "---\ntype: [a, b]\nname: x\n---\n";
  const frontmatter = parsed(page);
  assertEqual(
    scalarOf(frontmatter.mapping, "type"),
    "[a, b]",
    "read as written",
  );
  assert(entryFor(frontmatter.mapping, "name") !== null, "and the map goes on");
});

Deno.test("a quoted key is read as its key, and a colon in a URL is not one", () => {
  const page =
    '---\n"my key": value\ncodeRepository: https://example.org/a:b\n---\n';
  const frontmatter = parsed(page);
  assertEqual(
    frontmatter.mapping.entries.map((entry) => entry.key).join(","),
    "my key,codeRepository",
    "two keys, not three",
  );
  const repo = entryFor(frontmatter.mapping, "codeRepository")!;
  assertEqual(
    repo.value.kind === "scalar" ? repo.value.text : "",
    "https://example.org/a:b",
    "the value keeps the colon in the URL",
  );
});

Deno.test("a key that is only a prefix is not a key", () => {
  // `C#` and `a#b` are values, and a comment ends the scan for a key.
  const page = "---\nlang: C#\ntag: a#b\n# a comment\nname: x\n---\n";
  const frontmatter = parsed(page);
  assertEqual(
    frontmatter.mapping.entries.map((entry) => entry.key).join(","),
    "lang,tag,name",
    "the comment is not a key and the hashes are not comments",
  );
  assertEqual(scalarOf(frontmatter.mapping, "lang"), "C#", "C# is a value");
});

Deno.test("an edit that changes nothing says so", () => {
  const frontmatter = parsed(PAGE);
  const entry = entryFor(frontmatter.mapping, "headline")!;
  const edit = setValueEdit(PAGE, entry, "CSS");
  assertEqual(edit.changed, false, "the same value is not a change");
  assertEqual(applyEdit(PAGE, edit), PAGE, "and applying it is a no-op");
});

// ---------------------------------------------------------------------------
// The census: a hand-rolled parser against the text it will actually meet.
// ---------------------------------------------------------------------------

const vaultRoot = Deno.env.get("WIKI_DESKTOP_VAULT") ?? "";

/**
 * Every Markdown page under a vault root, by vault-relative path.
 *
 * The walk rather than the app's listing, because this test is about the parser
 * and the listing brings a config, a scope for every file and a set of skip
 * rules with it — none of which is what is being tested here.
 */
async function readPages(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, prefix: string) => {
    for await (const item of Deno.readDir(dir)) {
      if (item.isDirectory) {
        await walk(`${dir}/${item.name}`, `${prefix}${item.name}/`);
        continue;
      }
      if (item.name.endsWith(".md")) found.push(`${prefix}${item.name}`);
    }
  };
  await walk(root, "");
  return found.sort();
}

Deno.test({
  name: "every page in a real vault parses, and its keys are readable",
  ignore: vaultRoot === "",
  fn: async () => {
    const root = await Deno.realPath(vaultRoot);
    const entries = await readPages(root);

    let keys = 0;
    let nested = 0;
    const unreadable: string[] = [];
    for (const path of entries) {
      const text = await Deno.readTextFile(`${root}/${path}`);
      const result = readFrontmatter(text);
      if (result.frontmatter === null) {
        unreadable.push(path);
        continue;
      }
      const { mapping } = result.frontmatter;
      keys += mapping.entries.length;
      for (const entry of mapping.entries) {
        // A key whose span does not cover its own key text would mean the
        // parser and the file disagree about where the key is, which is the
        // failure that produces a wrong edit rather than a refusal.
        const written = text.slice(entry.keySpan.from, entry.keySpan.to);
        assert(
          written.replace(/^["']|["']$/g, "") === entry.key,
          `${path}: key span reads back as ${JSON.stringify(written)}`,
        );
        if (entry.value.kind !== "scalar") nested += 1;
      }
      // The block's own span has to fence exactly what the file fences, or a
      // value edit near the end could reach past the closing `---`.
      const { from, to, bodyTo } = result.frontmatter;
      assert(
        text.slice(from, from + 3) === "---",
        `${path}: block opens on the fence`,
      );
      assert(
        text.slice(to - 3, to) === "---",
        `${path}: block closes on the fence`,
      );
      assert(
        text[bodyTo - 1] === "\n",
        `${path}: the closing fence is on its own line`,
      );
    }
    console.log(
      `${entries.length} pages, ${keys} keys, ${nested} non-scalar values`,
    );
    assert(
      unreadable.length === 0,
      `${unreadable.length} pages had no readable block: ${
        unreadable.slice(0, 5).join(", ")
      }`,
    );
  },
});

Deno.test({
  name: "editing a field in a real page is a one-line diff",
  ignore: vaultRoot === "",
  fn: async () => {
    const root = await Deno.realPath(vaultRoot);
    let checked = 0;
    for (const path of await readPages(root)) {
      const text = await Deno.readTextFile(`${root}/${path}`);
      const result = readFrontmatter(text);
      if (result.frontmatter === null) continue;
      for (const entry of result.frontmatter.mapping.entries) {
        if (entry.value.kind !== "scalar") continue;
        if (entry.value.style === "empty") continue;
        if (entry.value.style === "block") continue;
        const after = applyEdit(
          text,
          setValueEdit(text, entry, "a deliberately different value"),
        );
        assertEqual(
          changedLineCount(text, after),
          1,
          `${path}: editing ${entry.key} is one line`,
        );
        checked += 1;
      }
    }
    assert(checked > 0, `no page in ${root} had a scalar field to edit`);
    console.log(`${checked} field edits, each a one-line diff`);
  },
});
