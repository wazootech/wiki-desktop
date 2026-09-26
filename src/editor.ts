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
 * How close together three clicks must be to read as a triple click.
 *
 * This has to be *longer* than the browser's own double-click threshold, not
 * equal to it. The whole reason for counting here is that the browser resets
 * its count when a click lands outside that threshold, so a window that
 * matched it would break on exactly the gestures it is meant to rescue — and
 * Windows lets that threshold be raised well past the 500ms default. The
 * cost of the longer window is that a double click on a word followed by a
 * deliberate third click on the same word reads as a triple; that is rarer
 * than the case being fixed, and one more click puts the caret back.
 */
const TRIPLE_CLICK_MS = 700;

/** How far a click may drift and still join the gesture before it. */
const TRIPLE_CLICK_SLOP = 5;

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
  //
  // `!important` is load-bearing rather than defensive. CodeMirror's own theme
  // reaches the same element with a longer, more specific chain and paints it
  // a fixed light lavender while the editor is focused, so without this the
  // focused selection is the editor's colour rather than the app's.
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-selectionLayer .cm-selectionBackground":
    {
      backgroundColor: "var(--selection-soft) !important",
    },
  // Lift the selection above the content, which is what makes it visible on
  // the line the caret is on. CodeMirror renders this layer at z-index -2 so
  // the text sits on top of it, and the active line's background — solid, and
  // a child of the content — therefore paints over the selection and the two
  // cancel each other out on exactly that line. Staying above the content is
  // what every other editor does, and the overlay is translucent, so the
  // foreground and background are tinted together and keep their contrast.
  // The caret (150) and the gutter (200) are higher still and unaffected.
  // `!important` for the same reason as the colour above: CodeMirror's own
  // base theme sets this z-index, and it wins on specificity.
  ".cm-selectionLayer": { zIndex: "1 !important" },
  // A real text selection is painted by the browser over the highlighted
  // spans, and CodeMirror overrides that too — transparent normally, and the
  // platform `highlight` colour while the content is focused, which is a light
  // block under the dark palette's light text. Transparent is fine: the layer
  // above is what should show. The `highlight` case is not, and it is the one
  // a user hits by dragging inside the editor, so it has to be out-specified
  // rather than merely matched: CodeMirror's rule carries the same weight, and
  // it is written later, so only the extra `.cm-focused` wins the tie.
  ".cm-content ::selection, .cm-line ::selection, &.cm-focused .cm-content :focus::selection, &.cm-focused .cm-line:focus::selection":
    {
      backgroundColor: "var(--selection-soft) !important",
    },
});

export function createEditor(options: WikiEditorOptions): WikiEditorHandle {
  const states = new Map<string, EditorState>();
  let clicks = 0;
  let lastClickAt = 0;
  let lastClickX = 0;
  let lastClickY = 0;
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
    /*
     * CodeMirror tells a double click from a triple by event.detail, which
     * only the browser increments, and only while consecutive clicks land
     * inside its own double-click threshold. A third click that arrives a
     * moment late resets the count, so the gesture reaches the editor as one
     * more word selection — which is what this replaces.
     *
     * Counting the clicks here makes the gesture ours. Even when the browser
     * does report the triple, CodeMirror selects the *visual* line, so on a
     * wrapped paragraph the author gets a fragment of the line they aimed at;
     * this selects the whole logical one, and leaves the trailing newline out
     * so deleting the selection does not join the paragraph to the next.
     *
     * It runs as an observer because observers run before the editor's own
     * event handlers, and preventing the default here stops CodeMirror from
     * adding its word selection on top of the line this just chose.
     */
    EditorView.domEventObservers({
      mousedown(event, view) {
        if (event.button !== 0) return;
        const now = Date.now();
        const together = now - lastClickAt < TRIPLE_CLICK_MS &&
          Math.abs(event.clientX - lastClickX) < TRIPLE_CLICK_SLOP &&
          Math.abs(event.clientY - lastClickY) < TRIPLE_CLICK_SLOP;
        clicks = together ? clicks + 1 : 1;
        lastClickAt = now;
        lastClickX = event.clientX;
        lastClickY = event.clientY;
        if (clicks < 3) return;
        // Reset now rather than on the next click, so a fourth click starts a
        // new gesture instead of counting as a fourth of the first.
        clicks = 0;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
          view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        event.preventDefault();
        view.dispatch({
          selection: { anchor: line.from, head: line.to },
          userEvent: "select.pointer",
        });
      },
    }),
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
