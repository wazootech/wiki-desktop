/**
 * The evaluator, against the acceptance criteria in #8.
 *
 * The criterion this file is really about is the second one: the string in a
 * field and the string in `wiki check`'s report have to be the same string, and
 * the way to hold that is to use the shape's own `sh:message` and to fall back
 * only where there is none. `src/shacl_agreement_test.ts` then runs this against
 * the real `wiki` CLI over a real vault, which is the claim no unit test can
 * make on its own.
 */
import { applyEdit, readFrontmatter, removeEdit } from "./frontmatter.ts";
import {
  buildFieldModel,
  type FieldModel,
  type VaultVocabulary,
} from "./fields.ts";
import { literalTypeOf, stateOf, validate } from "./shacl.ts";
import { parseShape, TermResolver } from "./shapes.ts";

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

const CONTEXT: Record<string, string> = {
  "@vocab": "https://schema.org/",
  schema: "https://schema.org/",
  sh: "http://www.w3.org/ns/shacl#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  wazoo: "https://schema.wazoo.dev/",
  wiki: "https://wazootech.github.io/wiki/",
};

const SHAPES = {
  "wiki/Tech_Article_Shape.md": `---
type: sh:NodeShape
rdfs:label: TechArticle Shape
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
`,
  "wiki/Software_Application_Shape.md": `---
type: sh:NodeShape
rdfs:label: SoftwareApplication Shape
sh:targetClass: schema:SoftwareApplication
sh:property:
  - sh:path: schema:name
    sh:minCount: 1
    sh:datatype: xsd:string
  - sh:path: schema:description
    sh:minCount: 1
    sh:datatype: xsd:string
---
`,
};

function vocabulary(): VaultVocabulary {
  const resolver = new TermResolver(CONTEXT);
  const shapes = [];
  for (const [path, text] of Object.entries(SHAPES)) {
    const shape = parseShape(text, path, resolver);
    if (shape !== null) shapes.push(shape);
  }
  return { context: CONTEXT, shapes, observedKeys: {} };
}

/** Build the model and evaluate it, which is what the panel does on a change. */
const HEADLINE = "https://schema.org/headline";
const DESCRIPTION = "https://schema.org/description";

/** A field of the first group, found by IRI rather than by the name shown. */
function declaredField(model: FieldModel, iri: string) {
  return model.groups
    .flatMap((group) => group.fields)
    .find((field) => field.iri === iri);
}

function check(
  page: string,
): { model: FieldModel; report: ReturnType<typeof validate> } {
  const resolver = new TermResolver(CONTEXT);
  const { frontmatter } = readFrontmatter(page);
  assert(frontmatter !== null, "the page has frontmatter");
  const model = buildFieldModel(frontmatter.mapping, vocabulary(), resolver);
  return {
    model,
    report: validate(model, resolver, "wiki/CSS.md"),
  };
}

const CSS = `---
type: TechArticle
headline: CSS
description: Cascading Style Sheets.
---

# CSS
`;

Deno.test("a conforming page reports nothing", () => {
  const { report } = check(CSS);
  assertEqual(report.violations.length, 0, "no results");
  assertEqual(
    report.unconstrained,
    false,
    "and it was checked against a shape",
  );
});

Deno.test("removing a field invalidates that field alone, before saving", () => {
  // The first acceptance criterion. "Before saving" is the part a CLI cannot
  // do: `check_shacl_file` reads through `document_data_from_path`, so it only
  // ever sees a file that is already on disk. This runs on the buffer.
  const { frontmatter } = readFrontmatter(CSS);
  const entry = frontmatter!.mapping.entries.find((candidate) =>
    candidate.key === "description"
  );
  const edited = applyEdit(CSS, removeEdit(CSS, entry!));
  assert(
    !edited.includes("description:"),
    "the key is gone from the buffer, and nothing is saved",
  );

  const { model, report } = check(edited);
  // Looked up by IRI rather than by name: a field the page no longer has is
  // shown under the shape's own spelling of its key, which is the name the
  // build looks for and therefore the name a write would use.
  const description = declaredField(model, DESCRIPTION);
  assert(
    description !== undefined,
    "the field is still shown, because it is required",
  );
  assertEqual(description.missing, true, "and is marked as absent");
  assertEqual(
    description.key,
    "description",
    "under the name the page would write, which the same @vocab resolves",
  );
  const state = stateOf(description, report);
  assertEqual(state.state, "invalid", "that one field is invalid");
  assertEqual(state.results.length, 1, "with one result");
  assertEqual(
    state.results[0].message,
    "TechArticle must have a description summary.",
    "carrying the shape's own message, so it is the string wiki check prints",
  );
  assertEqual(
    state.results[0].messageFrom,
    "shape",
    "and the form can say the message is the author's, not ours",
  );

  // The other required field is untouched and still valid.
  assertEqual(
    stateOf(declaredField(model, HEADLINE)!, report).state,
    "valid",
    "the other field is fine",
  );
});

Deno.test("a result is addressed by focus node and result path", () => {
  const { report } = check(
    "---\ntype: TechArticle\nheadline: CSS\n---\n",
  );
  const [result] = report.violations;
  assertEqual(result.focusNode, "wiki/CSS.md", "the page, a named node");
  assertEqual(result.resultPath, "schema:description", "and the path");
  assertEqual(
    result.resultPathIri,
    "https://schema.org/description",
    "which is the IRI a shape declares",
  );
  assertEqual(
    result.shape.sourcePath,
    "wiki/Tech_Article_Shape.md",
    "and the shape that raised it is a page, never a blank node",
  );
});

Deno.test("a field two shapes constrain carries both results", () => {
  // The fourth acceptance criterion: Linked_Markdown.md in practice. Both
  // shapes constrain schema:description, so one field has to be able to say so
  // rather than picking one error to show.
  const { model, report } = check(`---
type:
  - schema:TechArticle
  - schema:SoftwareApplication
headline: Linked Markdown
name: Linked_Markdown
---
`);
  const state = stateOf(declaredField(model, DESCRIPTION)!, report);
  assertEqual(
    state.results.length,
    2,
    "one result per shape, not one per field",
  );
  assertEqual(
    state.results.map((result) => result.shape.targetClass).join(","),
    "schema:TechArticle,schema:SoftwareApplication",
    "and each names the shape that raised it",
  );
  assertEqual(
    state.results.map((result) => result.messageFrom).join(","),
    "shape,default",
    "one shape wrote a message and the other did not",
  );
  assertEqual(state.state, "invalid", "and the field is still invalid");
});

Deno.test("a constraint with no message falls back to the tool's own wording", () => {
  const { report } = check(`---
type:
  - schema:TechArticle
  - schema:SoftwareApplication
headline: X
name: Y
---
`);
  const defaults = report.violations.filter((result) =>
    result.messageFrom === "default"
  );
  assert(defaults.length > 0, "there is a shape without a message here");
  assert(
    defaults.every((result) =>
      result.message.startsWith("Less than 1 values on wiki/CSS.md->")
    ),
    "and the fallback is pyshacl's wording, with this page as the focus node",
  );
});

Deno.test("a key with no value is a missing value, not an empty one", () => {
  // `resolve_object` adds no triple for `None`, so SHACL counts zero and
  // `sh:minCount: 1` fails. A key that is present and blank is the case the
  // build rejects and a naive form would call valid.
  const { report } = check(
    "---\ntype: TechArticle\nheadline: CSS\ndescription:\n---\n",
  );
  const results = report.violations.filter((result) =>
    result.resultPath === "schema:description"
  );
  assertEqual(results.length, 1, "a result");
  assertEqual(results[0].component, "MinCount", "a minimum count failure");
});

Deno.test("a value that is a list is counted as its length", () => {
  // `sh:minCount: 1` asks whether there is at least one value, and a list of
  // two is two values. Counting it as one would be the kind of off-by-a-shape
  // that only shows up on a page that has both a list and a constraint.
  const { report } = check(`---
type: TechArticle
headline: CSS
description:
  - one
  - two
---
`);
  const results = report.violations.filter((result) =>
    result.resultPath === "schema:description"
  );
  assertEqual(
    results.length,
    0,
    "two strings satisfy minCount 1 and are both xsd:string",
  );
  assertEqual(report.unconstrained, false, "and the page was checked");

  // A list of numbers is not a list of strings, which is the case where the
  // count and the datatype disagree and both constraints have to be applied.
  const mixed = check(`---
type: TechArticle
headline: CSS
description:
  - one
  - 2
---
`);
  const mixedResults = mixed.report.violations.filter((result) =>
    result.resultPath === "schema:description"
  );
  assertEqual(mixedResults.length, 1, "one result");
  assertEqual(mixedResults[0].component, "Datatype", "and it is the datatype");
  assertEqual(
    mixedResults[0].message,
    "TechArticle must have a description summary.",
    "with the shape's own message, which is what it wrote for this",
  );
});

Deno.test("a quoted number is a string and a bare one is not", () => {
  // The graph loader types by the parsed YAML value, and rdflib leaves a Python
  // str as xsd:string whatever it contains. This is the rule that makes
  // `age: "3"` fail `sh:datatype xsd:integer` and `age: 3` pass.
  const xsd = "http://www.w3.org/2001/XMLSchema#";
  assertEqual(literalTypeOf("3", "plain"), `${xsd}integer`, "a bare number");
  assertEqual(literalTypeOf("3", "double"), `${xsd}string`, "a quoted one");
  assertEqual(
    literalTypeOf("true", "plain"),
    `${xsd}boolean`,
    "a bare boolean",
  );
  assertEqual(
    literalTypeOf("2026-09-29", "plain"),
    `${xsd}date`,
    "a date YAML parses as one",
  );
  assertEqual(literalTypeOf("CSS", "plain"), `${xsd}string`, "anything else");
});

Deno.test("a vault with no shapes has no errors, and is not an error", () => {
  const resolver = new TermResolver(CONTEXT);
  const { frontmatter } = readFrontmatter(CSS);
  const model = buildFieldModel(
    frontmatter!.mapping,
    { context: CONTEXT, shapes: [], observedKeys: {} },
    resolver,
  );
  const report = validate(model, resolver, "wiki/CSS.md");
  assertEqual(report.violations.length, 0, "no results");
  assertEqual(
    report.unconstrained,
    true,
    "and the form says it did not check, rather than showing green ticks",
  );
  const headline = model.groups[0].fields.find((field) =>
    field.key === "headline"
  );
  assertEqual(
    stateOf(headline!, report).state,
    "undeclared",
    "a field nothing declares is not a field nothing found wrong with",
  );
});

Deno.test("a page whose class no shape targets is still fully editable", () => {
  // Two of 85 content pages have a type no shape targets, and one has an empty
  // type. Those are not an error state; they are the case raw mode exists for.
  const resolver = new TermResolver(CONTEXT);
  const { frontmatter } = readFrontmatter(
    "---\ntype: schema:Person\ngivenName: Alice\n---\n",
  );
  const model = buildFieldModel(
    frontmatter!.mapping,
    vocabulary(),
    resolver,
  );
  const report = validate(model, resolver, "wiki/Alice.md");
  assertEqual(report.violations.length, 0, "nothing to report");
  assertEqual(report.unconstrained, true, "and nothing was checked");
  assertEqual(
    model.classes[0].shape,
    null,
    "which the form shows as a class with no shape behind it",
  );
  const observed = model.groups.find((group) => group.id === "observed");
  assertEqual(observed?.fields.length, 1, "and its own key is still editable");
});

Deno.test("a field that has not been checked is unknown, not valid", () => {
  // An unreachable validator has to be a visible state, and the way to make
  // that true is not to pass an empty report where a real one belongs: an empty
  // report and a clean page are the same object, so `stateOf` takes `null` for
  // "no answer yet" and says so.
  const resolver = new TermResolver(CONTEXT);
  const { frontmatter } = readFrontmatter(CSS);
  const model = buildFieldModel(frontmatter!.mapping, vocabulary(), resolver);
  const headline = declaredField(model, HEADLINE)!;
  assertEqual(
    stateOf(headline, null).state,
    "unknown",
    "no report is not a passing grade",
  );
  assertEqual(
    stateOf(headline, validate(model, resolver, "wiki/CSS.md")).state,
    "valid",
    "and a real report over the same field is",
  );

  const { frontmatter: withExtra } = readFrontmatter(
    [
      "---",
      "type: TechArticle",
      "headline: CSS",
      "description: x",
      "note: kept",
      "---",
      "",
    ].join("\n"),
  );
  const extra = buildFieldModel(
    withExtra!.mapping,
    vocabulary(),
    resolver,
  );
  const undeclared = extra.groups
    .find((group) => group.id === "observed")!.fields[0];
  assertEqual(
    stateOf(undeclared, null).state,
    "undeclared",
    "a field no shape constrains is undeclared either way",
  );
});
