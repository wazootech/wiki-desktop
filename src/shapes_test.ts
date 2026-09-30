/**
 * Term resolution, shape discovery, and the field model.
 *
 * The cases that matter are the ones the vault actually exercises, and they are
 * the ones #8 and #22 found by measuring it: a page's bare `softwareVersion`
 * and a shape's `schema:softwareVersion` are the same property only through
 * `graph.context`; `Linked_Markdown.md` carries two types and is constrained by
 * two shapes; and the declared vocabulary is five properties against fourteen or
 * more that pages really use.
 */
import { readFrontmatter } from "./frontmatter.ts";
import { buildFieldModel, type VaultVocabulary } from "./fields.ts";
import {
  parseShape,
  type ShapeDeclaration,
  TermResolver,
  typeValues,
} from "./shapes.ts";

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

/** The context the toolchain's own vault declares, as `wiki_config.ts` reads it. */
const DOCS_CONTEXT: Record<string, string> = {
  "@vocab": "https://schema.org/",
  schema: "https://schema.org/",
  wiki: "https://wazootech.github.io/wiki/",
  wazoo: "https://schema.wazoo.dev/",
  foaf: "http://xmlns.com/foaf/0.1/",
  dc: "http://purl.org/dc/elements/1.1/",
  dcterms: "http://purl.org/dc/terms/",
  sh: "http://www.w3.org/ns/shacl#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
};

const TECH_ARTICLE_SHAPE = `---
type: sh:NodeShape
rdfs:label: TechArticle Shape
rdfs:comment: Basic validation rules for TechArticle documents.
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

# TechArticle Validation Shape
`;

const SOFTWARE_APPLICATION_SHAPE = `---
type: sh:NodeShape
rdfs:label: SoftwareApplication Shape
rdfs:comment: Validation rules for software inventory items.
sh:targetClass: schema:SoftwareApplication
sh:property:
  - sh:path: schema:name
    sh:minCount: 1
    sh:datatype: xsd:string
  - sh:path: schema:softwareVersion
    sh:datatype: xsd:string
  - sh:path: schema:description
    sh:minCount: 1
    sh:datatype: xsd:string
---

# SoftwareApplication Validation Shape
`;

/** A page that is not a shape, however many times it mentions the word. */
const PAGE_MENTIONING_SHAPES = `---
type: TechArticle
headline: SHACL
description: About shapes.
---

A \`sh:NodeShape\` is declared in a page's frontmatter:

\`\`\`yaml
type: sh:NodeShape
sh:targetClass: schema:Thing
\`\`\`
`;

const CSS_PAGE = `---
type: TechArticle
headline: CSS
description: Cascading Style Sheets for describing document presentation.
---

# CSS
`;

/** The two shape pages of the toolchain's own vault, read the way the app does. */
function docsShapes(resolver: TermResolver): ShapeDeclaration[] {
  const shapes: ShapeDeclaration[] = [];
  for (
    const [path, text] of [
      ["wiki/Tech_Article_Shape.md", TECH_ARTICLE_SHAPE],
      ["wiki/Software_Application_Shape.md", SOFTWARE_APPLICATION_SHAPE],
    ] as const
  ) {
    const shape = parseShape(text, path, resolver);
    if (shape !== null) shapes.push(shape);
  }
  return shapes;
}

function vocabulary(resolver: TermResolver): VaultVocabulary {
  return {
    context: DOCS_CONTEXT,
    shapes: docsShapes(resolver),
    observedKeys: { "wazoo:layout": 17, redirect_to: 17, codeRepository: 4 },
  };
}

Deno.test("a bare key and its prefixed spelling are one property", () => {
  const resolver = new TermResolver(DOCS_CONTEXT);
  // This is the prerequisite #22's triage note names first: without the
  // prefix map, these two lists of strings never meet.
  assertEqual(
    resolver.predicate("softwareVersion"),
    "https://schema.org/softwareVersion",
    "a bare key is a @vocab term",
  );
  assertEqual(
    resolver.predicate("schema:softwareVersion"),
    "https://schema.org/softwareVersion",
    "and the prefixed spelling is the same one",
  );
});

Deno.test("a class resolves from either spelling, which pages use in both", () => {
  const resolver = new TermResolver(DOCS_CONTEXT);
  assertEqual(
    resolver.type("TechArticle"),
    "https://schema.org/TechArticle",
    "a page writes it bare",
  );
  assertEqual(
    resolver.type("schema:TechArticle"),
    "https://schema.org/TechArticle",
    "and a page may write it prefixed",
  );
});

Deno.test("the toolchain's defaults apply when a vault declares no context", () => {
  const resolver = new TermResolver(null);
  assertEqual(
    resolver.predicate("headline"),
    "https://schema.org/headline",
    "a bare key is still a schema term",
  );
  assertEqual(
    resolver.predicate("sh:path"),
    "http://www.w3.org/ns/shacl#path",
    "and the toolchain's prefixes are there",
  );
});

Deno.test("a context without a @vocab resolves no bare key at all", () => {
  // `Context.__init__` sets `vocab` to None unless the config names one, and
  // pretending otherwise is how a form invents properties the build never sees.
  const resolver = new TermResolver({ sh: "http://www.w3.org/ns/shacl#" });
  assertEqual(
    resolver.predicate("headline"),
    null,
    "a bare key means nothing without a @vocab",
  );
  assertEqual(
    resolver.predicate("sh:path"),
    "http://www.w3.org/ns/shacl#path",
    "a declared prefix still resolves",
  );
});

Deno.test("a prefixed spelling unknown to the context falls through to @vocab", () => {
  const resolver = new TermResolver(DOCS_CONTEXT);
  // `resolve_predicate` in `src/wiki/graph.py` only returns early when the
  // prefix *is* known; otherwise it falls through to the vocab. So the build
  // reads `nope:thing` as a schema.org term, and a form that returned null here
  // would be stricter than the thing it is a view of.
  assertEqual(
    resolver.predicate("nope:thing"),
    "https://schema.org/nope:thing",
    "the build's rule, copied rather than tightened",
  );
  // `resolve_type` is the one that differs: an unknown prefix is not a class.
  assertEqual(
    resolver.type("nope:Thing"),
    null,
    "and the class rule is genuinely a different rule",
  );
  assertEqual(
    resolver.type("https://example.org/Thing"),
    "https://example.org/Thing",
    "an absolute IRI is already one",
  );
});

Deno.test("a CURIE is rendered with the vault's own prefixes", () => {
  const resolver = new TermResolver(DOCS_CONTEXT);
  assertEqual(
    resolver.curie("https://schema.org/description"),
    "schema:description",
    "the same spelling the shapes use",
  );
  assertEqual(
    resolver.curie("http://www.w3.org/2001/XMLSchema#string"),
    "xsd:string",
    "and the longest matching namespace wins",
  );
  assertEqual(
    resolver.curie("https://example.org/Thing"),
    "https://example.org/Thing",
    "an IRI no prefix covers is printed as it is",
  );
});

Deno.test("a shape document is a page whose type names a shape", () => {
  const resolver = new TermResolver(DOCS_CONTEXT);
  const shape = parseShape(
    TECH_ARTICLE_SHAPE,
    "wiki/Tech_Article_Shape.md",
    resolver,
  );
  assert(shape !== null, "the shape page is a shape");
  assertEqual(shape.targetClassIri, "https://schema.org/TechArticle", "class");
  assertEqual(shape.label, "TechArticle Shape", "and its own label");
  assertEqual(shape.properties.length, 2, "two property shapes");
  assertEqual(
    shape.properties[0].message,
    "TechArticle must have exactly one headline.",
    "the message the author wrote for exactly this moment",
  );
  assertEqual(
    shape.properties[1].iri,
    "https://schema.org/description",
    "read from its own sh:property list, which is the recursion case",
  );
});

Deno.test("a page that only mentions a shape is not a shape", () => {
  // Six pages mention `NodeShape` in this vault; two declare one. The other
  // four are prose and fenced examples, and counting them would be a count of
  // mentions rather than of shapes.
  const resolver = new TermResolver(DOCS_CONTEXT);
  assertEqual(
    parseShape(PAGE_MENTIONING_SHAPES, "wiki/SHACL.md", resolver),
    null,
    "a fenced example is not a declaration",
  );
  assertEqual(
    docsShapes(resolver).length,
    2,
    "and the vault declares exactly two",
  );
});

Deno.test("a TechArticle page shows the shape's fields, declared first", () => {
  const resolver = new TermResolver(DOCS_CONTEXT);
  const { frontmatter } = readFrontmatter(CSS_PAGE);
  const model = buildFieldModel(
    frontmatter!.mapping,
    vocabulary(resolver),
    resolver,
  );
  assertEqual(model.classes.length, 1, "one class");
  assertEqual(model.classes[0].term, "TechArticle", "as the page writes it");
  assertEqual(
    model.classes[0].shape?.sourcePath,
    "wiki/Tech_Article_Shape.md",
    "and the shape that constrains it is found",
  );
  const declared = model.groups[0];
  assertEqual(declared.id, "declared", "the declared group comes first");
  assertEqual(
    declared.fields.map((field) => field.key).join(","),
    "headline,description",
    "in the shape's own order, and named the way the page names them",
  );
  assertEqual(
    declared.fields[0].entry?.key,
    "headline",
    "and the page's own entry is found behind the prefixed spelling",
  );
});

Deno.test("a field no shape declares is still shown", () => {
  const resolver = new TermResolver(DOCS_CONTEXT);
  const { frontmatter } = readFrontmatter(
    `---\ntype: TechArticle\nheadline: X\nwazoo:layout: post\nredirect_to: Y\n---\n`,
  );
  const model = buildFieldModel(
    frontmatter!.mapping,
    vocabulary(resolver),
    resolver,
  );
  const structural = model.groups.find((group) => group.id === "structural");
  assertEqual(
    structural?.fields.map((field) => field.key).join(","),
    "wazoo:layout,redirect_to",
    "17 pages each carry these and no shape declares them",
  );
});

Deno.test("a key the vault uses elsewhere is offered, not required", () => {
  const resolver = new TermResolver(DOCS_CONTEXT);
  const { frontmatter } = readFrontmatter(CSS_PAGE);
  const model = buildFieldModel(
    frontmatter!.mapping,
    vocabulary(resolver),
    resolver,
  );
  const structural = model.groups.find((group) => group.id === "structural");
  assertEqual(
    structural?.fields.map((field) => field.key).sort().join(","),
    "redirect_to,wazoo:layout",
    "the two most-used keys in the vault, in their own group",
  );
  assert(
    structural?.fields.every((field) => field.entry === null),
    "and this page carries neither",
  );
  assert(
    [...(structural?.fields ?? [])].every((field) => field.missing),
    "so both are offered as missing rather than as values",
  );
  const suggested = model.groups.find((group) => group.id === "suggested");
  assertEqual(
    suggested?.fields[0].key,
    "codeRepository",
    "a non-layout key other pages use is offered on its own",
  );
  assertEqual(suggested?.fields[0].missing, true, "and is marked missing");
});

Deno.test("a page satisfying two shapes merges their fields", () => {
  // Linked_Markdown.md in practice: `type: [schema:TechArticle,
  // schema:SoftwareApplication]`, and both shapes constrain
  // `schema:description` with `sh:minCount: 1`.
  const resolver = new TermResolver(DOCS_CONTEXT);
  const { frontmatter } = readFrontmatter(
    `---
type:
  - schema:TechArticle
  - schema:SoftwareApplication
headline: Linked Markdown
name: Linked_Markdown
description: The protocol.
codeRepository: https://github.com/wazootech/linked-markdown
---
`,
  );
  const model = buildFieldModel(
    frontmatter!.mapping,
    vocabulary(resolver),
    resolver,
  );
  assertEqual(model.classes.length, 2, "two classes");
  assert(
    model.classes.every((declared) => declared.shape !== null),
    "and both have a shape",
  );
  const declared = model.groups[0];
  assertEqual(
    declared.fields.map((field) => field.key).join(","),
    "headline,description,name,softwareVersion",
    "the union in shape order, named the way the page writes them",
  );
  const description = declared.fields.find((field) =>
    field.iri === "https://schema.org/description"
  );
  assertEqual(
    description?.constraints.length,
    2,
    "and one field carrying two constraints",
  );
  assertEqual(
    description?.constraints.map((constraint) => constraint.shape.targetClass)
      .join(","),
    "schema:TechArticle,schema:SoftwareApplication",
    "each naming the shape that raised it",
  );
  // The one that has a message, and the one that does not, side by side.
  assertEqual(
    description?.constraints[0].message,
    "TechArticle must have a description summary.",
    "one shape wrote a message",
  );
  assertEqual(description?.constraints[1].message, null, "and no message");
});

Deno.test("no top-level key is ever dropped from the form", () => {
  // A key the form cannot validate still has to survive a round trip, because
  // the file is the source of truth and `sh:closed` is not in use here.
  const resolver = new TermResolver(DOCS_CONTEXT);
  const page = `---
type: TechArticle
headline: X
somethingNobodyDeclared: kept
another: also kept
wazoo:layout: post
---
`;
  const { frontmatter } = readFrontmatter(page);
  const model = buildFieldModel(
    frontmatter!.mapping,
    vocabulary(resolver),
    resolver,
  );
  assertEqual(model.unshown.length, 0, "nothing is unshown");
  const shown = model.groups.flatMap((group) => group.fields)
    .filter((field) => field.entry !== null)
    .map((field) => field.key)
    .sort();
  assertEqual(
    shown.join(","),
    "another,headline,somethingNobodyDeclared,wazoo:layout",
    "every key the page has is a row in the form",
  );
});

Deno.test("a page with no frontmatter builds no model and says why", () => {
  const { frontmatter, problem } = readFrontmatter("# No frontmatter\n");
  assertEqual(frontmatter, null, "no block");
  assertEqual(problem, "absent", "and the reason is the escape hatch's job");
});

Deno.test("a type written as a list is read as a list", () => {
  const { frontmatter } = readFrontmatter(
    "---\ntype:\n  - schema:TechArticle\n  - schema:SoftwareApplication\n---\n",
  );
  assertEqual(
    typeValues(frontmatter!.mapping).join(","),
    "schema:TechArticle,schema:SoftwareApplication",
    "both classes, in the order the page has them",
  );
});
