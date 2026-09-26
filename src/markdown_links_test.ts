/**
 * What a link points at, and what a click asked for.
 *
 * No DOM: the href comes out of the Markdown syntax tree, which the outer
 * parse produces immediately, and the resolution is arithmetic. That is what
 * makes this file testable at all — and it is the reason the logic lives in
 * `markdown_links.ts` rather than in the page's script, which is a template
 * literal and eats backslashes.
 */
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";

import {
  asksToFollowLink,
  describeLinkTarget,
  linkHrefAt,
  resolveLinkTarget,
} from "./markdown_links.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Compared structurally, not by reference: a `LinkTarget` is an object, and
 * `!==` on two objects that print identically would fail every case here for a
 * reason that has nothing to do with links.
 */
function assertEqual(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${message}: expected ${b}, got ${a}`);
  }
}

function stateWith(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown()] });
}

/** The href under the first occurrence of `needle` in `doc`. */
function hrefUnder(doc: string, needle: string): string | null {
  const at = doc.indexOf(needle);
  assert(at !== -1, `the fixture contains ${JSON.stringify(needle)}`);
  return linkHrefAt(stateWith(doc), at);
}

Deno.test("the href comes out of the tree, wherever in the link you click", () => {
  // Label, brackets and target are all part of the link. The tree is what
  // knows that; a pattern of our own would have to re-derive it.
  const doc = "See [the wiki](wiki.md) for more.\n";
  for (
    const part of [
      "the wiki",
      "[",
      "]",
      "wiki.md",
    ]
  ) {
    assertEqual(
      hrefUnder(doc, part),
      "wiki.md",
      `clicking ${JSON.stringify(part)} finds the link`,
    );
  }
});

Deno.test("a URL containing a bracket or a paren still resolves", () => {
  // The reason this is read from the tree: a hand-written pattern gets these
  // wrong, and the parser has already handled them.
  assertEqual(
    hrefUnder("See [x](a(b)c.md).\n", "x"),
    "a(b)c.md",
    "a parenthesised URL is not truncated at the first )",
  );
  assertEqual(
    hrefUnder("See [x](foo[1].md).\n", "foo[1]"),
    "foo[1].md",
    "a bracketed URL is not truncated at the first ]",
  );
});

Deno.test("a position that is not in a link has no href", () => {
  assertEqual(
    hrefUnder("Plain text with no link at all.\n", "Plain"),
    null,
    "ordinary text is not a link",
  );
  assertEqual(
    hrefUnder("An ![image](pic.png) is not a link.\n", "image"),
    null,
    "an image is not a link to follow",
  );
  assertEqual(
    hrefUnder("A [half-typed](wiki\n", "half-typed"),
    null,
    "a link still being typed has no URL yet, and must not throw",
  );
  assertEqual(
    linkHrefAt(stateWith("See [x](wiki.md).\n"), 9999),
    null,
    "a position past the end of the document is not a link",
  );
});

Deno.test("a link target is relative to the page that wrote it", () => {
  assertEqual(
    resolveLinkTarget("RDF.md", "wiki/Declarative_Knowledge.md"),
    { kind: "vault", path: "wiki/RDF.md", fragment: "" },
    "a sibling in the same folder",
  );
  assertEqual(
    resolveLinkTarget("sub/Page.md", "wiki/Deep/Nested.md"),
    { kind: "vault", path: "wiki/Deep/sub/Page.md", fragment: "" },
    "a relative path climbs from the writing page's own folder",
  );
  assertEqual(
    resolveLinkTarget("../Other.md", "wiki/Deep/Page.md"),
    { kind: "vault", path: "wiki/Other.md", fragment: "" },
    ".. climbs one folder",
  );
  assertEqual(
    resolveLinkTarget("wiki/wiki.md", "Declarative_Knowledge.md"),
    { kind: "vault", path: "wiki/wiki.md", fragment: "" },
    "a page at the vault root has no folder to resolve against",
  );
  assertEqual(
    resolveLinkTarget("/assets/logo.svg", "wiki/Page.md"),
    { kind: "vault", path: "assets/logo.svg", fragment: "" },
    "a leading slash is vault-root-relative, not absolute",
  );
  assertEqual(
    resolveLinkTarget("./Same.md", "wiki/Page.md"),
    { kind: "vault", path: "wiki/Same.md", fragment: "" },
    "a leading ./ is dropped",
  );
});

Deno.test("a fragment is kept but does not change the file", () => {
  // `[wiki](wiki.md#ecosystem-templates)` is a link to a heading, and the file
  // to open is still wiki.md. 628 of the vault's link occurrences have one.
  assertEqual(
    resolveLinkTarget("wiki_serve.md#metadata-view", "wiki/wiki.md"),
    { kind: "vault", path: "wiki/wiki_serve.md", fragment: "metadata-view" },
    "a fragment rides along with the path",
  );
  assertEqual(
    resolveLinkTarget("#a-heading", "wiki/Page.md"),
    { kind: "anchor", fragment: "a-heading" },
    "a same-page fragment is not a file",
  );
  assertEqual(
    resolveLinkTarget("#", "wiki/Page.md"),
    { kind: "none" },
    "a bare # points nowhere",
  );
});

Deno.test("a scheme is another document, not a path in the vault", () => {
  // 117 of the vault's 819 links. The scheme test also has to keep a CURIE
  // like `schema:TechArticle` from being read as a relative path, which is
  // exactly the same shape.
  for (
    const href of [
      "https://wazoo.dev/",
      "http://example.com/x",
      "mailto:someone@example.com",
    ]
  ) {
    assertEqual(
      resolveLinkTarget(href, "wiki/Page.md"),
      { kind: "external", url: href },
      `${href} is external`,
    );
  }
  assertEqual(
    resolveLinkTarget("schema:TechArticle", "wiki/Page.md").kind,
    "external",
    "a CURIE has a scheme, so it is not a file path",
  );
});

Deno.test("nothing resolves to a path outside the vault", () => {
  // The same rule `wiki_config.ts` applies to a config pointing outside the
  // vault: refuse rather than guess.
  for (
    const href of [
      "../../etc/passwd",
      "../../../outside.md",
      "",
      "   ",
      "..",
    ]
  ) {
    assertEqual(
      resolveLinkTarget(href, "wiki/Page.md").kind,
      "none",
      `${JSON.stringify(href)} does not resolve to a file`,
    );
  }
});

Deno.test("the follow modifier is the platform's, read from the event", () => {
  // Ctrl on Windows and Linux, Cmd on macOS. Both are accepted so a Windows
  // user on a Mac keyboard is not left guessing.
  assert(asksToFollowLink({ ctrlKey: true, metaKey: false }), "ctrl");
  assert(asksToFollowLink({ ctrlKey: false, metaKey: true }), "cmd");
  assert(
    !asksToFollowLink({ ctrlKey: false, metaKey: false }),
    "a plain click places the caret, as it always did",
  );
});

Deno.test("the hover text says where a link goes before it is clicked", () => {
  // Discoverability is the feature: an invisible modifier on a coloured word is
  // not something anyone finds on their own.
  assertEqual(
    describeLinkTarget({ kind: "vault", path: "wiki/RDF.md", fragment: "" }),
    "wiki/RDF.md",
    "a file in the vault names its own path",
  );
  assertEqual(
    describeLinkTarget({
      kind: "vault",
      path: "wiki/wiki.md",
      fragment: "ecosystem",
    }),
    "wiki/wiki.md#ecosystem",
    "a fragment is shown, not hidden",
  );
  assert(
    describeLinkTarget({ kind: "external", url: "https://wazoo.dev/" })
      .includes("https://wazoo.dev/"),
    "an external link says it opens in a new window, so a refused click is not a mystery",
  );
  assertEqual(
    describeLinkTarget({ kind: "none" }),
    "This link does not point anywhere yet",
    "a link with no target says so",
  );
});
