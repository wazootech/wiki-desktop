/**
 * The editor's document model, against the promise `Save` makes.
 *
 * Criterion 1 of the editor decision (wazootech/wiki-desktop#6): editing is
 * only safe if loading a page into the editor and writing it back does not
 * rewrite it. Run over the `docs` vault when that decision was taken, all 87
 * pages came back byte-identical (285,011 bytes); this fixture set is the
 * version that stays in the repository.
 *
 * `EditorState` alone is enough — no DOM — which is why the guarantee can be
 * tested at all before anyone edits a file.
 */
import { join } from "node:path";

import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";

import { toEditorText } from "./vault.ts";

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

/** What the user sees after the editor has parsed a file. */
function throughEditor(text: string): string {
  return EditorState.create({ doc: text, extensions: [markdown()] })
    .doc.toString();
}

/** Everything a `docs` page is made of, as far as the editor can tell. */
const PAGES: Record<string, string> = {
  "front matter with CURIE keys":
    "---\ntype: sh:NodeShape\nsh:targetClass: schema:Project\nwazoo:layout: layouts/article.html\nfoaf:knows: wiki:people/Bob_Jones\n---\n\n# Shape\n",
  "fence with an info string":
    "```ts twoslash title=example\nconst answer = 42;\n```\n",
  "nested fences and a blank line": "~~~\n```\ninner\n```\n~~~\n",
  "table alignment": "| left | right |\n| :-- | --: |\n| a | b |\n",
  "wikilink": "See [[Linked_Markdown]] and [[people/Bob_Jones|Bob]].\n",
  "trailing spaces on a line": "line one  \nline two\t\n",
  "no trailing newline": "# Title\n\nlast line",
  "trailing blank lines": "# Title\n\n\n",
  "byte order mark": "\uFEFF# Title\n",
  "unicode line separators": "a\u2028b\u2029c\n",
  "html block": '<div class="note">\nraw\n</div>\n',
  "hard tabs for indentation": "\tindented\n",
};

Deno.test("the editor's document model returns what it was given", () => {
  for (const [name, text] of Object.entries(PAGES)) {
    assertEqual(
      throughEditor(text),
      text,
      `${name}: a page the editor has not touched comes back unchanged`,
    );
  }
});

Deno.test("only line endings are normalized, and only on the way in", () => {
  // This is the limit the vault layer exists for: neither a textarea nor
  // CodeMirror's document can hold a CRLF, so the file's own convention is
  // preserved at the boundary (see src/vault.ts) rather than in the editor.
  for (
    const text of ["a\r\nb\r\n", "a\rb\r", "a\r\nb\nc\rd", "mixed\r\nand\nnot"]
  ) {
    const seen = throughEditor(text);
    assertEqual(seen.includes("\r"), false, "no carriage returns survive");
    assertEqual(
      seen,
      toEditorText(text),
      "the editor and the vault layer agree on the conversion",
    );
  }
});

/**
 * A document's cursor and undo history are what a tab switch should preserve,
 * and both live in the cached `EditorState`. Caching only when a document is
 * first shown is a bug that no fixture can catch — a state is a plain value,
 * so the stale copy looks perfectly valid — so the invariant is pinned to the
 * source instead: the update listener has to keep the cache current.
 */
Deno.test("the per-document cache tracks the live state, not the opened one", async () => {
  const source = await Deno.readTextFile(
    join(import.meta.dirname!, "editor.ts"),
  );
  assert(
    source.includes("states.set(key, update.state)"),
    "every update caches the state the view is actually in",
  );
  assert(
    /update.docChanged \|\| update.selectionSet/.test(source),
    "edits and cursor moves both reach the cache",
  );
});

/**
 * Where the editor's appearance lives is not a style preference: CodeMirror
 * injects its base theme into the document after the page's stylesheet, with an
 * extra class of specificity, so a page-written `.cm-gutters` rule loses and the
 * gutter renders light grey inside a dark editor. A theme extension is applied
 * above the base theme by construction, which is why the editor owns it.
 */
Deno.test("the editor themes itself through an extension the cascade respects", async () => {
  const source = await Deno.readTextFile(
    join(import.meta.dirname!, "editor.ts"),
  );
  assert(
    source.includes("EditorView.theme({"),
    "the editor's appearance is a CodeMirror theme extension",
  );
  assert(
    /const extensions: Extension\[\] = \[[\s\S]*\n\s*appTheme,/.test(source),
    "that theme is one of the extensions the editor is created with",
  );
  assert(
    source.includes('backgroundColor: "var(--panel-muted)"'),
    "the gutter takes the app's own panel token",
  );
});

Deno.test("the editor keeps a document's text exactly as typed", () => {
  // The other direction: edits are the user's bytes, not a re-serialization.
  const state = EditorState.create({
    doc: "# Title\n",
    extensions: [markdown()],
  });
  const edited = state.update({
    changes: { from: 8, insert: "Body   \n\n" },
  }).state.doc.toString();
  assertEqual(edited, "# Title\nBody   \n\n", "typed text is kept verbatim");
  assert(edited.endsWith("\n\n"), "trailing whitespace is not trimmed");
});
