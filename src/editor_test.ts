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

/**
 * Source with its comments removed.
 *
 * An assertion about what the code must not contain has to look at the code.
 * A comment explaining the very thing being excluded contains it — the
 * `event.detail` check below matched this file's own explanation of why
 * event.detail is not used, and failed on a correct implementation.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
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

Deno.test("the selection is not hidden by the line the caret is on", async () => {
  // CodeMirror renders the selection at z-index -2 so the text sits on top of
  // it, and the active line's background is a solid colour inside the content —
  // so the two overlap and the selection disappears on exactly the line being
  // edited, which is where a selection is most often being dragged. Lifting
  // the layer is the fix, and the caret (150) and gutter (200) are higher
  // already so neither is affected. Both declarations need `!important`,
  // because the base theme wins on specificity — that is what silently undid
  // the first attempt at this fix.
  const source = await Deno.readTextFile(
    join(import.meta.dirname!, "editor.ts"),
  );
  assert(
    /\.cm-selectionLayer"?\s*:\s*\{\s*zIndex:\s*"1 !important"/.test(source),
    "the selection layer is lifted above the content, overriding the base theme",
  );
  assert(
    /\.cm-selectionBackground[^"]*"[\s\S]{0,40}?backgroundColor:\s*"var\(--selection-soft\) !important"/
      .test(source),
    "and the lifted layer is still painted the app's selection token",
  );
});

Deno.test("a triple click selects the whole line, not the word under it", async () => {
  // CodeMirror does handle a triple click, but it recognises one by
  // event.detail, which only the browser increments, and only while the
  // clicks land inside its own double-click threshold. A third click a
  // moment late resets the count, so the gesture arrives as one more word
  // selection — which is what this replaces.
  const source = await Deno.readTextFile(
    join(import.meta.dirname!, "editor.ts"),
  );

  // The count has to be ours. Reading event.detail would reproduce the bug.
  //
  // These are deliberately anchored on the counting itself rather than on the
  // observer's opening brace: the observer now also arbitrates a Ctrl+click, so
  // a window measured from `mousedown(` describes how much code happens to sit
  // above the triple click rather than what it asserts.
  assert(
    /now - lastClickAt < TRIPLE_CLICK_MS/.test(source),
    "the clicks are counted here, by time and place, rather than read from the browser's own count",
  );
  assert(
    /clicks = together \? clicks \+ 1 : 1;/.test(source),
    "and the count is ours, incrementing only while the clicks stay together",
  );
  // Checked against the code rather than the file, because the file's own
  // comment explains what event.detail is and why it is not used. An assertion
  // that matches prose cannot tell a fix from the sentence describing it.
  assert(
    !/event\.detail/.test(withoutComments(source)),
    "nothing in the editor depends on event.detail, which is what let the gesture fail",
  );

  // An observer runs before the editor's own event handlers, and preventing
  // the default there stops CodeMirror adding a word selection on top. As a
  // plain handler it would arrive second, and the two would fight.
  assert(
    /EditorView\.domEventObservers\(\{/.test(source),
    "the handler is an observer, so it runs before CodeMirror's own",
  );
  assert(
    /if \(clicks < 3\) return;[\s\S]{0,400}?event\.preventDefault\(\)/.test(
      source,
    ),
    "and it prevents the default so CodeMirror never starts its own selection",
  );

  // The window has to outlast the browser's threshold, or the gesture breaks
  // again for exactly the clicks it is meant to rescue. Windows raises that
  // threshold in its mouse settings, well past the 500ms default.
  const window = Number(
    /const TRIPLE_CLICK_MS = (\d+);/.test(source) &&
      source.match(/const TRIPLE_CLICK_MS = (\d+);/)![1],
  );
  assert(
    window > 500,
    `the triple-click window (${window}ms) is longer than the 500ms double-click default it has to survive`,
  );

  // The whole logical line, and not the visual one CodeMirror would pick: on a
  // wrapped paragraph the visual line is a fragment of what was aimed at. The
  // trailing newline is left out so deleting the selection keeps the next
  // paragraph separate.
  assert(
    /const line = view\.state\.doc\.lineAt\(pos\)/.test(source),
    "the selection is the whole line the position falls in",
  );
  assert(
    /selection: \{ anchor: line\.from, head: line\.to \}/.test(source),
    "spanning the line's text alone, so a delete does not join two paragraphs",
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
