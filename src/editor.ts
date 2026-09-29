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
import {
  closeSearchPanel,
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
} from "@codemirror/search";
import {
  EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

import { fenceLanguage } from "./fence_languages.ts";
import {
  asksToFollowLink,
  describeLinkTarget,
  linkHrefAt,
  type LinkTarget,
  resolveLinkTarget,
} from "./markdown_links.ts";
import {
  closeHoverTooltips,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  hoverTooltip,
  type KeyBinding,
  keymap,
  lineNumbers,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

export interface WikiEditorHandle {
  /** The document as text, which is what `Save` writes and dirty compares. */
  getValue(): string;
  /** Show the document stored under `key`, seeding it from `text` if new. */
  showDocument(key: string, text: string): void;
  /** Drop a closed document's state instead of holding it for the session. */
  forgetDocument(key: string): void;
  /**
   * Cursor position as a character offset into `getValue()`.
   *
   * The primary cursor, when the user has made more than one: that is the range
   * `selection.main` names, the one a scroll follows and the one a fresh
   * selection replaces. So the status bar reports a position rather than a
   * count, and a second cursor is visible in the editor instead — see
   * `multipleSelections`.
   */
  getCursor(): number;
  /**
   * Replace the whole document with `text`, as one undo step.
   *
   * Formatting is the reason this is the whole document and not a range: a
   * formatter reads the page rather than a selection, so the page is what it
   * produces. The selection is mapped through the change rather than reset,
   * because a formatter that returns the caret to the top of the file on every
   * run is unusable on anything long.
   *
   * Text that is already what the document holds changes nothing at all — see
   * the implementation for why that is load-bearing.
   */
  applyFormatted(text: string): void;
  /**
   * Open the find panel over the document that is showing, and put the caret
   * in its field.
   *
   * Opening it twice is the same as opening it once: the panel is a piece of
   * the editor that either is up or is not, so a second caller focuses the one
   * that is already there rather than stacking another. That is what makes it
   * safe for both the page's shortcut and CodeMirror's own keymap to ask for
   * it on the same keystroke.
   *
   * `revealReplace` is the whole of the find-versus-replace distinction, and
   * it is a parameter rather than a second panel because the panel is the
   * same one either way — see `openFind`'s implementation for why the row
   * starts absent rather than disabled.
   */
  openFind(revealReplace?: boolean): void;
  /** Put the panel away. Harmless when it was never up. */
  closeFind(): void;
  /** Whether the find panel is up, so a caller can avoid re-opening it. */
  findIsOpen(): boolean;
  focus(): void;
}

export interface WikiEditorOptions {
  container: HTMLElement;
  /** Any edit or cursor move — the page treats both as a status refresh. */
  onChange: () => void;
  /**
   * Ctrl/Cmd+click landed on a link, already resolved against the document
   * that is showing — the editor knows which one that is, and the page is a
   * classic script with no way to import the resolver. The page decides what
   * to do with the target, because it knows the vault and the folder browser.
   */
  onFollowLink?: (target: LinkTarget) => void;
}

/** Two spaces, matching what the plain-textarea editor did on Tab. */
const SOFT_TAB = "  ";

/**
 * The class on the editor root that reveals the find panel's replace row.
 *
 * Named for the row rather than for the panel, because find is always up and
 * this is only sometimes true of it.
 */
const REPLACE_ROW = "wiki-replace";

/**
 * Whether the replace row has been asked for.
 *
 * A piece of editor state rather than a variable beside the view, because the
 * panel the row lives in is CodeMirror's own and it can be opened, closed and
 * rebuilt by paths this module does not drive. State is what survives that:
 * the alternative tried here first was reading the panel's open flag at the
 * moment of the call, and it was wrong in the running app -- a panel reported
 * as up when it was demonstrably gone, so Ctrl+H after a close did nothing.
 */
const revealReplaceRow = StateEffect.define<boolean>();

const replaceRowRevealed = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(revealReplaceRow)) return effect.value;
    }
    return value;
  },
});

/**
 * Keeps the editor root's class in step with that state.
 *
 * The class is what the theme keys on, and it is written here rather than in
 * `openFind` so that *every* update reconciles it -- including the ones
 * CodeMirror makes on its own behalf. Written imperatively, a class set at open
 * time could be left stale by anything that closed the panel afterwards, and
 * the state and the DOM could disagree with no one to notice.
 */
const replaceRowOnDom = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.sync(view);
    }

    update(update: ViewUpdate) {
      this.sync(update.view);
    }

    sync(view: EditorView) {
      view.dom.classList.toggle(
        REPLACE_ROW,
        view.state.field(replaceRowRevealed),
      );
    }
  },
);

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
  // The fence grammars below produce these; the markdown grammar alone does
  // not, which is why they sat unused until the subset landed.
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

  /*
   * The find panel, in the app's own tokens.
   *
   * It has to be written here for the same reason the gutter does — CodeMirror
   * injects its base theme above the page's stylesheet — and its defaults are
   * the ones that give it away as a foreign component: a hard-coded white
   * panel with grey borders, sitting on top of a Wiki page in either mode. The
   * panel keeps its own layout and only takes the palette.
   */
  ".cm-panels": {
    backgroundColor: "var(--panel-muted)",
    color: "var(--text-body)",
    borderBottom: "1px solid var(--line)",
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid var(--line)",
    borderBottom: "none",
  },
  ".cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "4px 8px",
    padding: "7px 10px",
    fontFamily: "inherit",
    fontSize: "12px",
  },
  ".cm-search label": { color: "var(--muted)", whiteSpace: "nowrap" },
  ".cm-textfield": {
    border: "1px solid var(--line-strong)",
    borderRadius: "6px",
    padding: "3px 7px",
    color: "var(--text-body)",
    backgroundColor: "var(--panel)",
    fontFamily: "inherit",
    fontSize: "12px",
  },
  ".cm-textfield:focus-visible": {
    outline: "3px solid var(--focus-ring)",
    outlineOffset: "1px",
  },
  ".cm-button": {
    border: "1px solid var(--line-strong)",
    borderRadius: "6px",
    padding: "3px 9px",
    color: "var(--text-body)",
    backgroundColor: "var(--panel)",
    backgroundImage: "none",
    fontFamily: "inherit",
    fontSize: "12px",
    textTransform: "none",
  },
  ".cm-button:hover": { backgroundColor: "var(--surface-hover)" },
  // Every match, and the one the caret is on. The defaults are a lime and an
  // orange that read as somebody else's editor; these are the app's selection
  // tint, with the current match the brand's own colour so the two are told
  // apart at a glance rather than by shade.
  ".cm-searchMatch": {
    backgroundColor: "var(--selection-soft)",
    outline: "1px solid var(--line-strong)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--brand-soft)",
    outline: "1px solid var(--brand-marker)",
  },
  // The other occurrences of whatever is selected. This is what Ctrl+F would
  // find without the panel, and it is the preview of Ctrl+Shift+L: every run
  // tinted here is one the chord turns into a cursor.
  ".cm-selectionMatch": { backgroundColor: "var(--selection-soft)" },

  /*
   * Find has no replace row until something asks for one.
   *
   * CodeMirror builds Replace into the panel whenever the editor is writable,
   * so on a find panel this app would otherwise ship a field and two buttons
   * that rewrite the page in place, with no preview and no undo boundary — the
   * only bulk-rewrite surface in the app, sitting in the middle of the one
   * that reads as read-only. Neither reference widget does that: VS Code opens
   * find on Ctrl+F and adds the row on Ctrl+H, and the p5.js Web Editor puts
   * Find and Replace on separate chords too (Ctrl/Cmd+F against Ctrl/Cmd+Alt+F,
   * following Sublime). Both treat replacing as its own intent rather than a
   * row that happens to be there, which is what this copies.
   *
   * It is hidden rather than disabled, and that distinction is the point:
   * `display: none` takes the field out of the tab order and out of the
   * accessibility tree, so there is nothing to tab into and no button to press
   * by accident. A disabled field is still reachable, still announced, and
   * still one Enter away from rewriting a page.
   *
   * The class lives on the editor root rather than on the panel because the
   * root is there synchronously when `openFind` runs, while the panel's own
   * element appears in a later update.
   */
  "&:not(.wiki-replace) .cm-search [name='replace']": { display: "none" },
  "&:not(.wiki-replace) .cm-search [name='replaceAll']": { display: "none" },
  // The line break belongs to the row: left behind, it is a blank line under
  // the find field on a panel that is meant to be one row tall.
  "&:not(.wiki-replace) .cm-search br": { display: "none" },
});

function insertSoftTab(view: EditorView): boolean {
  view.dispatch(view.state.replaceSelection(SOFT_TAB));
  return true;
}

/**
 * Multiple selections, on.
 *
 * This is the one line that decides whether the editor can hold more than one
 * selection at a time, and it has to ship with the chords that use it: without
 * it `EditorState` collapses every multi-range selection with `asSingle()`, so
 * Ctrl+D dispatches a second occurrence and gets a single range back.
 * `editorKeymap` below is the other half, and one test asserts both at once.
 *
 * The app refused this for a while, on the grounds that those chords were dead
 * anyway. That reason was about a chord being broken rather than about a mode
 * being unwanted, and the difference is what turned the decision: `searchKeymap`
 * brings Ctrl+D and Ctrl+Shift+L, the default keymap brings Ctrl+Alt+ArrowUp and
 * ArrowDown, and with the facet off every one of them had to be filtered out by
 * command identity — an active refusal, maintained against whatever a CodeMirror
 * release does next, of four chords that would otherwise work. Enabling the
 * facet is the single line that makes them real.
 *
 * Nothing else had to change for it, because the parts a multi-cursor mode needs
 * had already been paid for: `drawSelection()` renders the extra carets, the
 * theme already paints `.cm-cursor`, and `highlightSelectionMatches()` is
 * already tinting every occurrence of the selected word. That tint was the
 * preview of a chord this app refused to run, which is the strongest argument
 * for the mode and the reason it reads as finished rather than bolted on.
 *
 * The mode, stated plainly, is four chords. Ctrl+D with a caret selects the word
 * under it, and pressed again it adds the next occurrence of that text as a
 * second cursor, so typing then edits both in one undo step. Ctrl+Shift+L
 * selects every occurrence of a single selection at once. Ctrl+Alt+ArrowUp and
 * ArrowDown stack a caret above and below. Escape — `simplifySelection`, from
 * the default keymap — drops back to the single main range, which is the one
 * Ctrl+D started from.
 *
 * Two limits are worth knowing before they are met: Ctrl+D goes quiet once the
 * ranges no longer hold the same text, and Ctrl+Shift+L goes quiet with more
 * than one range at all. The pair are two ways to the same place rather than one
 * after the other — see `findChords`.
 */
export const multipleSelections: Extension = EditorState.allowMultipleSelections
  .of(true);

/**
 * The search extension's chords: CodeMirror's own list, minus go-to-line.
 *
 * `searchKeymap` is seven entries and the app wants six — Ctrl+F opens the
 * panel, Ctrl+D selects the next occurrence of the selection, Ctrl+Shift+L
 * selects all of them, Escape closes the panel, F3 and Ctrl+G step forward,
 * Shift+F3 and Ctrl+Shift+G step back. Enter and Shift+Enter work inside the
 * field.
 *
 * Ctrl+D and Ctrl+Shift+L are kept deliberately, and they are the reason this
 * list is written out rather than spread whole: they only do anything at all
 * with `multipleSelections` above, and the two are asserted together. What they
 * reach is the same set of cursors from two directions rather than in sequence.
 * Ctrl+D adds one occurrence at a time to the selection it was given and can be
 * pressed again, refusing when the ranges have stopped holding the same text.
 * Ctrl+Shift+L takes one selection's text and selects every occurrence of it in
 * a single pass, which is the whole set at once and refuses when there is already
 * more than one range — so it is the other road to the same place, not the end of
 * Ctrl+D's. Both are silent when they cannot act, which is what a chord doing
 * arithmetic on the selection rather than on the document should do.
 *
 * Go-to-line is refused for a smaller reason. This app does show line numbers
 * in the gutter, so Ctrl+Alt+G is not meaningless, but find is already how a
 * reader moves around a page and it has three ways into next and previous,
 * while the jump a wiki author actually reaches for is to a heading — which is
 * not built yet, and which followLink in src/page.ts says so about when it is
 * asked for. A line-number prompt is navigation for a document whose author
 * counts paragraphs rather than lines, and it is the only three-modifier chord
 * of the set, which is the most collision-prone part of a keyboard. The refusal
 * is matched by the command a binding runs rather than by the key it sits on, so
 * a CodeMirror release that rebinds go-to-line still gets it dropped.
 *
 * Nothing here is in the menu's shortcut column, because that column is for the
 * chords the page's own keydown handler implements and these are CodeMirror's;
 * advertising them from a list that does not own them is how a label and the
 * thing it labels drift apart.
 */
const findChords: readonly KeyBinding[] = searchKeymap.filter((binding) =>
  binding.run !== gotoLine
);

/**
 * The editor's keyboard, as one extension.
 *
 * Three decisions live here.
 *
 * **The capability and the chords that need it ship as a pair.** Four of these
 * bindings only do something because `multipleSelections` is among the editor's
 * extensions: Ctrl+D and Ctrl+Shift+L arrive with `searchKeymap`, and
 * Ctrl+Alt+ArrowUp and ArrowDown with the default keymap. All four are bound as
 * they arrive. The test that guards this asserts both halves at once — that the
 * commands are bound *and* that the facet is on — so dropping either one fails
 * loudly instead of leaving a keystroke that quietly does nothing, which is the
 * failure this app already paid for once.
 *
 * **Which map wins is declared, not positional.** The find chords are wrapped in
 * `Prec.high`, so they answer wherever they sit in this array. That used to be an
 * array position, with a comment explaining that search is "the newest claim on
 * these chords" — which is a reason to rank it above the general keymaps, and
 * ranking is what `Prec` is for. A later extension can now bring its own
 * bindings without anyone having to work out which index to insert them at.
 *
 * **The app's own keymap is the one place chords are added.** Exported so the
 * tests can build a real `EditorState` from it and read back the order
 * CodeMirror will actually resolve, and the chords themselves, rather than
 * matching strings in this file.
 */
export const editorKeymap: Extension[] = [
  keymap.of([
    ...defaultKeymap,
    ...historyKeymap,
    // Tab is not a CodeMirror default, and the plain textarea this replaced put
    // two spaces in.
    { key: "Tab", run: insertSoftTab },
  ]),
  Prec.high(keymap.of(findChords)),
];

export function createEditor(options: WikiEditorOptions): WikiEditorHandle {
  const states = new Map<string, EditorState>();
  let clicks = 0;
  let lastClickAt = 0;
  let lastClickX = 0;
  let lastClickY = 0;
  const scrollTops = new Map<string, number>();
  let key = "";
  /** Whether the follow-link modifier is held, read by the hover tooltip. */
  let armed = false;

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
    markdown({ codeLanguages: fenceLanguage }),
    appTheme,
    // The accessible name and the spellchecker used to live on the textarea.
    EditorView.contentAttributes.of({
      "aria-label": "File contents",
      spellcheck: "false",
    }),
    /*
     * Search, as a panel above the document rather than a browser find.
     *
     * The browser's own find is the wrong tool here and not merely a different
     * one: CodeMirror renders only the visible lines, so find-in-page can only
     * ever match what happens to be on screen. A wiki page is long, and the
     * sentence the reader is looking for is usually the part that is not
     * rendered.
     *
     * The panel's chords come from `searchKeymap`, so it answers Ctrl+F while
     * the editor has focus; the page binds the same chord for when it does not,
     * and `openFind` is written so the two cannot fight. Which of those chords
     * the app offers, and which it refuses, is `findChords` below.
     * `highlightSelectionMatches` marks the other occurrences of a selected
     * word without the reader asking, which is the moment they were about to.
     */
    search({ top: true }),
    highlightSelectionMatches(),
    replaceRowRevealed,
    replaceRowOnDom,
    // The capability, and then the keyboard that uses it: without this facet
    // every multi-cursor chord below is inert — see `multipleSelections`.
    multipleSelections,
    // The keyboard, in one piece: the general keymaps and the find chords ranked
    // above them. Spread as a unit so which one answers a key is decided where
    // the chords are declared — see `editorKeymap`.
    ...editorKeymap,
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
        /*
         * Ctrl/Cmd+click follows a link, and it is checked before the triple
         * click counter because it is a decision about this click rather than
         * a step in a gesture: a modified click is never one of three.
         *
         * The href is read from the tree, so a click anywhere in the link —
         * label, brackets or target — finds it, and one that is not on a link
         * returns null and falls through to the caret exactly as before.
         */
        if (asksToFollowLink(event)) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          const href = pos === null ? null : linkHrefAt(view.state, pos);
          if (href !== null) {
            event.preventDefault();
            // Resolved here rather than in the page: the editor knows which
            // document is showing, and the page is a classic script with no
            // import to hand.
            options.onFollowLink?.(resolveLinkTarget(href, key));
            return;
          }
        }
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
    /*
     * The tooltip that makes the modifier discoverable at all. An invisible
     * modifier on a coloured word is not a feature anyone finds on their own,
     * so holding the key shows where the link actually points — resolved, and
     * saying plainly when there is nowhere to go.
     *
     * It shows only while the modifier is down, tracked by a listener rather
     * than read in the callback: hoverTooltip is handed a position, not the
     * event, so the key state has to already be somewhere it can see.
     *
     * Releasing the key has to close it explicitly. CodeMirror re-evaluates a
     * hover when the pointer moves to a *different* position, so a key let go
     * under a stationary pointer leaves the box up — tested, not assumed, and
     * the reason `setArmed` dispatches rather than only assigning.
     */
    EditorView.domEventObservers({
      mousemove(event, view) {
        setArmed(view, asksToFollowLink(event));
      },
      // Pointer still, key released: nothing else would notice. A keyup of
      // anything but the modifier leaves `asksToFollowLink` true, so this
      // costs nothing during ordinary typing.
      keyup(event, view) {
        setArmed(view, asksToFollowLink(event));
      },
      mouseleave(_event, view) {
        setArmed(view, false);
      },
    }),
    hoverTooltip((view, pos) => {
      if (!armed) return null;
      const href = linkHrefAt(view.state, pos);
      if (href === null) return null;
      const text = describeLinkTarget(resolveLinkTarget(href, key));
      return {
        pos,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.textContent = text;
          return { dom };
        },
      };
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

  function setArmed(view: EditorView, next: boolean): void {
    if (armed === next) return;
    armed = next;
    if (!next) view.dispatch({ effects: closeHoverTooltips });
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

  function applyFormatted(text: string): void {
    const doc = view.state.doc;
    // Nothing to do is the common case rather than the rare one: most pages
    // the user opens are already tidy, and an empty transaction here would
    // still land in the undo history and still mark the tab dirty. The caller
    // compares first, but the handle cannot trust that, and a formatter that
    // dirties a clean page is a bug report every time somebody presses the
    // key on a file that had nothing wrong with it.
    if (doc.toString() === text) return;
    const change = view.state.update({
      changes: { from: 0, to: doc.length, insert: text },
    });
    view.dispatch(change, {
      // Mapped, not reset. A reflowed paragraph moves every offset after it,
      // and the user was reading somewhere in there.
      selection: view.state.selection.map(change.changes),
      // Not an "input" event, which is what stops the history extension from
      // folding this into the typing around it — undo would then step back a
      // character at a time through a page-sized change.
      userEvent: "format",
    });
  }

  /*
   * Find is a panel the editor owns, so the page asks for it rather than
   * building one. That is what keeps the matches, the wrap-around and the
   * "3 of 7" count honest -- they are CodeMirror's state, not a second opinion
   * held somewhere else.
   *
   * Opening focuses the field, which is the only way the chord is useful from
   * the sidebar or the tab strip: the caret was not in the editor, and a panel
   * that opens without taking the keyboard is a panel the user has to click.
   */
  function openFind(revealReplace = false): void {
    // The caller's intent decides, on every call. Ctrl+F means find and Ctrl+H
    // means replace, so a row left over from an earlier replace cannot survive
    // a Ctrl+F, and nothing about the panel's own bookkeeping can stop Ctrl+H
    // revealing it. The two chords are one keystroke apart, and a chord whose
    // effect depends on what the user did ten minutes ago is worse than one
    // that always does the same thing.
    view.dispatch({ effects: revealReplaceRow.of(revealReplace) });
    openSearchPanel(view);
  }

  function closeFind(): void {
    view.dispatch({ effects: revealReplaceRow.of(false) });
    closeSearchPanel(view);
  }

  function findIsOpen(): boolean {
    return searchPanelOpen(view.state);
  }

  return {
    getValue: () => view.state.doc.toString(),
    showDocument,
    forgetDocument: (target: string) => {
      states.delete(target);
      scrollTops.delete(target);
    },
    getCursor: () => view.state.selection.main.head,
    applyFormatted,
    openFind,
    closeFind,
    findIsOpen,
    focus: () => view.focus(),
  };
}
