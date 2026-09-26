import {
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_THEME,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  type ThemePreference,
} from "./config.ts";

/**
 * The frame every icon in `page` draws in: a stroke-2 glyph that inherits its
 * container's colour.
 *
 * They are inline SVG rather than characters because the glyphs these controls
 * need are not in every font the desktop, browser and CI targets ship, where a
 * missing character renders as a box. Sizing is on the element, not in the
 * page's stylesheet: a bare viewBox with no width renders at 300x150, and these
 * icons must stay independent of the button's `font-size`.
 */
function chromeIcon(paths: string, size: number = 15): string {
  return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
    '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    paths + "</svg>";
}

/**
 * The app's whole icon set, from Lucide (ISC), copied here rather than imported
 * so `deno task build` stays a single self-contained artefact.
 *
 * One map, one geometry, so a shape cannot be drawn twice and two controls
 * cannot drift onto the same mark — the two icon-only buttons that were both a
 * ☰ are the reason this exists. `currentColor` is what lets a glyph follow the
 * palette; the folder emoji this replaced was a colour emoji and so ignored
 * `color` entirely.
 *
 * Keys name the control, not the shape, so the map documents itself.
 */
const ICONS = {
  /** Shared by the two toggles: one action, two affordances (see `sidebarToggles`). */
  sidebarToggle: chromeIcon(
    '<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" />',
  ),
  /** The bar's one tool: an arrow, where a word beside Save was ambiguous. */
  reload: chromeIcon(
    '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />',
  ),
  menu: chromeIcon(
    '<path d="M4 5h16" /><path d="M4 12h16" /><path d="M4 19h16" />',
  ),
  newFile: chromeIcon('<path d="M5 12h14" /><path d="M12 5v14" />'),
  /** Sized for the 18px tab-close box rather than the 28px button default. */
  closeTab: chromeIcon('<path d="M18 6 6 18" /><path d="m6 6 12 12" />', 12),
  disclosure: chromeIcon('<path d="m9 18 6-6-6-6" />', 12),
  activeCheck: chromeIcon('<path d="M20 6 9 17l-5-5" />', 11),
  /**
   * The sidebar's own way in, and the only place the folder is drawn: opening
   * a vault is the one action a user reaches for from the panel, while closing
   * one lives in the menu beside the other vault commands. Once the empty state
   * and the close button were gone it was the last user of this geometry, so
   * the shared constant went with them.
   */
  openVault: chromeIcon(
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />',
    15,
  ),
  noFile: chromeIcon(
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />',
    20,
  ),
} as const;

/**
 * The webview document. It is a plain string so the app stays a single
 * self-contained entrypoint: no bundler, and nothing to embed for
 * `deno desktop --output`. The Deno-side API it talks to is `bindings.*`,
 * typed by `WikiBindings` in src/bindings.ts.
 *
 * The sidebar's width bounds are interpolated from src/config.ts rather than
 * written here twice, so the drag handle and the stored setting agree, and its
 * toggle's icon comes from the constant above for the same reason.
 */
const pageTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#f5f7fb" />
  <title>Wazoo Wiki</title>
  <style>
    /*
     * Two palettes, one per mode, selected by the data-theme attribute on <html>.
     * Nothing here reads prefers-color-scheme, so that attribute is the single
     * answer to "which mode is this": the head script below sets it from the
     * stored preference (src/config.ts) and, when that preference is system, from
     * the OS — before the first paint, and again whenever the OS flips. Each
     * palette is written once, so they cannot drift apart, and a rename of the
     * attribute is a failure rather than a silently unstyled window.
     */
    :root {
      color-scheme: light;
      --canvas: #f5f7fb;
      --panel: #ffffff;
      --panel-muted: #f8f9fc;
      --line: #e4e8f0;
      --line-strong: #cdd3df;
      --surface-hover: #f4f5fb;
      --surface-raised: #fbfcff;
      --text: #1b2434;
      --text-soft: #5d6779;
      --text-faint: #9aa4b6;
      --text-label: #3c465a;
      --text-body: #2d3749;
      --text-editor: #273247;
      --dot: #b9c1cf;
      --muted: #748096;
      --brand: #5b4de8;
      --brand-dark: #473bc7;
      --brand-text: #473bc7;
      --brand-soft: #efedff;
      --brand-marker: #7b6ce0;
      --on-brand: #ffffff;
      --brand-shadow: rgba(91, 77, 232, 0.2);
      --kbd-bg: #f6f7fa;
      --kbd-line: #dfe3eb;
      --warn-text: #9a6a12;
      --success: #17845b;
      --warning: #eb9f27;
      --selection-soft: rgba(91, 77, 232, 0.22);
      /* Syntax, read by the editor bundle's highlight style. */
      --syntax-heading: #23304f;
      --syntax-link: #4b3fd0;
      --syntax-code: #7a4a12;
      --syntax-marker: #7d8799;
      --syntax-muted: #5f6b7d;
      --syntax-keyword: #8b2fbf;
      --syntax-string: #17724f;
      --syntax-number: #a8540a;
      --syntax-type: #2f6f9f;
      --overlay: rgba(27, 36, 52, 0.38);
      --focus-ring: rgba(91, 77, 232, 0.24);
      --toast-bg: #ffffff;
      --shadow: 0 18px 45px rgba(33, 43, 72, 0.08);
      --sidebar-width: ${DEFAULT_SIDEBAR_WIDTH}px;
      /* The brand row and the tab bar share this height so the divider under
         them is one continuous line across the window, not two steps. The
         status rows pair up the same way at the bottom edge. */
      --topbar-height: 41px;
      --statusbar-height: 26px;
    }

    :root[data-theme="dark"] {
      color-scheme: dark;
      --canvas: #13151b;
      --panel: #1a1d25;
      --panel-muted: #20232c;
      --line: #2b2f3a;
      --line-strong: #3b4152;
      --surface-hover: #252935;
      --surface-raised: #232733;
      --text: #e6e9f2;
      --text-soft: #a7b0c2;
      --text-faint: #8590a6;
      --text-label: #c4cad8;
      --text-body: #c9cfdb;
      --text-editor: #dfe4ef;
      --dot: #4b5364;
      --muted: #8b95a9;
      --brand: #6a5cf0;
      --brand-dark: #7d70ff;
      --brand-text: #b3a9ff;
      --brand-soft: #2a2740;
      --brand-marker: #6f63e8;
      --kbd-bg: #232733;
      --kbd-line: #3b4152;
      --warn-text: #e8b566;
      --success: #35c08c;
      --warning: #e0a63c;
      --selection-soft: rgba(139, 129, 255, 0.28);
      --syntax-heading: #cdd6f0;
      --syntax-link: #a99fff;
      --syntax-code: #e8bd87;
      --syntax-marker: #8590a6;
      --syntax-muted: #939db1;
      --syntax-keyword: #dfa6ff;
      --syntax-string: #8fd9ad;
      --syntax-number: #ffc27a;
      --syntax-type: #8fc7ff;
      --overlay: rgba(3, 5, 10, 0.62);
      --focus-ring: rgba(139, 129, 255, 0.4);
      --toast-bg: #232733;
      --shadow: 0 18px 45px rgba(0, 0, 0, 0.5);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      /*
       * No min-width: the shell clips its overflow, so a floor here would
       * not scroll the overflow away — it would cut it off, and at a window
       * narrower than the floor the right-hand controls (the page menu above
       * all) sit past the edge with no way to reach them. The layout below is
       * already built to shrink: the column turns into a drawer, and the text
       * that cannot fit ellipsises.
       */
      height: 100vh;
      overflow: hidden;
      background: var(--canvas);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12.5px;
    }

    button, input { font: inherit; }
    button { cursor: pointer; }
    [hidden] { display: none !important; }

    .app { display: grid; grid-template-columns: var(--sidebar-width) 1fr; height: 100vh; }
    /*
     * The workspace is pinned to the second track. Collapsing removes the
     * sidebar from layout entirely, and without this the workspace would be
     * auto-placed into the 0-width first track and the window would go blank.
     */
    .workspace { grid-column: 2; }
    /* Collapsing is a layout state on the shell, so the editor reflows into it. */
    .app.is-collapsed { grid-template-columns: 0 1fr; }
    .app.is-collapsed .sidebar { display: none; }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 28px;
      padding: 0 11px;
      border: 1px solid transparent;
      border-radius: 7px;
      font-size: 12.5px;
      font-weight: 700;
      transition: background .16s ease, border-color .16s ease, transform .16s ease;
    }
    .button:active { transform: translateY(1px); }
    .button:focus-visible, input:focus-visible, .file-button:focus-visible,
    .dir-button:focus-visible, .tab:focus-visible, .tab-close:focus-visible {
      outline: 3px solid var(--focus-ring); outline-offset: 1px;
    }
    .button:disabled { cursor: not-allowed; opacity: .5; box-shadow: none; }
    .button-secondary { border-color: var(--line); color: var(--text-label); background: var(--panel); }
    .button-secondary:hover:not(:disabled) { border-color: var(--line-strong); background: var(--surface-raised); }
    .button-primary { color: var(--on-brand); background: var(--brand); box-shadow: 0 6px 14px var(--brand-shadow); }
    .button-primary:hover:not(:disabled) { background: var(--brand-dark); }
    .button-block { width: 100%; }
    .icon-button { padding: 0; width: 28px; flex-shrink: 0; font-size: 13px; }
    /* The toggle's icon is an inline SVG sized on the element itself, so the
       row's two icons are sized independently of the font. */
    .icon-button svg { display: block; }

    /* Sidebar */

    .sidebar {
      display: flex;
      flex-direction: column;
      min-height: 0;
      /* The resize handle is positioned against this box. */
      position: relative;
      border-right: 1px solid var(--line);
      background: var(--panel);
    }

    /*
     * The drag handle straddles the divider: 4px over the panel, 3px over the
     * editor, so the target is 7px wide without moving the line the user is
     * aiming at. The right offset is measured from the padding edge, and the
     * sidebar's border sits outside that edge, so the accent below is 4px in to
     * land on the border itself — at 3px it would draw a second line 1px to the
     * left of the divider.
     */
    .resizer {
      position: absolute; top: 0; right: -3px; bottom: 0; width: 7px; z-index: 3;
      cursor: col-resize; touch-action: none;
    }
    .resizer::after {
      position: absolute; top: 0; bottom: 0; left: 4px; width: 1px;
      background: transparent; content: "";
    }
    .resizer:hover::after, .resizer.is-dragging::after, .resizer:focus-visible::after {
      background: var(--brand-marker);
    }
    .resizer:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: -3px; }
    /* While dragging, the pointer can outrun the handle; keep the cursor and
       stop the drag from selecting the editor's text on the way. */
    body.is-resizing { cursor: col-resize; user-select: none; }

    /*
     * Both rows are the same height, and the toggle is pinned the same distance
     * from the top in each, so collapsing the sidebar does not move it.
     *
     * The brand row carries the divider itself. Matching heights alone is not
     * enough: a border-bottom sits inside its own box while a border-top sits
     * inside the neighbour's, so two rows that merely touch draw their rules on
     * opposite sides of the shared edge — 1px apart, which is the stray pixel
     * this replaced. Both columns draw the line the same way instead.
     */
    .brand {
      display: flex; align-items: center; gap: 8px; height: var(--topbar-height); padding: 6px 10px;
      border-bottom: 1px solid var(--line);
    }
    .tabbar .sidebar-toggle { display: none; }
    .app.is-collapsed .tabbar .sidebar-toggle { display: inline-flex; }
    /* The rows' text is taller than the button, so centring would put the two
       copies a fraction of a pixel apart; pin both to the padding edge. */
    .brand .sidebar-toggle, .tabbar .sidebar-toggle { align-self: flex-start; }
    /*
     * The official Wazoo mark, inline so the page stays one string with no
     * asset route. Used bare and unrecoloured: the brand guide forbids
     * stretching, rotating, or recolouring the logo assets. Copy of
     * https://wazoo.dev/assets/wazoo.svg (the file the site and its JSON-LD
     * both point at), with the clip-path id namespaced for inlining.
     */
    .brand-mark { display: grid; place-items: center; width: 26px; height: 26px; flex-shrink: 0; }
    .brand-mark svg { width: 100%; height: 100%; }
    /* Explicit line-heights: the two lines have to fit the row's padding box,
       and a fallback font's natural metrics are taller than the token allows. */
    .brand-name { font-size: 13px; font-weight: 760; line-height: 1.2; letter-spacing: -.01em; }
    .brand-subtitle { color: var(--muted); font-size: 10.5px; line-height: 1.25; }

    .vault {
      padding: 8px 13px 10px;
      border-bottom: 1px solid var(--line);
      background: var(--panel-muted);
    }
    .vault-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .vault-label { color: var(--muted); font-size: 9.5px; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; flex-shrink: 0; }
    .vault-name { font-size: 12.5px; font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vault-name.is-placeholder { color: var(--muted); font-weight: 600; }
    /*
     * The vault's one action, in its own row beside the name rather than a row
     * of its own under it. It was a full-width button labelled "Open vault…"
     * sitting directly beneath a vault that was already open, which made the
     * sidebar's first sentence about the wrong thing.
     *
     * There was a second button here — a crossed folder, for closing the vault.
     * It went the way editors have gone: VS Code's File menu has Open Folder
     * and Close Folder as entries and neither of them as a button on the
     * folder, and the one a user reaches for while browsing is opening a
     * different one. Closing a vault is in the menu's Vault group under the
     * same name it always had, next to Copy vault path, disabled when there is
     * nothing to close.
     */
    .vault-actions { display: flex; align-items: center; gap: 2px; margin-left: auto; flex-shrink: 0; }
    .vault-actions .icon-button { width: 24px; min-height: 24px; border-radius: 6px; color: var(--muted); }
    .vault-actions .icon-button:hover { color: var(--text); background: var(--surface-hover); }
    /*
     * The path earns its row only when there is no vault: then it is the
     * sentence saying what Open vault is for. With a vault open it is the
     * root, which the name already identifies and which no sidebar wide
     * enough to be usable has room to show — measured at 338px of text in a
     * 308px box, so what the user actually read was an ellipsis. 26px of a
     * permanent header is a lot for that, so it is dropped while open.
     */
    .vault-path {
      margin: 3px 0 0; color: var(--muted); font-size: 10.5px; line-height: 1.4;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /*
     * The file list's own toolbar: the filter, then the button that creates a
     * file. Creating lives here rather than in the top bar, which holds the open
     * document's actions — the same reason it did not join the vault's row of
     * labeled buttons, which has since become two icons on the vault's own
     * heading.
     *
     * The row is hidden outright with no vault open. The file list empties then,
     * so what was left was a filter over nothing, a toggle with nothing to
     * toggle, and a disabled create button: chrome for an empty list, which is
     * the part of "closing the vault" that had not been finished.
     */
    .file-tools { display: flex; align-items: center; gap: 6px; padding: 8px 10px 5px; }
    .filter {
      flex: 1; min-width: 0; min-height: 28px; padding: 0 9px;
      border: 1px solid var(--line); border-radius: 7px; color: var(--text); background: var(--panel-muted);
      font-size: 12px;
    }
    .filter::placeholder { color: var(--text-faint); }
    /*
     * The vault's own config decides what is a page and what is a static file.
     * The checkbox only appears in a vault that declares assets, since a vault
     * without the config has no such distinction to show.
     */
    .assets-toggle {
      display: flex; align-items: center; gap: 4px; flex-shrink: 0;
      color: var(--muted); font-size: 11px; white-space: nowrap; cursor: pointer;
    }
    .assets-toggle input { margin: 0; }
    /*
     * Two labelled checkboxes plus the filter plus a button is more than a
     * 200px sidebar's toolbar has, so it is allowed to wrap: a second line
     * costs 17px of file list, where clipping a control costs the user the
     * setting itself. They are grouped so they wrap together — left to wrap
     * freely the pair splits across three ragged lines, one checkbox each.
     */
    .file-tools { flex-wrap: wrap; }
    .file-tools .filter { flex-basis: 100px; }
    .file-tools-checks { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

    /*
     * The list scrolls constantly and the column is dark, so the platform's
     * default scrollbar — a light grey bar, sized for a light page — sat in the
     * middle of it. The tab strip already asks for a thin one; this is the same
     * request for the one control a reader is always scrolling.
     */
    .file-list {
      flex: 1; min-height: 0; margin: 0; padding: 3px 7px 8px; overflow-y: auto; list-style: none;
      scrollbar-width: thin;
    }
    .file-button {
      position: relative;
      display: block; width: 100%; padding: 4px 8px; border: 0; border-radius: 6px;
      color: var(--text-body); background: transparent; text-align: left; font-size: 12px; line-height: 1.3;
    }
    .file-button:hover { background: var(--surface-hover); }
    /*
     * An open-but-inactive buffer gets a rail, so tabs stay findable in the
     * tree. It is a positioned bar and not an inset box-shadow, because the
     * row's corner radius would hook the ends of the accent around the top-left
     * and bottom-left corners.
     */
    .file-button.is-open::before {
      position: absolute; top: 4px; bottom: 4px; left: 1px; width: 2px;
      border-radius: 999px; background: var(--brand-marker); content: "";
    }
    .file-button.is-active { color: var(--brand-text); background: var(--brand-soft); font-weight: 700; }
    .file-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* Listed rather than hidden, but visibly not one of the wiki's pages. */
    .file-button.is-asset { opacity: .62; }
    .file-dir { display: block; color: var(--muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-empty { padding: 12px 9px; color: var(--muted); font-size: 11.5px; line-height: 1.5; }
    .sidebar-status {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      height: var(--statusbar-height); padding: 0 13px;
      border-top: 1px solid var(--line); color: var(--muted); font-size: 10px;
    }
    .transport {
      flex-shrink: 0; padding: 1px 6px; border: 1px solid var(--line); border-radius: 999px;
      color: var(--text-soft); background: var(--panel-muted); font-size: 9.5px; font-weight: 650;
    }

    /* Workspace */

    .workspace { display: flex; flex-direction: column; min-width: 0; min-height: 0; }

    .tabbar {
      display: flex; align-items: center; gap: 8px;
      height: var(--topbar-height); padding: 6px 10px;
      border-bottom: 1px solid var(--line); background: var(--panel);
    }
    .tabs {
      display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0;
      overflow-x: auto; overflow-y: hidden; scrollbar-width: thin;
    }
    .tabs:empty::after { padding-left: 2px; color: var(--muted); font-size: 12px; content: "No file open"; }
    .tab {
      display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto;
      max-width: 210px; height: 27px; padding: 0 3px 0 8px;
      border: 1px solid var(--line); border-radius: 7px;
      color: var(--text-body); background: var(--panel-muted);
      font-size: 12px; cursor: pointer; user-select: none;
    }
    .tab:hover { background: var(--surface-hover); }
    .tab.is-active { color: var(--brand-text); background: var(--brand-soft); border-color: var(--brand-marker); font-weight: 700; }
    .tab-state { width: 6px; height: 6px; border-radius: 50%; background: transparent; flex-shrink: 0; }
    .tab.is-dirty .tab-state { background: var(--warning); }
    .tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tab-close {
      display: grid; place-items: center; width: 18px; height: 18px; flex-shrink: 0;
      border: 0; border-radius: 4px; color: inherit; background: transparent;
      font-size: 13px; line-height: 1; opacity: .55;
    }
    .tab-close:hover { background: var(--surface-raised); opacity: 1; }

    .file-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .save-state { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; color: var(--muted); font-size: 11px; font-weight: 550; }
    .save-state::before { width: 6px; height: 6px; border-radius: 50%; background: var(--dot); content: ""; }
    .save-state.is-dirty { color: var(--warn-text); }
    .save-state.is-dirty::before { background: var(--warning); }
    .save-state.is-saved { color: var(--success); }
    .save-state.is-saved::before { background: var(--success); }

    /*
     * The command menu. It is page-rendered on purpose: a native application
     * menu lives in the Deno process, where the browser preview cannot click it
     * and a test cannot assert it. This surface exists in both targets, and
     * window.wikiRunCommand(id) drives the same code path from outside.
     */
    .file-actions { position: relative; }
    .menu-popup {
      position: absolute; top: calc(100% + 6px); right: 0; z-index: 5;
      min-width: 236px; padding: 5px; border: 1px solid var(--line);
      border-radius: 10px; background: var(--panel); box-shadow: var(--shadow);
    }
    .menu-popup[hidden] { display: none; }
    .menu-button[aria-expanded="true"] { border-color: var(--brand-marker); color: var(--brand-text); background: var(--brand-soft); }
    .menu-group + .menu-group { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--line); }
    .menu-group-label { padding: 3px 9px 2px; color: var(--muted); font-size: 9.5px; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }
    .menu-item {
      display: flex; align-items: center; gap: 12px; width: 100%; padding: 5px 9px;
      border: 0; border-radius: 6px; color: var(--text-body); background: transparent;
      font-size: 12.5px; text-align: left;
    }
    .menu-item:hover:not([aria-disabled="true"]) { background: var(--surface-hover); }
    .menu-item:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: -1px; }
    .menu-item[aria-disabled="true"] { color: var(--text-faint); cursor: not-allowed; }
    .menu-item-label { flex: 1; }
    /* A radio item keeps its gutter whether or not it is the active one, so the
       labels of a group of choices line up. */
    .menu-check { display: grid; place-items: center; flex-shrink: 0; width: 11px; height: 11px; color: var(--brand-text); }
    .menu-keys { flex-shrink: 0; color: var(--text-faint); font-size: 10.5px; }
    /*
     * The same popup at the pointer rather than under a button. Fixed, because
     * the menu is placed in window coordinates and the sidebar is a
     * transformed element in the drawer layout, which would otherwise become
     * its containing block. The left and top are written by the script, which
     * also pulls it back inside the window.
     *
     * right: auto is not decoration. The base rule anchors the menu at
     * right: 0, and a fixed box with both left and right set and width: auto
     * stretches to fill the window rather than hugging its one item.
     */
    .vault-menu { position: fixed; top: 0; left: 0; right: auto; min-width: 188px; }

    .editor-region { position: relative; flex: 1; min-height: 0; overflow: hidden; background: var(--panel-muted); }
    .placeholder { display: grid; place-items: center; height: 100%; padding: 24px; text-align: center; }
    .placeholder-inner { max-width: 420px; }
    .placeholder-icon {
      display: grid; place-items: center; width: 42px; height: 42px; margin: 0 auto 11px;
      border-radius: 12px; color: var(--brand); background: var(--brand-soft); font-size: 19px;
    }
    .placeholder h1 { margin: 0 0 6px; font-size: 17px; letter-spacing: -.02em; }
    .placeholder p { margin: 0 0 13px; color: var(--muted); font-size: 12.5px; line-height: 1.55; }
    .hint { margin-top: 10px; color: var(--text-faint); font-size: 10.5px; }
    kbd { padding: 1px 4px; border: 1px solid var(--kbd-line); border-radius: 4px; color: var(--text-soft); background: var(--kbd-bg); font-size: 10px; }

    .editor-wrap { height: 100%; background: var(--panel); }
    .editor-host { height: 100%; }
    /*
     * The editor's own structure (.cm-editor > .cm-scroller > .cm-content) is
     * deliberately not styled here. CodeMirror injects its base theme after
     * this stylesheet, one class more specific than a plain .cm-gutters rule,
     * so one written here would lose — the gutter renders light grey in dark
     * mode. The theme lives in src/editor.ts, where an extension is applied
     * above the base theme, and reads the tokens below.
     */

    .statusbar {
      display: flex; align-items: center; gap: 12px;
      height: var(--statusbar-height); padding: 0 14px;
      border-top: 1px solid var(--line); color: var(--muted); background: var(--panel); font-size: 10.5px;
    }
    .statusbar .status-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .statusbar strong { color: var(--text-soft); font-weight: 700; }

    /* Vault picker */

    .overlay {
      position: fixed; inset: 0; z-index: 6; display: grid; place-items: center;
      padding: 24px; background: var(--overlay);
    }
    .dialog {
      display: flex; flex-direction: column; width: min(660px, 100%); max-height: min(620px, 100%);
      overflow: hidden; border: 1px solid var(--line); border-radius: 14px; background: var(--panel);
      box-shadow: var(--shadow);
    }
    .dialog-header { padding: 15px 18px 11px; }
    .dialog-header h2 { margin: 0 0 5px; font-size: 15px; letter-spacing: -.02em; }
    .dialog-header p { margin: 0; color: var(--muted); font-size: 11.5px; line-height: 1.5; }
    .path-row { display: flex; gap: 7px; padding: 0 18px 9px; }
    .path-row .filter { flex: 1; font-family: "SFMono-Regular", Consolas, monospace; }
    .shortcuts { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 18px 9px; }
    .chip {
      padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px;
      color: var(--text-label); background: var(--panel-muted); font-size: 11.5px; font-weight: 600;
    }
    .chip:hover { border-color: var(--line-strong); background: var(--surface-raised); }
    /*
     * The list absorbs whatever the header and footer do not need, and is
     * allowed to shrink to nothing: it is the only flexible row in the dialog,
     * so a floor here is what pushes the footer past a short window's
     * max-height and clips Cancel and Use this folder off the bottom.
     */
    .dir-list { flex: 1; min-height: 0; margin: 0; padding: 3px 10px 9px; overflow-y: auto; list-style: none; border-top: 1px solid var(--line); }
    .dir-button {
      display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 9px;
      border: 0; border-radius: 6px; color: var(--text-body); background: transparent; text-align: left; font-size: 12px;
    }
    .dir-button:hover { background: var(--surface-hover); }
    .dir-glyph { display: grid; place-items: center; width: 12px; height: 12px; flex-shrink: 0; color: var(--muted); }
    .dialog-footer { padding: 10px 18px 13px; border-top: 1px solid var(--line); background: var(--panel-muted); }
    .browser-hint { margin-bottom: 9px; color: var(--muted); font-size: 11px; }
    .browser-hint.is-vault { color: var(--success); font-weight: 650; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 7px; }
    .recents { margin-top: 10px; }
    .recents-label { margin-bottom: 5px; color: var(--muted); font-size: 9.5px; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }

    .toast {
      position: fixed; right: 18px; bottom: 18px; z-index: 7; max-width: min(380px, calc(100vw - 36px));
      padding: 9px 12px; border: 1px solid var(--line); border-radius: 9px; color: var(--text); background: var(--toast-bg);
      box-shadow: var(--shadow); font-size: 12px; line-height: 1.4;
      overflow-wrap: anywhere;
      opacity: 0; pointer-events: none; transform: translateY(8px); transition: opacity .2s ease, transform .2s ease;
    }
    .toast.is-visible { opacity: 1; transform: translateY(0); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

    /*
     * Narrow windows (and every browser at phone width) turn the sidebar into
     * a slide-in drawer. It is the only way to pick a file, so it must stay
     * reachable rather than being hidden.
     */
    .scrim { position: fixed; inset: 0; z-index: 4; background: var(--overlay); }

    @media (max-width: 640px) {
      .app { grid-template-columns: 1fr; }
      /* One column here, so the workspace takes the only track. */
      .workspace { grid-column: 1; }
      /* The drawer overrides the collapsed state: at this width the sidebar is
         an overlay, so hiding it outright would strand the toggle. */
      .app.is-collapsed .sidebar { display: flex; }
      .sidebar {
        position: fixed; top: 0; bottom: 0; left: 0; z-index: 5;
        width: min(var(--sidebar-width), 84vw);
        transform: translateX(-100%);
        transition: transform .18s ease;
        display: flex;
        box-shadow: var(--shadow);
      }
      .sidebar.is-open { transform: translateX(0); }
      /* The drawer hides the brand row's toggle, so the tabbar keeps one. */
      .tabbar .sidebar-toggle { display: inline-flex; }
      /* The drawer is an overlay whose position is the state itself, so a
         resize handle on its edge would fight the slide-in. */
      .resizer { display: none; }
      /* The drawer overlays the workspace here, so the rows no longer have to
         line up — and a wrapping tab or status bar must be free to grow. */
      .brand, .tabbar { height: auto; min-height: var(--topbar-height); }
      .sidebar-status, .statusbar { height: auto; min-height: var(--statusbar-height); }
      .tabbar { flex-wrap: wrap; }
      .save-state { display: none; }
      .statusbar { flex-wrap: wrap; }
      /* The picker's own margin is generous on a desktop window and a large
         slice of a phone-width one, where it would otherwise cost the dialog
         both width and height. */
      .overlay { padding: 12px; }
    }
  </style>
  <script>
    /*
     * The palette is selected by an attribute on <html>, so something has to set
     * that before the stylesheet paints — otherwise a dark desktop gets a white
     * flash on every launch. This runs in the head, needs no bindings, and is
     * also the function the app calls when the preference or the OS changes: the
     * stored choice arrives baked into the tag by pageForTheme() in src/page.ts,
     * and a preference of system is resolved right here.
     */
    function applyAppearance(preference) {
      const resolved = preference === 'light' || preference === 'dark'
        ? preference
        : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.dataset.theme = resolved;
      // The browser's own chrome follows this meta, and a meta cannot read a
      // custom property, so the resolved value comes out of the stylesheet
      // rather than being written here a second time.
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        meta.content = getComputedStyle(document.documentElement)
          .getPropertyValue('--canvas').trim() || meta.content;
      }
      return resolved;
    }

    applyAppearance(document.documentElement.dataset.themePreference);
  </script>
</head>
<body>
  <main class="app" id="app">
    <aside class="sidebar">
      <div class="brand">
        <button class="button button-secondary icon-button sidebar-toggle" type="button" title="Hide vault files (Ctrl+B)" aria-label="Hide vault files" aria-expanded="true">${ICONS.sidebarToggle}</button>
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0.0 0.0 520.0 520.0" fill="none" xmlns="http://www.w3.org/2000/svg">
            <clipPath id="wazooMarkClip">
              <path d="m0 0l520.0 0l0 520.0l-520.0 0l0 -520.0z" clip-rule="nonzero" />
            </clipPath>
            <g clip-path="url(#wazooMarkClip)">
              <path fill="#ffe599" fill-rule="evenodd" d="m27.136568 315.49667l0 0c0.048236847 -153.1673 103.98497 -277.39838 232.36633 -277.73746c128.38138 -0.33907318 232.7781 123.34178 233.39474 276.5073l-232.87921 1.3345337z" />
              <path fill="#ffd966" fill-rule="evenodd" d="m77.505646 315.49313l0 0c0.03780365 -120.03879 81.49054 -217.39998 182.09991 -217.66571c100.609406 -0.26572418 182.4226 96.66425 182.90585 216.70166l-182.50183 1.0458374z" />
              <path fill="#f1c232" fill-rule="evenodd" d="m134.42595 315.52817l0 0c0.026016235 -82.60426 56.077927 -149.60301 125.312546 -149.78587c69.23459 -0.18284607 125.53458 66.519165 125.867096 149.12245l-125.58908 0.71969604z" />
              <path fill="#ff9800" fill-rule="evenodd" d="m202.39597 327.73157l0 0c0 -83.25229 25.789383 -150.7416 57.602203 -150.7416l0 0c15.277069 0 29.928406 15.881668 40.730896 44.151184c10.802521 28.269531 16.871307 66.61125 16.871307 106.59041l0 0c0 83.25226 -25.789398 150.74158 -57.602203 150.74158l0 0c-31.81282 0 -57.602203 -67.48932 -57.602203 -150.74158z" />
              <path fill="#ff9800" fill-rule="evenodd" d="m390.45502 296.24957l0 0c0 -83.25229 25.789368 -150.74158 57.602203 -150.74158l0 0c15.277039 0 29.928406 15.881653 40.730896 44.151184c10.802521 28.269516 16.871307 66.61124 16.871307 106.59039l0 0c0 83.25226 -25.789398 150.74158 -57.602203 150.74158l0 0c-31.812836 0 -57.602203 -67.48932 -57.602203 -150.74158z" />
              <path fill="#ff9800" fill-rule="evenodd" d="m14.339688 296.24957l0 0c0 -83.25229 25.789387 -150.74158 57.6022 -150.74158l0 0c15.277054 0 29.928406 15.881653 40.73091 44.151184c10.8025055 28.269516 16.8713 66.61124 16.8713 106.59039l0 0c0 83.25226 -25.78939 150.74158 -57.60221 150.74158l0 0c-31.812813 0 -57.6022 -67.48932 -57.6022 -150.74158z" />
              <path fill="#ff9800" fill-rule="evenodd" d="m505.64868 305.6166l0 0c-0.12124634 67.46524 -109.278656 122.224335 -244.35449 122.581085c-135.0758 0.3567505 -245.3866 -53.822754 -246.93633 -121.28354l245.63737 -1.4076538z" />
            </g>
          </svg>
        </div>
        <div>
          <div class="brand-name">Wazoo Wiki</div>
          <div class="brand-subtitle">Desktop editor</div>
        </div>
      </div>

      <section class="vault" aria-label="Vault">
        <div class="vault-head" id="vaultHead">
          <span class="vault-label">Vault</span>
          <span class="vault-name is-placeholder" id="vaultName">No vault open</span>
          <div class="vault-actions">
            <button class="button button-secondary icon-button" id="openVaultButton" type="button" title="Open a vault" aria-label="Open a vault">${ICONS.openVault}</button>
          </div>
        </div>
        <div class="vault-path" id="vaultPath">Choose the folder that holds your wiki.</div>
      </section>

      <div class="file-tools" id="fileTools">
        <label class="sr-only" for="filter">Filter files</label>
        <input class="filter" id="filter" type="search" placeholder="Filter files" autocomplete="off" />
        <div class="file-tools-checks">
          <label class="assets-toggle" id="assetsToggle" title="List the vault's static files too" hidden>
            <input type="checkbox" id="showAssets" />Assets
          </label>
          <label class="assets-toggle" id="extensionsToggle" title="Write each file's extension out in full">
            <input type="checkbox" id="showExtensions" checked />Extensions
          </label>
        </div>
        <button class="button button-secondary icon-button" id="newFileButton" type="button" title="New file (Ctrl+N)" aria-label="New file" disabled>${ICONS.newFile}</button>
      </div>

      <ul class="file-list" id="fileList" aria-label="Vault files"></ul>
      <div class="sidebar-status">
        <span id="fileCount">No vault open</span>
        <span class="transport" id="transportBadge" hidden>Browser dev mode</span>
      </div>
      <div class="resizer" id="sidebarResizer" role="separator" aria-orientation="vertical"
           aria-label="Resize the vault sidebar" aria-controls="fileList"
           aria-valuemin="${SIDEBAR_MIN_WIDTH}" aria-valuemax="${SIDEBAR_MAX_WIDTH}" aria-valuenow="${DEFAULT_SIDEBAR_WIDTH}"
           title="Drag to resize, double-click to reset" tabindex="0"></div>
    </aside>

    <section class="workspace">
      <header class="tabbar">
        <button class="button button-secondary icon-button sidebar-toggle" type="button" title="Show vault files (Ctrl+B)" aria-label="Show vault files" aria-expanded="false">${ICONS.sidebarToggle}</button>
        <div class="tabs" id="tabs" role="tablist" aria-label="Open files"></div>
        <div class="file-actions">
          <!--
            The bar carries the open document's actions, not the inventory of
            every command. Save — the one action a wiki editor reaches for while
            typing — is the only one that keeps a word; reloading from disk is
            the same kind of action but the rarer one, so it keeps a glyph and
            sits next to the menu, which is where the rarer commands live. New
            stays in the menu (Ctrl+N) and the + beside the file list.

            Both are also reachable from the menu; the word "Reload" exists
            nowhere in the bar.
          -->
          <span class="save-state" id="saveState">Ready</span>
          <button class="button button-primary" id="saveButton" type="button" disabled>Save</button>
          <button class="button button-secondary icon-button" id="reloadButton" type="button" title="Reload from disk" aria-label="Reload from disk" disabled>${ICONS.reload}</button>
          <button class="button button-secondary icon-button menu-button" id="menuButton" type="button" title="Menu" aria-label="Menu" aria-haspopup="menu" aria-expanded="false" aria-controls="commandMenu">${ICONS.menu}</button>
          <div class="menu-popup" id="commandMenu" role="menu" aria-labelledby="menuButton" hidden></div>
        </div>
      </header>

      <div class="editor-region">
        <!--
          There is no "no vault" panel here. It used to sit here with a button
          whose only job was to open the folder dialog, so the app had two
          surfaces for one action and the first click bought nothing. The
          dialog is the app's way in instead: it opens by itself when there is
          no vault, and it is the same dialog the sidebar's button opens when
          there is one.
        -->

        <div class="placeholder" id="placeholderNoFile" hidden>
          <div class="placeholder-inner">
            <div class="placeholder-icon" aria-hidden="true">${ICONS.noFile}</div>
            <h1>Select a file</h1>
            <p id="placeholderNoFileText">Pick a file from the sidebar to open it in a tab.</p>
            <button class="button button-primary" id="emptyNewFileButton" type="button">New file</button>
            <div class="hint"><kbd>Ctrl</kbd> <kbd>N</kbd> makes a file · <kbd>Ctrl</kbd> <kbd>W</kbd> closes a tab · <kbd>Ctrl</kbd> <kbd>Tab</kbd> switches</div>
          </div>
        </div>

        <div class="editor-wrap" id="editorWrap" hidden>
          <div class="editor-host" id="editor"></div>
        </div>
      </div>

      <footer class="statusbar">
        <span class="status-path" id="statusPath">No file open</span>
        <span id="characterCount">0 characters</span>
        <span id="lineCount">0 lines</span>
        <span id="cursorPosition">Ln 1, Col 1</span>
      </footer>
    </section>
  </main>

  <div class="scrim" id="sidebarScrim" hidden></div>

  <div class="overlay" id="browserOverlay" hidden>
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="browserTitle">
      <div class="dialog-header">
        <h2 id="browserTitle">Open a vault</h2>
        <p id="browserIntro">Browse to the folder you want to work in, then choose it. deno desktop has no native folder picker yet, so this dialog stands in for one — paste a path if you would rather navigate that way.</p>
      </div>
      <div class="path-row">
        <button class="button button-secondary" id="upButton" type="button">Up</button>
        <label class="sr-only" for="browserPath">Folder path</label>
        <input class="filter" id="browserPath" spellcheck="false" autocomplete="off" />
        <button class="button button-secondary" id="goButton" type="button">Go</button>
      </div>
      <div class="shortcuts" id="shortcutRow"></div>
      <ul class="dir-list" id="dirList"></ul>
      <div class="dialog-footer">
        <div class="browser-hint" id="browserHint"></div>
        <div class="dialog-actions">
          <button class="button button-secondary" id="cancelBrowseButton" type="button">Cancel</button>
          <button class="button button-primary" id="useFolderButton" type="button">Use this folder</button>
        </div>
        <div class="recents" id="recents" hidden>
          <div class="recents-label">Recent vaults</div>
          <div class="shortcuts" id="recentRow"></div>
        </div>
      </div>
    </div>
  </div>

  <!--
    The vault header's own menu, for the things you can do to the vault rather
    than to the page. It ships empty and is filled from the command list, like
    the app menu, so an action is written down once: the item here and the
    entry in the app menu are the same command, and only the run path can
    change.

    It lives outside the sidebar because the drawer is a transformed element,
    and a transformed ancestor becomes the containing block for anything
    position: fixed inside it -- which would put this menu at window
    coordinates relative to a panel that may be off screen.
  -->
  <div class="menu-popup vault-menu" id="vaultMenu" role="menu" aria-label="Vault actions" hidden></div>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  <!--
    The editor, bundled from src/editor.ts by the build:editor task and served
    from memory by both transports. A classic script, so it runs before the
    inline one below and the page finds the factory on the global object.
  -->
  <script src="/editor.js"></script>
  <script>
    (() => {
      const NL = String.fromCharCode(10);
      // The desktop runtime injects the bindings proxy. When this page is
      // served to a normal browser instead (src/dev_server.ts), the same
      // operations arrive over HTTP, so the UI needs no other awareness of
      // where it is running.
      const bridge = window.bindings || browserBridge();

      function browserBridge() {
        return new Proxy({}, {
          get: (_, name) => (...args) => request(String(name), args),
        });
      }

      async function request(name, args) {
        const response = await fetch('/api/' + name, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(args),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw (payload && payload.message) ? payload : { message: 'The dev server did not answer.' };
        }
        return payload;
      }

      const el = (id) => document.getElementById(id);
      const shell = el('app');
      const editorHost = el('editor');
      const editorWrap = el('editorWrap');
      const placeholderNoFile = el('placeholderNoFile');
      const placeholderNoFileText = el('placeholderNoFileText');
      const tabsEl = el('tabs');
      const saveState = el('saveState');
      const saveButton = el('saveButton');
      const reloadButton = el('reloadButton');
      const menuButton = el('menuButton');
      const commandMenu = el('commandMenu');
      const newFileButton = el('newFileButton');
      const openVaultButton = el('openVaultButton');
      const emptyNewFileButton = el('emptyNewFileButton');
      const vaultName = el('vaultName');
      const fileTools = el('fileTools');
      const vaultPath = el('vaultPath');
      const filterInput = el('filter');
      const assetsToggle = el('assetsToggle');
      const showAssetsInput = el('showAssets');
      const extensionsInput = el('showExtensions');
      const fileList = el('fileList');
      const fileCount = el('fileCount');
      const statusPath = el('statusPath');
      const characterCount = el('characterCount');
      const lineCount = el('lineCount');
      const cursorPosition = el('cursorPosition');
      const toast = el('toast');
      const overlay = el('browserOverlay');
      const browserTitle = el('browserTitle');
      const browserIntro = el('browserIntro');
      const browserPath = el('browserPath');
      const upButton = el('upButton');
      const goButton = el('goButton');
      const shortcutRow = el('shortcutRow');
      const dirList = el('dirList');
      const browserHint = el('browserHint');
      const useFolderButton = el('useFolderButton');
      const cancelBrowseButton = el('cancelBrowseButton');
      const recents = el('recents');
      const recentRow = el('recentRow');
      const sidebar = document.querySelector('.sidebar');
      const sidebarResizer = el('sidebarResizer');
      const vaultHead = el('vaultHead');
      const vaultMenu = el('vaultMenu');
      const sidebarScrim = el('sidebarScrim');
      // One action, two affordances: the brand row's while the sidebar is
      // showing, the tabbar's once it is collapsed, so the control stays in the
      // window's top-left corner either way. Only one is ever displayed.
      const sidebarToggles = document.querySelectorAll('.sidebar-toggle');

      // Below this width the sidebar is a drawer rather than a column, so the
      // same button means "slide it in" instead of "collapse the column".
      const narrowWindow = window.matchMedia('(max-width: 640px)');

      // The editor keeps each open document's own state, so the page only has
      // to name which one is on screen. Everything it needs is this handle:
      // the tab strip, dirty state, and Save stay exactly as they were.
      const editorApi = window.WikiEditor
        ? window.WikiEditor.create({
            container: editorHost,
            onChange: onEditorChange,
            onFollowLink: followLink,
          })
        : null;
      if (editorApi === null) {
        showToast('The editor failed to load. Reload the window to retry.');
      }

      /** The active document's text, or empty when there is no editor at all. */
      function editorValue() {
        return editorApi === null ? '' : editorApi.getValue();
      }

      /**
       * Any edit or cursor move: the tab's buffer, the dirty dot, and the
       * status line all follow from the document, so one handler covers them.
       */
      function onEditorChange() {
        const tab = activeTab();
        if (tab !== null) tab.content = editorValue();
        markActiveTab();
        updateStatus();
      }

      let vault = {
        root: null,
        name: null,
        recents: [],
        sidebarCollapsed: false,
        showExtensions: true,
        sidebarWidth: ${DEFAULT_SIDEBAR_WIDTH},
        theme: '${DEFAULT_THEME}',
      };
      let files = [];
      let listing = null;
      let toastTimer;

      // Open buffers. Each tab keeps its own text so switching never loses an
      // edit, and unsaved state is "content differs from what is on disk".
      let tabs = [];
      let activeIndex = -1;

      function activeTab() {
        return activeIndex >= 0 && activeIndex < tabs.length ? tabs[activeIndex] : null;
      }

      function tabIsDirty(tab) {
        return tab.content !== tab.saved;
      }

      function anyDirty() {
        return tabs.some(tabIsDirty);
      }

      function baseName(path) {
        const separator = path.lastIndexOf('/');
        return separator === -1 ? path : path.slice(separator + 1);
      }

      function showToast(message) {
        toast.textContent = message;
        toast.classList.add('is-visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 4000);
      }

      // Every call into Deno goes through here so failures surface as a toast
      // and the caller can just check for null.
      async function call(name, args) {
        try {
          // A spread, never bridge[name].apply(null, args). The desktop runtime
          // hands the webview a proxy whose property access IS the binding
          // name, so reading .apply off the function it returns asks for a
          // binding called "getState.apply" and the call is refused: every
          // operation in the app failed, and the window sat on the empty state
          // toasting No binding for 'browse.apply'. The browser bridge returns
          // a plain function, so the dev server and the string tests saw
          // nothing wrong, and src/appearance_check.ts stubs the bindings
          // outright, so the one check that runs in the real webview could not
          // see it either. Found by calling one binding three ways in the real
          // desktop runtime; both a direct call and a spread work.
          return await bridge[name](...(args || []));
        } catch (error) {
          showToast((error && error.message) || 'Something went wrong.');
          return null;
        }
      }

      /* Sidebar: collapsing a column on wide windows, a drawer on narrow ones */

      function setSidebarOpen(open) {
        sidebar.classList.toggle('is-open', open);
        sidebarScrim.hidden = !open;
        syncSidebarToggles();
      }

      function isSidebarOpen() {
        return sidebar.classList.contains('is-open');
      }

      function isSidebarCollapsed() {
        return shell.classList.contains('is-collapsed');
      }

      /**
       * Both affordances describe one state, and which state that is depends on
       * the layout: a collapsed column on wide windows, an open drawer on
       * narrow ones. Deriving the wording here keeps the labels honest — the
       * drawer also closes on every file open, which must not make the brand
       * toggle claim the sidebar is hidden.
       *
       * The tooltip is written here too, not only in the markup, because that
       * is the one of the two a mouse user reads: the buttons shipped with the
       * wording each layout starts in, so after the first collapse the brand
       * toggle's tooltip still said "Hide vault files" while the control beside
       * it said "Show".
       */
      function syncSidebarToggles() {
        const showing = narrowWindow.matches
          ? isSidebarOpen()
          : !isSidebarCollapsed();
        const label = showing ? 'Hide vault files' : 'Show vault files';
        for (const toggle of sidebarToggles) {
          toggle.setAttribute('aria-expanded', String(showing));
          toggle.setAttribute('aria-label', label);
          toggle.title = label + ' (Ctrl+B)';
        }
      }

      /**
       * Hide or show the sidebar column. The choice outlives the window, so it
       * is written to the app config unless this is just applying stored state.
       */
      function setSidebarCollapsed(collapsed, persist) {
        shell.classList.toggle('is-collapsed', collapsed);
        syncSidebarToggles();
        vault.sidebarCollapsed = collapsed;
        if (persist) call('setSidebarCollapsed', [collapsed]);
      }

      /**
       * Whether the list shows each file's extension. Turned off, the extension
       * is hidden here and shown only where a name is being typed — the New
       * file prompt, which has to carry the real name regardless. The tab strip
       * and the status bar keep it, because a tab is the document's identity
       * rather than one entry in a list of similar names.
       */
      function setShowExtensions(show, persist) {
        vault.showExtensions = show;
        if (persist) call('setShowExtensions', [show]);
        extensionsInput.checked = show;
        renderFiles();
        refreshMenu();
      }

      /** The name as the list draws it, which may be without its extension. */
      function listedName(file) {
        if (vault.showExtensions || !file.isMarkdown) return file.name;
        // Only Markdown loses its extension: every page in a wiki is one, so it
        // is the repetition that is noise. A vault's own .py and .yml files are
        // few, and dropping theirs would make two different files look alike.
        //
        // Written without a regex on purpose. This script ships inside a
        // template literal, where a backslash is an escape sequence, so a
        // /\.md$ reached the browser as /.md$/ — whose dot matches any
        // character — and a page called cmd lost its last letter.
        return file.name.toLowerCase().endsWith('.md')
          ? file.name.slice(0, -3)
          : file.name;
      }

      /* Sidebar width */

      // The editor needs room for a readable line, so the column gives up space
      // before the workspace does on a narrow window.
      const WORKSPACE_FLOOR = 360;

      function widestSidebarThatFits() {
        return Math.max(
          ${SIDEBAR_MIN_WIDTH},
          Math.min(${SIDEBAR_MAX_WIDTH}, window.innerWidth - WORKSPACE_FLOOR),
        );
      }

      function clampSidebarWidth(width) {
        // A value the transport never sent must not collapse the layout, so a
        // non-number falls back to the default rather than propagating NaN.
        const wanted = Number.isFinite(width) ? width : ${DEFAULT_SIDEBAR_WIDTH};
        return Math.round(
          Math.max(${SIDEBAR_MIN_WIDTH}, Math.min(widestSidebarThatFits(), wanted)),
        );
      }

      /**
       * The stored width is what the user chose; the applied width is that
       * choice clamped to what this window can afford. Keeping them apart means
       * shrinking the window squeezes the column instead of swallowing the
       * editor, and growing it puts the chosen width back.
       */
      function applySidebarWidth() {
        const width = clampSidebarWidth(vault.sidebarWidth);
        document.documentElement.style.setProperty('--sidebar-width', width + 'px');
        sidebarResizer.setAttribute('aria-valuenow', String(width));
        sidebarResizer.setAttribute('aria-valuemax', String(widestSidebarThatFits()));
        return width;
      }

      function setSidebarWidth(width, persist) {
        vault.sidebarWidth = clampSidebarWidth(width);
        applySidebarWidth();
        if (persist) call('setSidebarWidth', [vault.sidebarWidth]);
      }

      /* Tabs */

      /** Closing every buffer — a vault switch — drops the editor's states too. */
      function discardAllTabs() {
        for (const tab of tabs) editorApi?.forgetDocument(tab.path);
        tabs = [];
        activeIndex = -1;
      }

      // The editor holds each document's own state, including its cursor and
      // scroll position, so stashing is only about the buffer's text.
      function stashCursor() {
        const tab = activeTab();
        if (tab === null) return;
        tab.content = editorValue();
      }

      function loadActiveIntoEditor() {
        const tab = activeTab();
        if (tab === null || editorApi === null) {
          renderTabs();
          showPlaceholder();
          return;
        }
        editorApi.showDocument(tab.path, tab.content);
        showEditor();
        editorApi.focus();
        renderTabs();
      }

      function renderTabs() {
        tabsEl.textContent = '';
        tabs.forEach((tab, index) => {
          const element = document.createElement('div');
          element.className = 'tab';
          if (index === activeIndex) element.classList.add('is-active');
          if (tabIsDirty(tab)) element.classList.add('is-dirty');
          element.setAttribute('role', 'tab');
          element.setAttribute('aria-selected', String(index === activeIndex));
          element.tabIndex = index === activeIndex ? 0 : -1;
          element.title = tab.path;

          const state = document.createElement('span');
          state.className = 'tab-state';
          state.setAttribute('aria-hidden', 'true');

          const name = document.createElement('span');
          name.className = 'tab-name';
          name.textContent = tab.name;

          const close = document.createElement('button');
          close.type = 'button';
          close.className = 'tab-close';
          close.innerHTML = '${ICONS.closeTab}';
          close.title = 'Close ' + tab.name + ' (Ctrl+W)';
          close.setAttribute('aria-label', 'Close ' + tab.name);
          close.addEventListener('click', (event) => {
            event.stopPropagation();
            closeTab(index);
          });

          element.appendChild(state);
          element.appendChild(name);
          element.appendChild(close);
          element.addEventListener('click', () => selectTab(index));
          element.addEventListener('auxclick', (event) => {
            if (event.button === 1) {
              event.preventDefault();
              closeTab(index);
            }
          });
          element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              selectTab(index);
            }
          });
          tabsEl.appendChild(element);
        });

        // Keep the active tab in view when the strip overflows.
        const active = tabsEl.children[activeIndex];
        if (active && active.scrollIntoView) {
          active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }

      // Cheap update for the per-keystroke path: the DOM is already built, only
      // the dirty marker can have changed.
      function markActiveTab() {
        const element = tabsEl.children[activeIndex];
        const tab = activeTab();
        if (element && tab) element.classList.toggle('is-dirty', tabIsDirty(tab));
      }

      function selectTab(index) {
        if (index === activeIndex || index < 0 || index >= tabs.length) return;
        stashCursor();
        activeIndex = index;
        loadActiveIntoEditor();
        updateStatus();
        renderFiles();
      }

      function openPayload(payload) {
        const existing = tabs.findIndex((tab) => tab.path === payload.path);
        if (existing !== -1) {
          stashCursor();
          activeIndex = existing;
        } else {
          stashCursor();
          tabs.push({
            path: payload.path,
            name: baseName(payload.path),
            content: payload.content,
            saved: payload.content,
          });
          activeIndex = tabs.length - 1;
        }
        loadActiveIntoEditor();
        updateStatus();
        renderFiles();
      }

      async function openFile(path) {
        setSidebarOpen(false);
        const existing = tabs.findIndex((tab) => tab.path === path);
        if (existing !== -1) {
          selectTab(existing);
          return;
        }
        const payload = await call('readFile', [path]);
        if (payload === null) return;
        openPayload(payload);
      }

      /**
       * Ctrl/Cmd+click landed on a link, already resolved by the editor
       * against the document that is showing. What to do about it is here,
       * because this is what knows the vault and the folder browser.
       *
       * A target that is not in the vault falls through to the folder browser
       * at the folder it named, rather than doing nothing: a link that looks
       * live and silently does nothing is the failure mode worth avoiding, and
       * the picker is already the app's way of finding a file.
       *
       * Measured, and worth recording because it looks like the opposite: the
       * vault has no dead links at all. A text search reports six, every one
       * of them inside a code span, written as example syntax rather than as
       * a link. Read through the parser they are links nowhere. So this path
       * is reachable only by a link someone is still typing, which is exactly
       * when a folder to look in beats a dead click.
       *
       * (No backticks in this comment: the page script is one template
       * literal, and a backtick in prose here closes the string outright.)
       */
      async function followLink(target) {
        if (target.kind === 'external') {
          // window.open rather than a new binding: the app runs without
          // --allow-run, so handing a URL to the OS would mean granting a
          // permission to every task to shell out per platform. In the browser
          // dev target this is exactly right; in the desktop webview it opens
          // a window rather than the system browser, which is the limit worth
          // naming rather than the reason to add the permission here.
          window.open(target.url, '_blank', 'noopener');
          return;
        }
        if (target.kind === 'none') {
          showToast('That link does not point anywhere yet.');
          return;
        }
        if (target.kind === 'anchor') {
          // The page is already open, so this is the one gesture with nothing
          // to open. Jumping to the heading needs an editor handle the app
          // does not have yet; saying so beats a click that appears broken.
          showToast('Jumping to a heading is not built yet — this page is already open.');
          return;
        }
        const exists = files.some((file) => file.path === target.path);
        if (exists) {
          await openFile(target.path);
          return;
        }
        const cut = target.path.lastIndexOf('/');
        openBrowser();
        await browseTo(cut === -1 ? '' : target.path.slice(0, cut));
      }

      function closeTab(index) {
        const tab = tabs[index];
        if (tab === undefined) return;
        if (tabIsDirty(tab)) {
          const keep = window.confirm('Discard unsaved changes to ' + tab.path + '?');
          if (!keep) return;
        }
        const wasActive = index === activeIndex;
        editorApi?.forgetDocument(tab.path);
        tabs.splice(index, 1);
        if (tabs.length === 0) {
          activeIndex = -1;
        } else if (wasActive) {
          activeIndex = Math.min(index, tabs.length - 1);
        } else if (index < activeIndex) {
          activeIndex -= 1;
        }
        if (wasActive || tabs.length === 0) {
          loadActiveIntoEditor();
        } else {
          renderTabs();
        }
        updateStatus();
        renderFiles();
      }

      /** The page owns this wording: only it knows how many buffers are open. */
      function confirmDiscardAll() {
        const dirty = tabs.filter(tabIsDirty);
        if (dirty.length === 0) return true;
        return window.confirm(
          dirty.length === 1
            ? 'Discard unsaved changes to ' + dirty[0].path + '?'
            : 'Discard unsaved changes to ' + dirty.length + ' files?',
        );
      }

      window.wikiEditorHasUnsavedChanges = anyDirty;
      window.wikiEditorConfirmDiscard = confirmDiscardAll;

      function updateStatus() {
        const tab = activeTab();
        const contents = tab === null ? '' : editorValue();
        const lines = contents ? contents.split(NL).length : 0;
        characterCount.textContent = contents.length.toLocaleString() +
          (contents.length === 1 ? ' character' : ' characters');
        lineCount.textContent = lines.toLocaleString() + (lines === 1 ? ' line' : ' lines');
        if (tab !== null) {
          // A bundle that failed to load still has tabs; it just has no
          // cursor to report.
          const cursor = editorApi === null ? 0 : editorApi.getCursor();
          const beforeCursor = contents.slice(0, cursor);
          const currentLine = beforeCursor.split(NL);
          cursorPosition.textContent = 'Ln ' + currentLine.length + ', Col ' +
            (currentLine[currentLine.length - 1].length + 1);
          statusPath.textContent = tab.path;
          statusPath.title = tab.path;
        } else {
          cursorPosition.textContent = 'Ln 1, Col 1';
          statusPath.textContent = 'No file open';
          statusPath.title = '';
        }
        const dirty = tab !== null && tabIsDirty(tab);
        saveState.textContent = tab === null
          ? 'Ready'
          : dirty
          ? 'Unsaved changes'
          : 'Saved';
        saveState.classList.toggle('is-dirty', dirty);
        saveState.classList.toggle('is-saved', tab !== null && !dirty);
        saveButton.disabled = tab === null;
        reloadButton.disabled = tab === null;
        refreshMenu();
      }

      function renderVault() {
        const open = vault.root !== null;
        vaultName.textContent = vault.name || 'No vault open';
        vaultName.classList.toggle('is-placeholder', !open);
        vaultPath.textContent = open ? vault.root : 'Choose the folder that holds your wiki.';
        vaultPath.title = vault.root || '';
        // Hidden rather than removed, because the same row is the guidance
        // that tells an unopened vault what Open vault is for.
        vaultPath.hidden = open;
        // With a vault open the same button switches it, so its name has to
        // change with the state it acts on rather than describing neither.
        openVaultButton.title = open ? 'Open another vault' : 'Open a vault';
        openVaultButton.setAttribute('aria-label', open ? 'Open another vault' : 'Open a vault');
        // The list empties with the vault, so the row that filters and creates
        // from it has nothing to act on and goes with it.
        fileTools.hidden = !open;
        newFileButton.disabled = !open;
        refreshMenu();
      }

      function renderFiles() {
        // The vault's own config says which files are the wiki's pages. Its
        // static files are one tick away by default, because a build output
        // folder beside 400 pages is not what a wiki looks like.
        const hasAssets = files.some((file) => file.scope === 'asset');
        assetsToggle.hidden = !hasAssets;
        // An empty vault should not leave a checkbox ticking nothing.
        if (!hasAssets) showAssetsInput.checked = false;
        const listed = showAssetsInput.checked
          ? files
          : files.filter((file) => file.scope !== 'asset');
        const query = filterInput.value.trim().toLowerCase();
        const visible = query
          ? listed.filter((file) => file.path.toLowerCase().indexOf(query) !== -1)
          : listed;
        const openPaths = new Set(tabs.map((tab) => tab.path));
        const active = activeTab();
        fileList.textContent = '';
        if (vault.root === null) {
          fileCount.textContent = 'No vault open';
        } else if (visible.length === 0) {
          fileCount.textContent = listed.length === 0
            ? 'No files in this vault'
            : 'No files match "' + filterInput.value.trim() + '"';
          const empty = document.createElement('li');
          empty.className = 'file-empty';
          empty.textContent = listed.length === 0
            ? 'This folder has no files yet. Create one with New.'
            : 'Try a different filter.';
          fileList.appendChild(empty);
        } else {
          fileCount.textContent = visible.length +
            (visible.length === 1 ? ' file' : ' files') +
            (visible.length === listed.length ? '' : ' of ' + listed.length);
        }

        for (const file of visible) {
          const item = document.createElement('li');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'file-button';
          if (active !== null && active.path === file.path) {
            button.classList.add('is-active');
            // Which page the editor is showing was brand-coloured and bold and
            // nothing else, so a reader using a screen reader could not tell
            // where they were in a list of a hundred similar names.
            button.setAttribute('aria-current', 'true');
          } else if (openPaths.has(file.path)) button.classList.add('is-open');
          if (file.scope === 'asset') button.classList.add('is-asset');
          const name = document.createElement('span');
          name.className = 'file-name';
          name.textContent = listedName(file);
          // The row is named by what it draws, so a screen reader hears the
          // same thing the eye does — and the title still carries the path.
          button.title = file.path;
          button.appendChild(name);
          const separator = file.path.lastIndexOf('/');
          if (separator !== -1) {
            const dir = document.createElement('span');
            dir.className = 'file-dir';
            dir.textContent = file.path.slice(0, separator);
            button.appendChild(dir);
          } else if (file.isMarkdown) {
            const dir = document.createElement('span');
            dir.className = 'file-dir';
            dir.textContent = 'Markdown';
            button.appendChild(dir);
          }
          // An asset is dimmed, which is a distinction the eye can see and a
          // screen reader cannot: the row said only its name, so a build output
          // file and a page of the wiki announced identically. Said once, in
          // the row's own words, rather than in an aria-label that would
          // replace the visible name and break voice control.
          if (file.scope === 'asset') {
            const kind = document.createElement('span');
            kind.className = 'sr-only';
            kind.textContent = 'static file';
            button.appendChild(kind);
          }
          button.addEventListener('click', () => openFile(file.path));
          item.appendChild(button);
          fileList.appendChild(item);
        }

        if (placeholderNoFile.hidden === false) {
          placeholderNoFileText.textContent = visible.length === 0
            ? 'This vault has no files yet.'
            : 'Pick a file from the sidebar to open it in a tab.';
        }
      }

      function showEditor() {
        placeholderNoFile.hidden = true;
        editorWrap.hidden = false;
      }

      function showPlaceholder() {
        const hasTab = activeTab() !== null;
        // The editor is hidden while the placeholder stands in for it, and
        // shown again the moment a tab exists. With no vault open there is
        // nothing to stand in for it either: the folder dialog is up, and it
        // is the app until a vault is chosen.
        editorWrap.hidden = !hasTab;
        placeholderNoFile.hidden = vault.root === null || hasTab;
        emptyNewFileButton.hidden = vault.root === null;
      }

      async function loadFiles() {
        if (vault.root === null) {
          files = [];
          renderFiles();
          return;
        }
        const result = await call('listFiles');
        if (result === null) return;
        files = result;
        renderFiles();
      }

      async function saveFile() {
        const tab = activeTab();
        if (tab === null) return;
        const content = editorValue();
        const payload = await call('writeFile', [tab.path, content]);
        if (payload === null) return;
        // What comes back is the document text, not the bytes on disk: a CRLF
        // file is written as CRLF while the buffer stays LF. Marking the
        // buffer clean against the file's own bytes would read as a dirty file
        // on the next keystroke, which is the bug this line used to contain.
        tab.saved = payload.content;
        tab.content = payload.content;
        renderTabs();
        updateStatus();
        showToast('Saved ' + payload.path);
      }

      async function reloadFile() {
        const tab = activeTab();
        if (tab === null) return;
        if (tabIsDirty(tab)) {
          const go = window.confirm('Discard unsaved changes to ' + tab.path + '?');
          if (!go) return;
        }
        const payload = await call('readFile', [tab.path]);
        if (payload === null) return;
        tab.content = payload.content;
        tab.saved = payload.content;
        loadActiveIntoEditor();
        updateStatus();
        showToast('Reloaded ' + payload.path + ' from disk');
      }

      async function createFile() {
        if (vault.root === null) return;
        const suggested = 'notes/untitled.md';
        const name = window.prompt('New file, relative to the vault root:', suggested);
        if (name === null) return;
        const trimmed = name.trim();
        if (trimmed === '') return;
        const payload = await call('createFile', [trimmed, '']);
        if (payload === null) return;
        await loadFiles();
        openPayload(payload);
        showToast('Created ' + payload.path);
      }

      /* Appearance */

      // The OS is the source of truth only while the preference says so. A
      // media-query stylesheet would follow it for free, but an attribute
      // cannot, so the flip is heard here instead.
      const systemAppearance = window.matchMedia('(prefers-color-scheme: dark)');
      systemAppearance.addEventListener('change', () => {
        if (vault.theme === 'system') applyAppearance('system');
      });

      /**
       * Show one appearance, and remember it unless this is stored state being
       * applied. The attribute is written in exactly one place — applyAppearance
       * in the head, before the first paint — so the head script, this, and the
       * OS listener cannot disagree about which mode is on.
       */
      function setTheme(preference, persist) {
        vault.theme = preference === 'light' || preference === 'dark'
          ? preference
          : 'system';
        applyAppearance(vault.theme);
        if (persist) call('setTheme', [vault.theme]);
        refreshMenu();
      }

      function applyState(state) {
        vault = state;
        setTheme(state.theme, false);
        setSidebarCollapsed(state.sidebarCollapsed === true, false);
        extensionsInput.checked = state.showExtensions !== false;
        applySidebarWidth();
        renderVault();
        renderFiles();
        showPlaceholder();
      }

      async function init() {
        const state = await call('getState');
        if (state !== null) applyState(state);
        if (vault.root !== null) await loadFiles();
        showPlaceholder();
        renderTabs();
        // With no vault the dialog is the app, so it opens itself rather than
        // waiting behind a panel whose only button opens it.
        if (vault.root === null) openBrowser();
      }

      async function switchVault(path) {
        if (!confirmDiscardAll()) return;
        const state = await call('openVault', [path]);
        if (state === null) return;
        // The unconditional hide: the guard in closeBrowser reads the state as
        // it was, and choosing a folder is how a user with no vault gets one.
        hideBrowser();
        discardAllTabs();
        applyState(state);
        renderTabs();
        updateStatus();
        await loadFiles();
        showPlaceholder();
        showToast('Vault: ' + state.root);
      }

      async function closeVault() {
        if (!confirmDiscardAll()) return;
        const state = await call('closeVault');
        if (state === null) return;
        discardAllTabs();
        applyState(state);
        renderTabs();
        updateStatus();
        // The listing belongs to the vault that just closed, so it goes with
        // it. loadFiles is what clears it — renderFiles would redraw the old
        // file list over an app that now has no vault at all. switchVault
        // reloads the same way for the same reason.
        await loadFiles();
        // Closing returns to the dialog the app opened on, rather than to a
        // panel with a button that opens it: one surface for one action, and
        // the recents are the first thing in it.
        openBrowser();
      }

      // Vault picker

      /**
       * The dialog off the screen, for the paths that have a reason to put it
       * there: a vault was opened, or the user cancelled a switch.
       */
      function hideBrowser() {
        overlay.hidden = true;
        listing = null;
      }

      function closeBrowser() {
        // With no vault open this dialog is the app, so there is nothing to
        // go back to and dismissing it would leave a window with no way to
        // work in it. Cancel is hidden for the same reason, which makes this
        // guard the last line rather than the only one — opening a vault from
        // here goes through hideBrowser, because that is the one action that
        // takes the user past it.
        if (vault.root === null) return;
        hideBrowser();
      }

      async function browseTo(path) {
        const result = await call('browse', [path === undefined ? null : path]);
        if (result === null) return;
        listing = result;
        browserPath.value = result.path;
        upButton.disabled = result.parent === null;
        browserHint.textContent = result.looksLikeWiki
          ? 'This folder looks like a wiki.'
          : 'Tip: a folder holding wiki.yaml or Markdown files is probably your vault.';
        browserHint.classList.toggle('is-vault', result.looksLikeWiki);

        shortcutRow.textContent = '';
        for (const shortcut of result.shortcuts) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip';
          chip.textContent = shortcut.label;
          chip.title = shortcut.path;
          chip.addEventListener('click', () => browseTo(shortcut.path));
          shortcutRow.appendChild(chip);
        }

        dirList.textContent = '';
        if (result.entries.length === 0) {
          const empty = document.createElement('li');
          empty.className = 'file-empty';
          empty.textContent = 'No subfolders here. You can still use this folder as the vault.';
          dirList.appendChild(empty);
        }
        for (const entry of result.entries) {
          const item = document.createElement('li');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'dir-button';
          const glyph = document.createElement('span');
          glyph.className = 'dir-glyph';
          glyph.setAttribute('aria-hidden', 'true');
          glyph.innerHTML = '${ICONS.disclosure}';
          const label = document.createElement('span');
          label.textContent = entry.name;
          button.appendChild(glyph);
          button.appendChild(label);
          button.addEventListener('click', () => browseTo(entry.path));
          item.appendChild(button);
          dirList.appendChild(item);
        }

        recents.hidden = vault.recents.length === 0;
        recentRow.textContent = '';
        for (const recent of vault.recents) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip';
          chip.textContent = recent;
          chip.title = recent;
          chip.addEventListener('click', () => switchVault(recent));
          recentRow.appendChild(chip);
        }
      }

      /**
       * The vault's path, for a user who has been told it is somewhere they
       * cannot see: the sidebar's path row is gone while a vault is open, so
       * this is the one honest way to get the whole thing out of the app.
       */
      async function copyVaultPath() {
        const path = vault.root;
        if (path === null) return;
        try {
          await copyText(path);
          showToast('Copied the vault path');
        } catch {
          // No binding can fix this: the clipboard belongs to the webview, and
          // a refusal is the truthful answer rather than a silent nothing.
          showToast('Could not copy the path.');
        }
      }

      async function copyText(text) {
        // A menu click is a gesture in a secure context, which is all the
        // clipboard API asks for. WebKitGTK wants the user's permission first
        // -- a dialog inside a dialog -- so a webview that refuses or is not
        // asked falls through to selecting the text and copying that.
        try {
          if (navigator.clipboard) {
            await navigator.clipboard.writeText(text);
            return;
          }
        } catch {
          // The fallback below is the case this catch is for.
        }
        const scratch = document.createElement('textarea');
        scratch.value = text;
        scratch.setAttribute('aria-hidden', 'true');
        document.body.appendChild(scratch);
        scratch.select();
        const copied = document.execCommand('copy');
        scratch.remove();
        if (!copied) throw new Error('The clipboard refused the copy.');
      }

      function openBrowser() {
        setSidebarOpen(false);
        // The dialog names the state it is in, because the two are not the
        // same question: the first one is the way in, the second one is a
        // switch, and the second one is going to close a vault and its tabs.
        browserTitle.textContent = vault.root === null
          ? 'Open a vault'
          : 'Open another vault';
        browserIntro.textContent = vault.root === null
          ? 'Pick the folder that holds your wiki. deno desktop has no native folder picker yet, so this dialog stands in for one — paste a path if you would rather navigate that way.'
          : 'Pick a different folder to work in. This closes the vault you have open, along with its tabs, and opens this one in their place.';
        cancelBrowseButton.hidden = vault.root === null;
        overlay.hidden = false;
        browseTo(vault.root);
      }

      function cycleTab(step) {
        if (tabs.length < 2) return;
        const next = (activeIndex + step + tabs.length) % tabs.length;
        selectTab(next);
      }

      // The same action for both affordances and for Ctrl+B.
      function toggleSidebar() {
        if (narrowWindow.matches) {
          setSidebarOpen(!isSidebarOpen());
          return;
        }
        setSidebarCollapsed(!isSidebarCollapsed(), true);
      }

      /**
       * Drag, or nudge with the keyboard, the sidebar's right edge. The handle
       * keeps pointer capture for the whole drag, so the pointer can wander
       * over the editor and past the window edge without the drag breaking.
       */
      function wireResizer() {
        let dragging = false;

        function endDrag(event) {
          if (!dragging) return;
          dragging = false;
          document.body.classList.remove('is-resizing');
          sidebarResizer.classList.remove('is-dragging');
          if (sidebarResizer.hasPointerCapture(event.pointerId)) {
            sidebarResizer.releasePointerCapture(event.pointerId);
          }
          // One write per drag, not one per pointer move.
          call('setSidebarWidth', [vault.sidebarWidth]);
        }

        sidebarResizer.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          dragging = true;
          sidebarResizer.focus();
          // The drag would otherwise select the editor's text.
          event.preventDefault();
          document.body.classList.add('is-resizing');
          sidebarResizer.classList.add('is-dragging');
          try {
            sidebarResizer.setPointerCapture(event.pointerId);
          } catch {
            // A synthetic pointer has no active id to capture. The drag still
            // works while the pointer is over the handle, which is what keeps
            // this driveable from a test or a script.
          }
        });

        sidebarResizer.addEventListener('pointermove', (event) => {
          if (!dragging) return;
          const left = sidebar.getBoundingClientRect().left;
          // Dragging the edge, not the pointer: the handle is 3px off the
          // border, so measure from the pointer with that offset removed.
          setSidebarWidth(event.clientX - left - 3, false);
        });

        sidebarResizer.addEventListener('pointerup', endDrag);
        sidebarResizer.addEventListener('pointercancel', endDrag);

        sidebarResizer.addEventListener('dblclick', () => {
          setSidebarWidth(${DEFAULT_SIDEBAR_WIDTH}, true);
        });

        sidebarResizer.addEventListener('keydown', (event) => {
          const step = event.shiftKey ? ${
  SIDEBAR_MAX_WIDTH - SIDEBAR_MIN_WIDTH
} : 8;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            setSidebarWidth(
              vault.sidebarWidth + (event.key === 'ArrowRight' ? step : -step),
              true,
            );
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            setSidebarWidth(
              event.key === 'Home' ? ${SIDEBAR_MIN_WIDTH} : widestSidebarThatFits(),
              true,
            );
          }
        });

        // A resize can make the stored width impossible to honor; re-clamp it
        // without writing that compromise back to the settings file.
        window.addEventListener('resize', applySidebarWidth);
      }

      /*
       * One command list, two ways in. Every entry wraps the same function the
       * buttons and the keyboard already call, so no command has a second
       * implementation, and the menu below is rendered from this list instead
       * of being written out again in the markup.
       *
       * window.wikiRunCommand(id) drives the same path from outside the page,
       * the way src/main.ts already reaches in for unsaved changes — which is
       * what makes every command driveable in the browser preview, where no
       * native menu exists to click. Returns whether it ran, so a caller can
       * tell a disabled command from an unknown one.
       *
       * A keys label is only ever a shortcut the page's own keydown handler
       * implements: advertising one nobody handles is a lie the user discovers
       * by pressing it.
       */
      const commands = [
        { id: 'new', group: 'File', label: 'New file', keys: 'Ctrl+N', canRun: () => vault.root !== null, run: createFile },
        { id: 'open-vault', group: 'File', label: 'Open vault…', keys: 'Ctrl+O', canRun: () => true, run: openBrowser },
        { id: 'reload', group: 'File', label: 'Reload from disk', keys: '', canRun: () => activeTab() !== null, run: reloadFile },
        { id: 'save', group: 'File', label: 'Save', keys: 'Ctrl+S', canRun: () => activeTab() !== null, run: saveFile },
        { id: 'close-tab', group: 'Tabs', label: 'Close tab', keys: 'Ctrl+W', canRun: () => activeTab() !== null, run: () => closeTab(activeIndex) },
        { id: 'next-tab', group: 'Tabs', label: 'Next tab', keys: 'Ctrl+Tab', canRun: () => tabs.length > 1, run: () => cycleTab(1) },
        { id: 'previous-tab', group: 'Tabs', label: 'Previous tab', keys: 'Ctrl+Shift+Tab', canRun: () => tabs.length > 1, run: () => cycleTab(-1) },
        { id: 'toggle-sidebar', group: 'View', label: 'Toggle vault files', keys: 'Ctrl+B', canRun: () => true, run: toggleSidebar },
        // Three choices rather than three commands, so each one reports whether
        // it is the active one and the menu can show that.
        { id: 'theme-system', group: 'Appearance', label: 'Match the system', keys: '', canRun: () => true, isActive: () => vault.theme === 'system', run: () => setTheme('system', true) },
        { id: 'theme-light', group: 'Appearance', label: 'Light', keys: '', canRun: () => true, isActive: () => vault.theme === 'light', run: () => setTheme('light', true) },
        { id: 'theme-dark', group: 'Appearance', label: 'Dark', keys: '', canRun: () => true, isActive: () => vault.theme === 'dark', run: () => setTheme('dark', true) },
        { id: 'toggle-extensions', group: 'Appearance', label: 'Show file extensions', keys: '', role: 'menuitemcheckbox', canRun: () => true, isActive: () => vault.showExtensions, run: () => setShowExtensions(!vault.showExtensions) },
        // context: this one is also an item in the vault header's own menu,
        // which is filled from the same list. Two surfaces, one command, so
        // the header's menu cannot hold an action the app menu has never heard
        // of -- or a second copy of one that has changed.
        { id: 'copy-vault-path', group: 'Vault', label: 'Copy vault path', keys: '', canRun: () => vault.root !== null, context: true, run: copyVaultPath },
        { id: 'close-vault', group: 'Vault', label: 'Close vault', keys: '', canRun: () => vault.root !== null, run: closeVault },
      ];

      let menuIndex = -1;

      function menuItems() {
        return Array.from(commandMenu.querySelectorAll('.menu-item'));
      }

      function enabledMenuItems() {
        return menuItems().filter((item) => item.getAttribute('aria-disabled') !== 'true');
      }

      function menuIsOpen() {
        return !commandMenu.hidden;
      }

      function focusExisting(item) {
        menuIndex = menuItems().indexOf(item);
        item.focus();
      }

      function focusCommand(id) {
        const item = enabledMenuItems().find((entry) => entry.dataset.command === id);
        if (item) focusExisting(item);
      }

      /* Re-rendered rather than patched: the list is small, and a stale
         aria-disabled is the one thing that would make an item lie. */
      function renderMenu() {
        const focused = menuIndex >= 0 ? menuItems()[menuIndex]?.dataset.command : null;
        menuIndex = -1;
        commandMenu.textContent = '';
        let group = null;
        for (const command of commands) {
          if (command.group !== group) {
            group = command.group;
            const section = document.createElement('div');
            section.className = 'menu-group';
            section.setAttribute('role', 'group');
            section.setAttribute('aria-label', group);
            const label = document.createElement('div');
            label.className = 'menu-group-label';
            label.textContent = group;
            section.appendChild(label);
            commandMenu.appendChild(section);
          }
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'menu-item';
          // A command fires and closes the menu; a choice among a set stays put
          // and has to say which one is on, so it is a radio item with a mark.
          // A setting that is on or off rather than one of several is a
          // checkbox, which is a different role and a different promise to a
          // screen reader even though it draws the same mark.
          const isChoice = typeof command.isActive === 'function';
          item.setAttribute('role', command.role ?? (isChoice ? 'menuitemradio' : 'menuitem'));
          if (isChoice) {
            item.setAttribute('aria-checked', command.isActive() ? 'true' : 'false');
            const check = document.createElement('span');
            check.className = 'menu-check';
            check.setAttribute('aria-hidden', 'true');
            // Presence of the mark is the cue, not its colour, so the active
            // state survives for anyone who cannot see the tint.
            check.innerHTML = command.isActive() ? '${ICONS.activeCheck}' : '';
            item.appendChild(check);
          }
          item.setAttribute('aria-disabled', command.canRun() ? 'false' : 'true');
          item.dataset.command = command.id;
          const name = document.createElement('span');
          name.className = 'menu-item-label';
          name.textContent = command.label;
          item.appendChild(name);
          if (command.keys) {
            const keys = document.createElement('span');
            keys.className = 'menu-keys';
            keys.textContent = command.keys;
            item.appendChild(keys);
          }
          item.addEventListener('click', () => runCommand(command.id));
          commandMenu.lastElementChild.appendChild(item);
        }
        if (focused !== null && focused !== undefined) focusCommand(focused);
      }

      /* The vault header's own menu, at the pointer */

      function vaultMenuIsOpen() {
        return !vaultMenu.hidden;
      }

      /* The same item as the app menu, built the same way and run the same way:
         the only difference is which list it walks and where it is placed. */
      function renderVaultMenu() {
        vaultMenu.textContent = '';
        for (const command of commands.filter((entry) => entry.context)) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'menu-item';
          item.setAttribute('role', 'menuitem');
          item.setAttribute('aria-disabled', command.canRun() ? 'false' : 'true');
          item.dataset.command = command.id;
          const name = document.createElement('span');
          name.className = 'menu-item-label';
          name.textContent = command.label;
          item.appendChild(name);
          item.addEventListener('click', () => {
            hideVaultMenu();
            runCommand(command.id);
          });
          vaultMenu.appendChild(item);
        }
      }

      function openVaultMenu(x, y) {
        // One popup at a time. The app menu is opened with a click and this one
        // with a right-click, so a user can ask for the second without the
        // first closing -- and Escape would then have two surfaces to choose
        // between, with the app menu's check written first.
        closeMenu(false);
        renderVaultMenu();
        vaultMenu.hidden = false;
        // Placed after it is shown, because its size is what has to fit: a
        // right-click near the window's edge would otherwise open a menu that
        // runs off it, with its only item unreachable.
        const box = vaultMenu.getBoundingClientRect();
        const edge = 6;
        vaultMenu.style.left =
          Math.max(edge, Math.min(x, window.innerWidth - box.width - edge)) + 'px';
        vaultMenu.style.top =
          Math.max(edge, Math.min(y, window.innerHeight - box.height - edge)) + 'px';
        const first = vaultMenu.querySelector('.menu-item[aria-disabled="false"]') ??
          vaultMenu.querySelector('.menu-item');
        if (first) first.focus();
      }

      function hideVaultMenu() {
        vaultMenu.hidden = true;
      }

      function wireVaultMenu() {
        vaultHead.addEventListener('contextmenu', (event) => {
          // The app's menu replaces the webview's, which offers a page of
          // spell-check and view-source over a folder name.
          event.preventDefault();
          // With no vault open there is nothing for this menu to act on, so it
          // does not open: a menu of one greyed-out item is a worse answer than
          // no menu.
          if (vault.root === null) return;
          openVaultMenu(event.clientX, event.clientY);
        });
        document.addEventListener('click', (event) => {
          if (!vaultMenuIsOpen()) return;
          if (vaultMenu.contains(event.target)) return;
          hideVaultMenu();
        });
      }

      function stepMenuItem(step) {
        const items = enabledMenuItems();
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement);
        const next = current === -1
          ? (step > 0 ? 0 : items.length - 1)
          : (current + step + items.length) % items.length;
        focusExisting(items[next]);
      }

      function edgeMenuItem(edge) {
        const items = enabledMenuItems();
        if (items.length === 0) return;
        focusExisting(edge === 'last' ? items[items.length - 1] : items[0]);
      }

      function openMenu() {
        renderMenu();
        commandMenu.hidden = false;
        menuButton.setAttribute('aria-expanded', 'true');
        edgeMenuItem('first');
      }

      function closeMenu(refocus) {
        if (!menuIsOpen()) return;
        commandMenu.hidden = true;
        menuIndex = -1;
        menuButton.setAttribute('aria-expanded', 'false');
        if (refocus !== false) menuButton.focus();
      }

      function toggleMenu() {
        if (menuIsOpen()) closeMenu();
        else openMenu();
      }

      /** Only while open: a closed menu is not on screen to be stale. */
      function refreshMenu() {
        if (menuIsOpen()) renderMenu();
      }

      function runCommand(id) {
        const command = commands.find((entry) => entry.id === id);
        if (!command || !command.canRun()) return false;
        closeMenu(false);
        command.run();
        return true;
      }

      window.wikiRunCommand = (id) => runCommand(String(id));

      function wireMenu() {
        menuButton.addEventListener('click', toggleMenu);
        commandMenu.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); stepMenuItem(1); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); stepMenuItem(-1); }
          else if (event.key === 'Home') { event.preventDefault(); edgeMenuItem('first'); }
          else if (event.key === 'End') { event.preventDefault(); edgeMenuItem('last'); }
          else if (event.key === 'Tab') { closeMenu(false); }
        });
        // A click anywhere else dismisses it, the way a menu bar behaves.
        document.addEventListener('click', (event) => {
          if (!menuIsOpen()) return;
          if (commandMenu.contains(event.target)) return;
          if (menuButton.contains(event.target)) return;
          closeMenu(false);
        });
      }

      function wire() {
        for (const toggle of sidebarToggles) {
          toggle.addEventListener('click', toggleSidebar);
        }
        // The two layouts keep different states for the same control — a
        // collapsed column on a wide window, a closed drawer on a narrow one —
        // so crossing the breakpoint has to re-derive the labels. Without this
        // a window dragged from narrow to wide leaves both toggles describing
        // the drawer that just left: "Show vault files" beside a sidebar that
        // is on screen.
        narrowWindow.addEventListener('change', syncSidebarToggles);
        wireResizer();
        wireMenu();
        wireVaultMenu();
        sidebarScrim.addEventListener('click', () => setSidebarOpen(false));
        openVaultButton.addEventListener('click', openBrowser);
        cancelBrowseButton.addEventListener('click', closeBrowser);
        useFolderButton.addEventListener('click', () => {
          if (listing) switchVault(listing.path);
        });
        upButton.addEventListener('click', () => {
          if (listing && listing.parent) browseTo(listing.parent);
        });
        goButton.addEventListener('click', () => browseTo(browserPath.value.trim()));
        browserPath.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            browseTo(browserPath.value.trim());
          }
        });
        newFileButton.addEventListener('click', createFile);
        emptyNewFileButton.addEventListener('click', createFile);
        saveButton.addEventListener('click', saveFile);
        reloadButton.addEventListener('click', reloadFile);
        filterInput.addEventListener('input', renderFiles);
        showAssetsInput.addEventListener('change', renderFiles);
        // The setting lives in the sidebar, next to the list it draws, as well
        // as the Appearance menu. Both controls drive the same state, so this
        // syncs the checkbox and refreshes the menu's own check mark.
        extensionsInput.addEventListener('change', () => setShowExtensions(extensionsInput.checked, true));
        // Edits, cursor moves, and Tab all arrive through the editor's own
        // update listener, wired when the handle was created above.
        // A browser tab can vanish without warning; the desktop window asks
        // first through its own close handler.
        window.addEventListener('beforeunload', (event) => {
          if (!anyDirty()) return;
          event.preventDefault();
          event.returnValue = '';
        });
        document.addEventListener('keydown', (event) => {
          // The header's menu and the app menu are the two surfaces on top of
          // the page, and only one of them is ever open: opening either closes
          // the other, so Escape has a single answer whichever is up.
          if (event.key === 'Escape' && vaultMenuIsOpen()) {
            event.preventDefault();
            hideVaultMenu();
            return;
          }
          // The menu is on top of everything, so it gets first refusal on
          // Escape — otherwise closing it would also close the sidebar drawer.
          if (event.key === 'Escape' && menuIsOpen()) {
            event.preventDefault();
            closeMenu();
            return;
          }
          if (event.key === 'Escape' && !overlay.hidden) {
            event.preventDefault();
            closeBrowser();
            return;
          }
          if (event.key === 'Escape' && isSidebarOpen()) {
            event.preventDefault();
            setSidebarOpen(false);
            return;
          }
          if (!(event.metaKey || event.ctrlKey)) return;
          const key = event.key.toLowerCase();
          if (key === 's') {
            event.preventDefault();
            saveFile();
          } else if (key === 'o') {
            event.preventDefault();
            openBrowser();
          } else if (key === 'n') {
            event.preventDefault();
            createFile();
          } else if (key === 'w') {
            event.preventDefault();
            closeTab(activeIndex);
          } else if (key === 'b') {
            event.preventDefault();
            toggleSidebar();
          } else if (event.key === 'Tab') {
            event.preventDefault();
            cycleTab(event.shiftKey ? -1 : 1);
          }
        });
      }

      if (!window.bindings) el('transportBadge').hidden = false;
      wire();
      init();
    })();
  </script>
</body>
</html>`;

/**
 * The document with the stored appearance baked into `<html>`, so the first
 * paint is already in the right mode. Without it the head script would have to
 * wait for the palette and the preference it stores over the bindings, and a
 * user who pinned the opposite of their OS would see the wrong one until then.
 *
 * `theme` is the sanitized value from the config, so it is always a preference
 * the head script recognises; an unrecognised one would resolve to `system`.
 */
export function pageForTheme(theme: ThemePreference): string {
  return pageTemplate.replace(
    '<html lang="en">',
    `<html lang="en" data-theme-preference="${theme}">`,
  );
}

/** The page as it ships: the default appearance, which follows the OS. */
export const page: string = pageForTheme(DEFAULT_THEME);
