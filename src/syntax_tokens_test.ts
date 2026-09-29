/**
 * The highlight style's vocabulary, against the grammars that feed it.
 *
 * The two halves of fence highlighting live in different files — the grammars
 * in `src/fence_languages.ts`, the colours in `src/editor.ts` — and until this
 * test existed nothing could see them together. A block could resolve a grammar
 * and still render as plain text, which is what #35 measured: yaml, the vault's
 * second language, was 29 fences of prose because `@lezer/yaml` tags its keys
 * `definition(propertyName)` and its plain scalars `content`, and the style
 * named neither. The grammars were working the whole time.
 *
 * So the assertion is the join: parse one fixture per language, and refuse a
 * tag that no rule reaches. Two things are allowed to reach nothing — the
 * punctuation family, which a theme leaves at the body colour on purpose, and
 * nothing else. A grammar may be added only with a colour for it, and a rule
 * may be dropped only by failing here.
 *
 * Which rule reaches which tag is not the whole question, and asking only that
 * is how the style came to render every paragraph in the vault in the string
 * colour: a style can be scoped to a grammar (`HighlightStyle.define`'s
 * `scope`), and `content` is coloured in the trees that mean a value by it and
 * not in the document. So this file asks the styles what the renderer asks
 * them — does this style apply to *this tree*, and then does it reach this tag.
 *
 * What this cannot see is the rendering: a nested language only appears in the
 * tree once a view drives the parse context, which is why this parses each
 * fixture with its own grammar instead of through the Markdown parser — the
 * same limit `src/fence_languages_test.ts` records. The colours themselves are
 * checked in the running app; this checks that there are any.
 */
import { syntaxTree } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { NodeType } from "@lezer/common";
import { getStyleTags, Tag, tags } from "@lezer/highlight";

import { documentLanguage, markdownHighlightStyles } from "./editor.ts";
import { FENCE_LANGUAGE_NAMES, fenceLanguage } from "./fence_languages.ts";
import { page } from "./page.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * A fixture per language, shaped like the vault's own fences rather than like a
 * tour of the grammar: every construct here appears in `wiki/docs/wiki`, which
 * is where the numbers in #35 come from.
 */
const FIXTURES: Record<string, string> = {
  bash: [
    "# build the site",
    "set -euo pipefail",
    'name="Alice"',
    'echo "$name" | grep -q alice',
  ].join("\n"),
  yaml: [
    "---",
    "type: schema:Person",
    "givenName: Alice",
    "count: 3",
    "knows:",
    "  - wiki:people/Bob_Jones",
    "---",
  ].join("\n"),
  python: [
    "def greet(name: str) -> str:",
    '    """Say hello."""',
    '    return f"Hello, {name}"',
    "",
    "count = 3",
  ].join("\n"),
  json: '{ "type": "schema:Person", "count": 3, "ok": true }',
  toml: ["[server]", "port = 8080", 'name = "wiki"'].join("\n"),
  powershell: ['$name = "Alice"', 'Write-Host "Hello $name"'].join("\n"),
  javascript: ['const person = { name: "Alice", knows: bob };'].join("\n"),
  jsx: ['const App = () => <div className="note">hi</div>;'].join("\n"),
  typescript: [
    "interface Person { name: string; age: number }",
    'const alice: Person = { name: "Alice", age: 3 };',
  ].join("\n"),
  tsx: ['const App = () => <p className="note">hi</p>;'].join("\n"),
  html: [
    '<p class="note">Hello <strong>wiki</strong></p>',
    "<!-- a comment -->",
  ].join("\n"),
  xml: ['<note id="1"><to>Alice</to></note>'].join("\n"),
  sparql: [
    "PREFIX schema: <https://schema.org/>",
    "SELECT ?name WHERE {",
    "  ?person schema:name ?name .",
    "}",
  ].join("\n"),
  turtle: [
    "@prefix schema: <https://schema.org/> .",
    "",
    "people:Alice a schema:Person ;",
    '    schema:givenName "Alice" .',
  ].join("\n"),
};

/**
 * Whether the editor colours `nodeTags` in a tree whose top type is `top`.
 *
 * The same question `HighlightStyle`'s renderer asks, asked the same way: a
 * scoped style applies to a whole tree or not at all, decided once against the
 * tree's top node type — a fence's grammar inside a fence, Markdown for the
 * document. Reading the rule list alone could not see that distinction, which
 * is exactly the ground the regression stood on.
 */
function coloured(nodeTags: readonly Tag[], top: NodeType): boolean {
  return markdownHighlightStyles.some((style) =>
    (!style.scope || style.scope(top)) &&
    nodeTags.some((tag) => style.style([tag]) !== null)
  );
}

/**
 * Tags a theme leaves at the body colour: separators, brackets, operators.
 *
 * By identity, not by `id`: `Tag.id` is internal to `@lezer/highlight`, and the
 * instances are stable anyway — `styleTags` builds each tag once and
 * `Modifier.get` caches what it returns, so the same objects reach this file
 * from the parser as from `tags`.
 */
const FLAT_ON_PURPOSE = new Set<Tag>([
  tags.separator,
  tags.punctuation,
  tags.operator,
]);

interface Visit {
  /** The node's name in its grammar, for the failure message. */
  node: string;
  /** Every tag the node carries, most specific first. */
  nodeTags: readonly Tag[];
  /** Every tag name in those tags' inheritance chains. */
  names: Set<string>;
}

interface Walk {
  /** The tree's own type: the grammar a scoped style is matched against. */
  top: NodeType;
  /** The tagged nodes inside it. */
  visits: readonly Visit[];
}

/**
 * Every tagged node a language's parser produces for `code`, and the type of
 * the tree they came from — the thing a scoped style is asked about.
 */
function walks(language: string, code: string): Walk {
  const grammar = fenceLanguage(language);
  assert(grammar !== null, `\`\`\`${language} reaches a grammar`);
  const tree = grammar.parser.parse(code);
  const visits: Visit[] = [];
  tree.iterate({
    enter(node) {
      const rule = getStyleTags(node.node);
      if (!rule || node.from === node.to) return;
      const names = new Set<string>();
      for (const tag of rule.tags) {
        for (const part of tag.set) names.add(tagName(part));
      }
      visits.push({ node: node.name, nodeTags: rule.tags, names });
    },
  });
  return { top: tree.type, visits };
}

/**
 * The public name of a tag, by identity.
 *
 * `Tag`'s own `toString` cannot do this: the collection is built with
 * `Tag.define()` and no name, so every base tag prints as `?`. A modified tag
 * is not in `tags` at all — `definition(propertyName)` is made by the parser —
 * so it is named after the first base tag in its inheritance chain.
 */
const NAMES = new Map<Tag, string>();
for (const [name, value] of Object.entries(tags)) {
  if (value instanceof Tag) NAMES.set(value, name);
}
function tagName(tag: Tag): string {
  for (const part of tag.set) {
    const name = NAMES.get(part);
    if (name !== undefined) return name;
  }
  return "an unnamed tag";
}

Deno.test("every language in the fence table has a fixture here", () => {
  // Otherwise a language could be added and quietly skipped by this file, which
  // is the failure mode it exists to prevent.
  for (const language of FENCE_LANGUAGE_NAMES) {
    assert(
      FIXTURES[language] !== undefined,
      `${language} has a fixture, so its tags are checked`,
    );
  }
});

Deno.test("no grammar emits a semantic tag the palette has no rule for", () => {
  for (const [language, code] of Object.entries(FIXTURES)) {
    const { top, visits } = walks(language, code);
    for (const visit of visits) {
      if (coloured(visit.nodeTags, top)) continue;
      const punctuation = visit.nodeTags.every((tag) =>
        tag.set.some((part) => FLAT_ON_PURPOSE.has(part))
      );
      assert(
        punctuation,
        `\`\`\`${language}: ${visit.node} carries ${
          [...visit.names].join(", ")
        }, which no style in markdownHighlightStyles reaches`,
      );
    }
  }
});

Deno.test("the roles #35 named are the roles the rules colour", () => {
  // The generic test above cannot fail on a tag a fixture stopped emitting, and
  // these are the tags the issue was filed about — a yaml key, a yaml scalar,
  // an attribute, a variable, an IRI. Each one has to be produced by its
  // fixture *and* reach a rule, or the colour that was added for it can go away
  // without anything noticing.
  const roles: readonly (readonly [string, string])[] = [
    ["yaml", "propertyName"],
    // A plain scalar, and the one role in this list whose colour is scoped
    // rather than document-wide. It is here to keep both halves honest: the
    // fence colours it, which the test below asserts the document does not.
    ["yaml", "content"],
    ["bash", "variableName"],
    ["python", "variableName"],
    ["json", "propertyName"],
    ["toml", "propertyName"],
    ["html", "attributeName"],
    ["sparql", "atom"],
    ["turtle", "atom"],
  ];
  // Keyed by joined strings rather than by a tuple: a Map keyed by arrays
  // compares by reference, so every lookup would miss and this test would pass
  // by reporting nothing rather than by checking anything.
  const seen = new Map<string, string>();
  for (const [language, code] of Object.entries(FIXTURES)) {
    const { top, visits } = walks(language, code);
    for (const visit of visits) {
      const state = coloured(visit.nodeTags, top) ? "coloured" : "flat";
      for (const name of visit.names) {
        seen.set(`${language}\u0000${name}`, state);
      }
    }
  }
  for (const [language, name] of roles) {
    const state = seen.get(`${language}\u0000${name}`);
    assert(
      state !== undefined,
      `the \`\`\`${language} fixture emits a \`${name}\` node`,
    );
    assert(
      state === "coloured",
      `\`\`\`${language}'s \`${name}\` takes a colour`,
    );
  }
});

Deno.test("every scoped style names a fence grammar, and not the document", () => {
  // A scoped style can only ever colour a tree it was scoped to, so a scope
  // pointed at the wrong grammar is a rule that silently does nothing — and a
  // scope that matched the document's own language would be the regression
  // again, one indirection away. Both directions are cheap to check: each
  // scope matches at least one grammar in the fence table, and none matches
  // Markdown. At least one rather than exactly one because a scope is a
  // language's *data*, and the four JavaScript grammars share theirs.
  const scoped = markdownHighlightStyles.filter((style) => style.scope);
  assert(scoped.length > 0, "the palette scopes at least one rule");
  for (const style of scoped) {
    const matches = FENCE_LANGUAGE_NAMES.filter((name) => {
      const grammar = fenceLanguage(name);
      assert(grammar !== null, `\`\`\`${name} reaches a grammar`);
      return style.scope!(grammar.parser.parse("").type);
    });
    assert(
      matches.length > 0,
      "a scope names a grammar in the fence table, and this one names none",
    );
  }
  const document = markdownLanguage.parser.parse("Plain prose.").type;
  assert(
    !scoped.some((style) => style.scope!(document)),
    "no scoped style applies to the document, where the prose is",
  );
});

Deno.test("the prose is not coloured, and the same tag in a fence is", () => {
  // The regression itself, pinned from both sides, because either side could
  // drift alone. `content` is the string colour in a yaml fence — it is what
  // makes a `type: schema:Person` line a key and a value rather than one flat
  // run of text — and the document body carries the same tag on every
  // `Paragraph` it has. One tag,
  // two grammars, two answers, and reading the rules alone cannot tell them
  // apart: this is the assertion that a rule for `content` has to be scoped,
  // and it fails on the version of the style that was written without scoping.
  const prose = markdownLanguage.parser.parse("Plain prose.").topNode;
  const paragraph = prose.firstChild;
  assert(paragraph !== null, "the markdown parser produces a node here");
  assert(
    paragraph.name === "Paragraph",
    `the fixture parses to a Paragraph, not a ${paragraph.name}`,
  );
  assert(
    (getStyleTags(paragraph)?.tags ?? []).includes(tags.content),
    "a Markdown Paragraph carries `content`",
  );
  assert(
    !coloured([tags.content], prose.type),
    "no style colours the prose, which is what a document-wide rule for " +
      "`content` did to every sentence in the vault",
  );

  const { top, visits } = walks("yaml", FIXTURES.yaml);
  const scalar = visits.find((visit) => visit.names.has("content"));
  assert(scalar !== undefined, "the yaml fixture has a plain scalar");
  assert(
    coloured(scalar.nodeTags, top),
    "a yaml plain scalar keeps the string colour, or the frontmatter goes flat",
  );
});

Deno.test("the document is Markdown with the frontmatter a page opens with", () => {
  // The vault's frontmatter was never parsed as YAML — `@lezer/markdown` has no
  // rule for it, so `- schema:TechArticle` was a bullet list and `type:` part of
  // a sentence. That is also why the colouring of it had to come from a rule for
  // `content`, which is the rule that painted the rest of every page green: the
  // two were the same tag in the same tree.
  //
  // Four claims, one document, parsed through the language the editor actually
  // installs rather than a fixture: the frontmatter is a yaml tree, its keys and
  // scalars carry the tags a yaml fence carries, the body after it is still
  // Markdown, and the `content` tag is coloured in the first and not in the
  // second — which is the whole point of scoping the rule rather than dropping
  // it.
  const doc = [
    "---",
    "type: schema:Person",
    "givenName: Alice",
    "---",
    "",
    "# Heading",
    "",
    "Plain prose.",
    "",
  ].join("\n");
  const state = EditorState.create({ doc, extensions: [documentLanguage] });
  const found: { name: string; text: string; tags: readonly Tag[] }[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      const rule = getStyleTags(node.node);
      if (!rule || node.from === node.to) return;
      found.push({
        name: node.name,
        text: doc.slice(node.from, node.to),
        tags: rule.tags,
      });
    },
  });

  const yamlTree = fenceLanguage("yaml");
  assert(yamlTree !== null, "the fence table still has a yaml grammar");
  const yamlTop = yamlTree.parser.parse("").type;
  const markdownTop = markdownLanguage.parser.parse("").type;

  const key = found.find((node) => node.text === "type");
  assert(key !== undefined, "the frontmatter's first key is a node");
  assert(
    key.tags.some((tag) => [...tag.set].some((part) => part === tags.name)),
    `a frontmatter key is a name, and \`${key.text}\` is tagged ${
      key.tags.map((tag) => tag.toString()).join(", ")
    }`,
  );
  assert(
    coloured(key.tags, yamlTop),
    "a frontmatter key takes a colour, in a yaml tree",
  );

  const scalar = found.find((node) => node.text === "schema:Person");
  assert(scalar !== undefined, "the frontmatter's first value is a node");
  assert(
    coloured(scalar.tags, yamlTop),
    "a frontmatter scalar takes a colour, which is the scoped `content` rule",
  );
  const dashes = found.filter((node) => node.text.trim() === "---");
  assert(dashes.length >= 2, "both `---` lines are nodes of their own");

  const prose = found.find((node) => node.text === "Plain prose.");
  assert(prose !== undefined, "the body after the frontmatter is parsed too");
  assert(
    prose.name === "Paragraph",
    `the body is still Markdown, and this node is a ${prose.name}`,
  );
  assert(
    !coloured(prose.tags, markdownTop),
    "the body's prose is not coloured, though it carries the same tag",
  );
});

Deno.test("every colour a rule names is a token both palettes declare", () => {
  // A rule that names a token nobody declares renders as the body colour in
  // both modes and looks exactly like a rule that works — in one theme. The
  // editor and the stylesheet are edited in different files, so this is the
  // join that keeps them honest.
  const sheet = page.slice(0, page.indexOf("</style>")).replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const declared = (selector: string): Set<string> => {
    const from = sheet.indexOf(selector);
    assert(from !== -1, `src/page.ts declares ${selector}`);
    const body = sheet.slice(from).match(/\{([^}]*)\}/)![1];
    return new Set([...body.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]));
  };
  const light = declared(":root {");
  const dark = declared(':root[data-theme="dark"] {');

  let coloured = 0;
  for (const style of markdownHighlightStyles) {
    for (const rule of style.specs) {
      const colour = (rule as { color?: string }).color;
      if (colour === undefined) continue;
      coloured++;
      const token = /^var\((--syntax-[a-z-]+)\)$/.exec(colour)?.[1];
      assert(
        token !== undefined,
        `${JSON.stringify(colour)} is a syntax token, not a literal`,
      );
      assert(light.has(token), `the light palette declares ${token}`);
      assert(dark.has(token), `the dark palette declares ${token}`);
    }
  }
  assert(coloured >= 9, "the style names the syntax tokens it is built on");
});
