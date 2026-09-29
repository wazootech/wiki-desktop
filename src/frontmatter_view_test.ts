/**
 * The panel's plan, which is the half of it that has rules in it.
 *
 * Two claims are tested here and they are the two the feature is judged on.
 * The first is that a write through the form is a one-line diff, which is
 * criterion 1 applied to the one part of a page this app now rewrites. The
 * second is that the panel is a *view*: it reads the same buffer the editor
 * holds, so every state it shows is derived from unsaved text — which is the
 * acceptance criterion no path-taking CLI could satisfy, because
 * `check_shacl_file` reads through `document_data_from_path` and can only see a
 * file already on disk.
 */
import { changedLineCount } from "./frontmatter.ts";
import {
  editFor,
  editText,
  planFrontmatter,
  removeFor,
} from "./frontmatter_view.ts";
import type { VaultVocabularyPayload } from "./vocabulary.ts";

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

const VOCABULARY: VaultVocabularyPayload = {
  context: {
    "@vocab": "https://schema.org/",
    schema: "https://schema.org/",
    sh: "http://www.w3.org/ns/shacl#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
    wazoo: "https://schema.wazoo.dev/",
    wiki: "https://wazootech.github.io/wiki/",
  },
  inputs: ["wiki"],
  baseIri: null,
  shapes: [],
  observedKeys: {},
};

/** The toolchain's own two shape pages, as the backend would send them. */
function withShapes(): VaultVocabularyPayload {
  return {
    ...VOCABULARY,
    shapes: [
      {
        sourcePath: "wiki/Tech_Article_Shape.md",
        targetClass: "schema:TechArticle",
        targetClassIri: "https://schema.org/TechArticle",
        label: "TechArticle Shape",
        properties: [
          {
            path: "schema:headline",
            iri: "https://schema.org/headline",
            minCount: 1,
            maxCount: 1,
            datatype: "xsd:string",
            message: "TechArticle must have exactly one headline.",
          },
          {
            path: "schema:description",
            iri: "https://schema.org/description",
            minCount: 1,
            maxCount: null,
            datatype: "xsd:string",
            message: "TechArticle must have a description summary.",
          },
        ],
      },
    ],
  };
}

const CSS = [
  "---",
  "type: TechArticle",
  "headline: CSS",
  "description: Cascading Style Sheets.",
  "---",
  "",
  "# CSS",
  "",
].join("\n");

/** A field of a plan, by key. */
function field(plan: ReturnType<typeof planFrontmatter>, key: string) {
  return plan.groups.flatMap((group) => group.fields).find((candidate) =>
    candidate.key === key
  );
}

Deno.test("a conforming page plans as structured, with nothing wrong", () => {
  const plan = planFrontmatter(
    CSS,
    "wiki/CSS.md",
    withShapes(),
    "auto",
  );
  assertEqual(plan.mode, "structured", "a class a shape targets is structured");
  assertEqual(plan.reason, null, "with nothing to explain");
  assertEqual(
    plan.classHeading,
    "TechArticle",
    "the class, as the page writes it",
  );
  assertEqual(
    plan.classes[0].shape?.sourcePath,
    "wiki/Tech_Article_Shape.md",
    "and where the class came from",
  );
  assertEqual(field(plan, "headline")?.state, "valid", "a field that passes");
  assertEqual(plan.problems.length, 0, "and no results");
  assertEqual(plan.unconstrained, false, "because a shape was checked");
});

Deno.test("removing a field through the form invalidates it before saving", () => {
  // The first acceptance criterion in #8, end to end and with nothing written
  // to disk: the plan is derived from the buffer, so the field is already
  // invalid while the file on disk still has it.
  const before = planFrontmatter(CSS, "wiki/CSS.md", withShapes(), "auto");
  const description = field(before, "description")!;
  const edit = removeFor(CSS, description);
  assert(edit !== null, "the field can be removed");
  const edited = editText(CSS, edit);

  assertEqual(changedLineCount(CSS, edited), 1, "one line changed");
  const after = planFrontmatter(edited, "wiki/CSS.md", withShapes(), "auto");
  const now = field(after, "description")!;
  assertEqual(now.state, "invalid", "that one field is invalid");
  assertEqual(
    now.missing,
    true,
    "and it is still shown, because it is required",
  );
  assertEqual(
    now.results[0].message,
    "TechArticle must have a description summary.",
    "with the shape's own message",
  );
  assertEqual(
    field(after, "headline")?.state,
    "valid",
    "and the other field is untouched",
  );
});

Deno.test("editing a field through the form is a one-line diff", () => {
  const plan = planFrontmatter(CSS, "wiki/CSS.md", withShapes(), "auto");
  const edit = editFor(CSS, field(plan, "headline")!, "Style Sheets");
  const after = editText(CSS, edit);
  assertEqual(changedLineCount(CSS, after), 1, "one line changed");
  assert(
    after.includes("headline: Style Sheets\n"),
    "and it is the line that was asked for",
  );
  assert(
    after.includes("type: TechArticle\n"),
    "with the key before it untouched",
  );
});

Deno.test("a field the page does not have is added, and nothing else moves", () => {
  const page = ["---", "type: TechArticle", "headline: CSS", "---", ""].join(
    "\n",
  );
  const plan = planFrontmatter(page, "wiki/CSS.md", withShapes(), "auto");
  // Under the name the *page* would write. The shape spells it
  // `schema:description` because it is addressing a validator; the page writes
  // `description` for the same property through the same `@vocab`, and a form
  // that added the prefixed one would be valid and inconsistent.
  const description = field(plan, "description")!;
  assertEqual(description.missing, true, "the shape requires it");
  assertEqual(description.state, "invalid", "and it is a failure today");
  const after = editText(page, editFor(page, description, "A summary."));
  assertEqual(
    after,
    [
      "---",
      "type: TechArticle",
      "headline: CSS",
      "description: A summary.",
      "---",
      "",
    ].join("\n"),
    "appended after the last key, with the fences where they were",
  );
});

Deno.test("a page whose class no shape targets is raw, and says why", () => {
  // Two of 85 content pages are in this position, and one has an empty type.
  // The answer is not an empty form; it is the escape hatch with a reason.
  const page = ["---", "type: schema:Person", "givenName: Alice", "---", ""]
    .join("\n");
  const plan = planFrontmatter(page, "wiki/Alice.md", withShapes(), "auto");
  assertEqual(plan.mode, "raw", "no shape, so raw");
  assertEqual(plan.reason, "no-shape", "and the panel can say so");
});

Deno.test("a page with no frontmatter is raw, and its text is untouched", () => {
  const page = "# Just a page\n";
  const plan = planFrontmatter(page, "README.md", withShapes(), "auto");
  assertEqual(plan.mode, "raw", "raw");
  assertEqual(plan.reason, "absent", "because there is no block");
  assertEqual(
    editText(page, editFor(page, { ...field(plan, "x")! }, "y")),
    page,
    "and nothing in the plan can write to it",
  );
});

Deno.test("a block that never closes is raw, not a parse error", () => {
  // The editor's YAML parser reads the rest of such a file as YAML too, so the
  // form has to stand down rather than guess where the block ends. The page
  // still opens, and it still saves.
  const page = ["---", "type: TechArticle", "", "# CSS", ""].join("\n");
  const plan = planFrontmatter(page, "wiki/CSS.md", withShapes(), "auto");
  assertEqual(plan.mode, "raw", "raw");
  assertEqual(plan.reason, "unterminated", "and it names the reason");
});

Deno.test("raw is chosen over structured, and the buffer is still the editor", () => {
  const plan = planFrontmatter(CSS, "wiki/CSS.md", withShapes(), "raw");
  assertEqual(plan.mode, "raw", "the reader asked for raw");
  // The plan is empty in raw mode, because there is nothing to draw — not
  // because the page has no fields. Switching back is one call away.
  assertEqual(plan.groups.length, 0, "no rows while raw");
  assertEqual(plan.reason, "off", "and the panel can say the reader chose it");
});

Deno.test("a vault whose config has not been read stands down", () => {
  // An unreachable vocabulary is a visible state, not a form full of green
  // ticks for checks that did not happen.
  const plan = planFrontmatter(CSS, "wiki/CSS.md", null, "auto");
  assertEqual(plan.mode, "raw", "raw");
  assertEqual(
    plan.reason,
    "no-vocabulary",
    "and it says the config is missing",
  );
});

Deno.test("a shape document's own sh:property list renders as rows", () => {
  // The recursion criterion, on real data rather than a synthetic one: the
  // first genuinely recursive thing this component meets in this vault is a
  // shape's own property list.
  const shape = [
    "---",
    "type: sh:NodeShape",
    "rdfs:label: TechArticle Shape",
    "sh:targetClass: schema:TechArticle",
    "sh:property:",
    "  - sh:path: schema:headline",
    "    sh:minCount: 1",
    "    sh:message: TechArticle must have exactly one headline.",
    "  - sh:path: schema:description",
    "    sh:minCount: 1",
    "    sh:message: TechArticle must have a description summary.",
    "---",
    "",
  ].join("\n");
  const plan = planFrontmatter(
    shape,
    "wiki/Tech_Article_Shape.md",
    withShapes(),
    "auto",
  );
  // A shape targets no class this page declares, so the page is raw — and that
  // is the honest answer, not a gap: there is nothing to validate a shape with.
  assertEqual(plan.mode, "raw", "a shape is not constrained by another shape");

  // Asked for explicitly, the same page is structured, and the list is
  // recursive: a shape document is exactly the page whose fields a reader wants
  // to see, and no shape constrains it.
  const structured = planFrontmatter(
    shape,
    "wiki/Tech_Article_Shape.md",
    { ...VOCABULARY, shapes: [] },
    "structured",
  );
  assertEqual(structured.mode, "structured", "an explicit choice is honoured");
  const property = field(structured, "sh:property");
  assert(property !== undefined, "the list is a field");
  assertEqual(property!.block?.kind, "sequence", "a list");
  assertEqual(property!.block?.children.length, 2, "with two items");
  assertEqual(
    property!.scalar,
    null,
    "and the field is rows, not one input: a list of maps joined into a line is `[, ]`",
  );
  const [first] = property!.block!.children;
  assertEqual(first.label, "1", "labelled by position");
  assertEqual(
    first.fields.map((nested) => nested.key).join(","),
    "sh:path,sh:minCount,sh:message",
    "and each item's own keys, one level down",
  );
  assertEqual(
    first.fields.find((nested) => nested.key === "sh:minCount")?.scalar,
    "1",
    "with their values",
  );
  assertEqual(
    first.fields[0].state,
    "undeclared",
    "and no state, because no shape constrains a nested key",
  );
});

Deno.test("a one-line flow list is one input, because it is one token", () => {
  // The counterpart to the block list above, and the reason a sequence is
  // never joined into a line: `[a, b]` arrives as a scalar written `flow`, so
  // the input shows the reader's own text rather than a reconstruction of it.
  const page = [
    "---",
    "type: schema:TechArticle",
    "headline: Flow",
    "description: A summary.",
    "redirect_to: [Old_Page, Older_Page]",
    "---",
    "",
  ].join("\n");
  const plan = planFrontmatter(
    page,
    "wiki/Flow.md",
    withShapes(),
    "structured",
  );
  const list = field(plan, "redirect_to");
  assert(list !== undefined, "the key is a field");
  assertEqual(list!.scalar, "[Old_Page, Older_Page]", "verbatim as written");
  assertEqual(list!.block, null, "and it has no rows of its own");
});

Deno.test("a block list of plain strings is rows too", () => {
  const page = [
    "---",
    "type: schema:TechArticle",
    "headline: Block",
    "description: A summary.",
    "keywords:",
    "  - alpha",
    "  - beta",
    "---",
    "",
  ].join("\n");
  const plan = planFrontmatter(
    page,
    "wiki/Block.md",
    withShapes(),
    "structured",
  );
  const list = field(plan, "keywords");
  assert(list !== undefined, "the key is a field");
  assertEqual(list!.scalar, null, "not one input pretending to hold two items");
  assertEqual(list!.block?.kind, "sequence", "but a list of rows");
  assertEqual(
    list!.block?.children.map((child) => child.fields[0]?.scalar).join(","),
    "alpha,beta",
    "each item keeping its own value",
  );
});

Deno.test("editing a list item replaces the item, not the frontmatter", () => {
  // A list item has no key, so the path that adds a missing key would write a
  // literal `1: gamma` into the top of the frontmatter. The item is edited
  // through its own span instead, which is one token on one line.
  const page = [
    "---",
    "type: schema:TechArticle",
    "headline: Block",
    "description: A summary.",
    "keywords:",
    "  - alpha",
    "  - beta",
    "---",
    "",
  ].join("\n");
  const plan = planFrontmatter(
    page,
    "wiki/Block.md",
    withShapes(),
    "structured",
  );
  const list = field(plan, "keywords");
  const second = list!.block!.children[1].fields[0];
  const edited = editText(page, editFor(page, second, "gamma"));
  assertEqual(
    edited,
    [
      "---",
      "type: schema:TechArticle",
      "headline: Block",
      "description: A summary.",
      "keywords:",
      "  - alpha",
      "  - gamma",
      "---",
      "",
    ].join("\n"),
    "the item's own token, and nothing else",
  );
  assertEqual(
    changedLineCount(page, edited),
    1,
    "one line changed",
  );
  assert(
    !/^\s*1:/m.test(edited),
    "and no key named after the item's label anywhere in the frontmatter",
  );
});

Deno.test("editing a value nested inside the list is still a one-line diff", () => {
  const shape = [
    "---",
    "type: sh:NodeShape",
    "sh:targetClass: schema:TechArticle",
    "sh:property:",
    "  - sh:path: schema:headline",
    "    sh:minCount: 1",
    "---",
    "",
  ].join("\n");
  const plan = planFrontmatter(
    shape,
    "wiki/Tech_Article_Shape.md",
    { ...VOCABULARY, shapes: [] },
    "structured",
  );
  const property = field(plan, "sh:property")!;
  const nested = property.block!.children[0].fields.find((candidate) =>
    candidate.key === "sh:minCount"
  )!;
  const after = editText(shape, editFor(shape, nested, "2"));
  assertEqual(changedLineCount(shape, after), 1, "one line changed");
  assert(
    after.includes("    sh:minCount: 2\n"),
    "at the item's own indent, which the parser recorded",
  );
});
