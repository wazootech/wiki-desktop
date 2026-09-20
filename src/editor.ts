/// <reference lib="dom" />
/**
 * The Markdown editor, as a small imperative handle.
 *
 * This is the one module in the app that runs in the browser and is not a
 * string: `deno task build:editor` bundles it for the webview, and both
 * transports serve the result at `/editor.js`. Everything the page needs is
 * behind this interface, so the page does not know CodeMirror exists and the
 * editor can be swapped again without touching the tab strip, the dirty state,
 * or `Save`.
 *
 * Documents are keyed by vault path. A key keeps its own `EditorState`, so
 * undo history, selection, and scroll survive a tab switch — the page only has
 * to say which document is on screen, not how to restore it.
 */
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";

export interface WikiEditorHandle {
  /** The document as text, which is what `Save` writes and dirty compares. */
  getValue(): string;
  /** Show the document stored under `key`, seeding it from `text` if new. */
  showDocument(key: string, text: string): void;
  /** Drop a closed document's state instead of holding it for the session. */
  forgetDocument(key: string): void;
  /** Cursor position as a character offset into `getValue()`. */
  getCursor(): number;
  focus(): void;
}

export interface WikiEditorOptions {
  container: HTMLElement;
  /** Any edit or cursor move — the page treats both as a status refresh. */
  onChange: () => void;
}

/** Two spaces, matching what the plain-textarea editor did on Tab. */
const SOFT_TAB = "  ";

/**
 * Syntax colours, as CSS custom properties rather than literals.
 *
 * The editor ships a highlight style tuned for a white background, and those
 * colours are close to unreadable on this app's dark panel — dark green
 * headings on a near-black canvas. Pointing the style at tokens instead means
 * one palette serves both schemes, and a theme change is a token change, the
 * same as everywhere else in the interface.
 */
const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading, color: "var(--syntax-heading)", fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--syntax-link)" },
  { tag: t.monospace, color: "var(--syntax-code)" },
  { tag: [t.meta, t.processingInstruction], color: "var(--syntax-marker)" },
  {
    tag: [t.comment, t.quote, t.contentSeparator],
    color: "var(--syntax-muted)",
  },
  // Nested grammars would need these; the markdown grammar alone does not
  // colour fence contents, which is the deliberate cost of the smaller bundle.
  { tag: t.keyword, color: "var(--syntax-keyword)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syntax-string)" },
  { tag: [t.number, t.bool], color: "var(--syntax-number)" },
  { tag: [t.typeName, t.namespace], color: "var(--syntax-type)" },
]);

/**
 * The editor's own appearance, in the app's tokens.
 *
 * It lives here rather than in the page's stylesheet because CodeMirror injects
 * its base theme into the document *after* the page's own rules, with one more
 * class of specificity than a plain `.cm-gutters` — so a page-written rule of
 * equal intent loses, and the gutter renders light grey inside a dark editor.
 * A theme extension is applied above the base theme by construction, and every
 * value here is still one of the page's custom properties, so the palette keeps
 * living in src/page.ts and light and dark stay one set of tokens.
 */
const appTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--panel)",
    color: "var(--text-editor)",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "13px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6" },
  ".cm-content": { padding: "12px 4px 12px 0" },
  ".cm-line": { paddingLeft: "12px" },
  ".cm-gutters": {
    borderRight: "1px solid var(--line)",
    color: "var(--text-faint)",
    backgroundColor: "var(--panel-muted)",
  },
  ".cm-activeLine": { backgroundColor: "var(--surface-hover)" },
  ".cm-activeLineGutter": {
    color: "var(--text-soft)",
    backgroundColor: "var(--surface-hover)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--brand)" },
  // Selection is painted behind the text, so it cannot recolour it: it is a
  // translucent layer instead, which reads correctly in both schemes.
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--selection-soft)",
  },
});

export function createEditor(options: WikiEditorOptions): WikiEditorHandle {
  const states = new Map<string, EditorState>();
  const scrollTops = new Map<string, number>();
  let key = "";

  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    bracketMatching(),
    highlightActiveLine(),
    syntaxHighlighting(markdownHighlightStyle),
    markdown(),
    appTheme,
    // The accessible name and the spellchecker used to live on the textarea.
    EditorView.contentAttributes.of({
      "aria-label": "File contents",
      spellcheck: "false",
    }),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      { key: "Tab", run: insertSoftTab },
    ]),
    // Two jobs in one listener. The page owns dirty state, so it hears about
    // every document and selection change rather than polling the view. And
    // the per-document cache has to track the *live* state, not the state the
    // document was opened with: caching only on creation is what made a tab
    // switch come back without its cursor or its undo history.
    EditorView.updateListener.of((update) => {
      if (update.docChanged || update.selectionSet) {
        states.set(key, update.state);
        options.onChange();
      }
    }),
  ];

  function insertSoftTab(view: EditorView): boolean {
    view.dispatch(view.state.replaceSelection(SOFT_TAB));
    return true;
  }

  const view = new EditorView({
    parent: options.container,
    state: EditorState.create({ doc: "", extensions }),
  });

  function showDocument(nextKey: string, text: string): void {
    scrollTops.set(key, view.scrollDOM.scrollTop);
    key = nextKey;
    let state = states.get(key);
    // Reuse the stored state while it still matches the text: that is what
    // keeps undo history and the cursor across a tab switch. Text that came
    // back different (a reload from disk, or another window's write) gets a
    // fresh state instead of a selection pointing into a different document.
    if (state === undefined || state.doc.toString() !== text) {
      state = EditorState.create({ doc: text, extensions });
      states.set(key, state);
    }
    view.setState(state);
    view.scrollDOM.scrollTop = scrollTops.get(key) ?? 0;
  }

  return {
    getValue: () => view.state.doc.toString(),
    showDocument,
    forgetDocument: (target: string) => {
      states.delete(target);
      scrollTops.delete(target);
    },
    getCursor: () => view.state.selection.main.head,
    focus: () => view.focus(),
  };
}
