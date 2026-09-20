import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "./config.ts";

/**
 * The webview document. It is a plain string so the app stays a single
 * self-contained entrypoint: no bundler, and nothing to embed for
 * `deno desktop --output`. The Deno-side API it talks to is `bindings.*`,
 * typed by `WikiBindings` in src/bindings.ts.
 *
 * The sidebar's width bounds are interpolated from src/config.ts rather than
 * written here twice, so the drag handle and the stored setting agree.
 */
export const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#f5f7fb" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#13151b" media="(prefers-color-scheme: dark)" />
  <title>Wazoo Wiki</title>
  <style>
    /*
     * Light is the default and dark follows the operating system, which is
     * what the desktop runtime and every browser report through
     * prefers-color-scheme. No toggle: both modes are one token set, so a
     * future in-app override only has to reassign these values on :root.
     */
    :root {
      color-scheme: light dark;
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
      --selection: #8e86ee;
      --selection-text: #ffffff;
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

    @media (prefers-color-scheme: dark) {
      :root {
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
        --selection: #4b428f;
        --selection-text: #ffffff;
        --overlay: rgba(3, 5, 10, 0.62);
        --focus-ring: rgba(139, 129, 255, 0.4);
        --toast-bg: #232733;
        --shadow: 0 18px 45px rgba(0, 0, 0, 0.5);
      }
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-width: 320px;
      height: 100vh;
      overflow: hidden;
      background: var(--canvas);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12.5px;
    }

    button, input, textarea { font: inherit; }
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
    .button:focus-visible, input:focus-visible, textarea:focus-visible, .file-button:focus-visible,
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
    .vault-head { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .vault-label { color: var(--muted); font-size: 9.5px; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; flex-shrink: 0; }
    .vault-name { font-size: 12.5px; font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vault-name.is-placeholder { color: var(--muted); font-weight: 600; }
    .vault-path {
      margin: 3px 0 8px; color: var(--muted); font-size: 10.5px; line-height: 1.4;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .vault-actions { display: flex; gap: 6px; }
    .vault-actions .button { flex: 1; min-height: 25px; font-size: 11.5px; }

    .filter-row { padding: 8px 10px 5px; }
    .filter {
      width: 100%; min-height: 28px; padding: 0 9px;
      border: 1px solid var(--line); border-radius: 7px; color: var(--text); background: var(--panel-muted);
      font-size: 12px;
    }
    .filter::placeholder { color: var(--text-faint); }

    .file-list { flex: 1; min-height: 0; margin: 0; padding: 3px 7px 8px; overflow-y: auto; list-style: none; }
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
    textarea {
      display: block; width: 100%; height: 100%; resize: none; padding: 14px 16px;
      border: 0; outline: 0; color: var(--text-editor); background: var(--panel);
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 13px; line-height: 1.6; tab-size: 2;
    }
    textarea::selection { color: var(--selection-text); background: var(--selection); }

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
    .dir-list { flex: 1; min-height: 120px; margin: 0; padding: 3px 10px 9px; overflow-y: auto; list-style: none; border-top: 1px solid var(--line); }
    .dir-button {
      display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 9px;
      border: 0; border-radius: 6px; color: var(--text-body); background: transparent; text-align: left; font-size: 12px;
    }
    .dir-button:hover { background: var(--surface-hover); }
    .dir-glyph { color: var(--muted); }
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
    }
  </style>
</head>
<body>
  <main class="app" id="app">
    <aside class="sidebar">
      <div class="brand">
        <button class="button button-secondary icon-button sidebar-toggle" type="button" title="Hide vault files (Ctrl+B)" aria-label="Hide vault files" aria-expanded="true">☰</button>
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
        <div class="vault-head">
          <span class="vault-label">Vault</span>
          <span class="vault-name is-placeholder" id="vaultName">No vault open</span>
        </div>
        <div class="vault-path" id="vaultPath">Choose the folder that holds your wiki.</div>
        <div class="vault-actions">
          <button class="button button-secondary" id="openVaultButton" type="button">Open vault…</button>
          <button class="button button-secondary" id="closeVaultButton" type="button" hidden>Close</button>
        </div>
      </section>

      <div class="filter-row">
        <label class="sr-only" for="filter">Filter files</label>
        <input class="filter" id="filter" type="search" placeholder="Filter files" autocomplete="off" />
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
        <button class="button button-secondary icon-button sidebar-toggle" type="button" title="Show vault files (Ctrl+B)" aria-label="Show vault files" aria-expanded="false">☰</button>
        <div class="tabs" id="tabs" role="tablist" aria-label="Open files"></div>
        <div class="file-actions">
          <span class="save-state" id="saveState">Ready</span>
          <button class="button button-secondary" id="newFileButton" type="button" disabled>New</button>
          <button class="button button-secondary" id="reloadButton" type="button" disabled>Reload</button>
          <button class="button button-primary" id="saveButton" type="button" disabled>Save</button>
        </div>
      </header>

      <div class="editor-region">
        <div class="placeholder" id="placeholderNoVault">
          <div class="placeholder-inner">
            <div class="placeholder-icon" aria-hidden="true">📁</div>
            <h1>Open a folder to begin</h1>
            <p>Pick the folder that holds your wiki. The app reads and writes Markdown files there, directly on disk.</p>
            <button class="button button-primary" id="emptyOpenVaultButton" type="button">Choose a vault</button>
          </div>
        </div>

        <div class="placeholder" id="placeholderNoFile" hidden>
          <div class="placeholder-inner">
            <div class="placeholder-icon" aria-hidden="true">✎</div>
            <h1>Select a file</h1>
            <p id="placeholderNoFileText">Pick a file from the sidebar to open it in a tab.</p>
            <button class="button button-primary" id="emptyNewFileButton" type="button">New file</button>
            <div class="hint"><kbd>Ctrl</kbd> <kbd>N</kbd> makes a file · <kbd>Ctrl</kbd> <kbd>W</kbd> closes a tab · <kbd>Ctrl</kbd> <kbd>Tab</kbd> switches</div>
          </div>
        </div>

        <div class="editor-wrap" id="editorWrap" hidden>
          <label class="sr-only" for="editor">File contents</label>
          <textarea id="editor" spellcheck="false" wrap="off" aria-label="File contents"></textarea>
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
        <h2 id="browserTitle">Open vault</h2>
        <p>Browse to the folder you want to work in, then choose it. deno desktop has no native folder picker yet, so this dialog stands in for one — paste a path if you would rather navigate that way.</p>
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

  <div class="toast" id="toast" role="status" aria-live="polite"></div>

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
      const editor = el('editor');
      const editorWrap = el('editorWrap');
      const placeholderNoVault = el('placeholderNoVault');
      const placeholderNoFile = el('placeholderNoFile');
      const placeholderNoFileText = el('placeholderNoFileText');
      const tabsEl = el('tabs');
      const saveState = el('saveState');
      const saveButton = el('saveButton');
      const reloadButton = el('reloadButton');
      const newFileButton = el('newFileButton');
      const openVaultButton = el('openVaultButton');
      const closeVaultButton = el('closeVaultButton');
      const emptyOpenVaultButton = el('emptyOpenVaultButton');
      const emptyNewFileButton = el('emptyNewFileButton');
      const vaultName = el('vaultName');
      const vaultPath = el('vaultPath');
      const filterInput = el('filter');
      const fileList = el('fileList');
      const fileCount = el('fileCount');
      const statusPath = el('statusPath');
      const characterCount = el('characterCount');
      const lineCount = el('lineCount');
      const cursorPosition = el('cursorPosition');
      const toast = el('toast');
      const overlay = el('browserOverlay');
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
      const sidebarScrim = el('sidebarScrim');
      // One action, two affordances: the brand row's while the sidebar is
      // showing, the tabbar's once it is collapsed, so the control stays in the
      // window's top-left corner either way. Only one is ever displayed.
      const sidebarToggles = document.querySelectorAll('.sidebar-toggle');

      // Below this width the sidebar is a drawer rather than a column, so the
      // same button means "slide it in" instead of "collapse the column".
      const narrowWindow = window.matchMedia('(max-width: 640px)');

      let vault = {
        root: null,
        name: null,
        recents: [],
        sidebarCollapsed: false,
        sidebarWidth: ${DEFAULT_SIDEBAR_WIDTH},
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
          return await bridge[name].apply(null, args || []);
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
       */
      function syncSidebarToggles() {
        const showing = narrowWindow.matches
          ? isSidebarOpen()
          : !isSidebarCollapsed();
        for (const toggle of sidebarToggles) {
          toggle.setAttribute('aria-expanded', String(showing));
          toggle.setAttribute(
            'aria-label',
            showing ? 'Hide vault files' : 'Show vault files',
          );
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

      function stashCursor() {
        const tab = activeTab();
        if (tab === null) return;
        tab.content = editor.value;
        tab.cursor = editor.selectionStart;
        tab.scroll = editor.scrollTop;
      }

      function loadActiveIntoEditor() {
        const tab = activeTab();
        if (tab === null) {
          editor.value = '';
          renderTabs();
          showPlaceholder();
          return;
        }
        editor.value = tab.content;
        showEditor();
        const cursor = Math.min(tab.cursor || 0, editor.value.length);
        editor.setSelectionRange(cursor, cursor);
        editor.scrollTop = tab.scroll || 0;
        editor.focus();
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
          close.textContent = '×';
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
            cursor: 0,
            scroll: 0,
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

      function closeTab(index) {
        const tab = tabs[index];
        if (tab === undefined) return;
        if (tabIsDirty(tab)) {
          const keep = window.confirm('Discard unsaved changes to ' + tab.path + '?');
          if (!keep) return;
        }
        const wasActive = index === activeIndex;
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
        const contents = tab === null ? '' : editor.value;
        const lines = contents ? contents.split(NL).length : 0;
        characterCount.textContent = contents.length.toLocaleString() +
          (contents.length === 1 ? ' character' : ' characters');
        lineCount.textContent = lines.toLocaleString() + (lines === 1 ? ' line' : ' lines');
        if (tab !== null) {
          const beforeCursor = contents.slice(0, editor.selectionStart);
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
      }

      function renderVault() {
        const open = vault.root !== null;
        vaultName.textContent = vault.name || 'No vault open';
        vaultName.classList.toggle('is-placeholder', !open);
        vaultPath.textContent = open ? vault.root : 'Choose the folder that holds your wiki.';
        vaultPath.title = vault.root || '';
        closeVaultButton.hidden = !open;
        newFileButton.disabled = !open;
        placeholderNoVault.hidden = open;
      }

      function renderFiles() {
        const query = filterInput.value.trim().toLowerCase();
        const visible = query
          ? files.filter((file) => file.path.toLowerCase().indexOf(query) !== -1)
          : files;
        const openPaths = new Set(tabs.map((tab) => tab.path));
        const active = activeTab();
        fileList.textContent = '';
        if (vault.root === null) {
          fileCount.textContent = 'No vault open';
        } else if (visible.length === 0) {
          fileCount.textContent = files.length === 0
            ? 'No files in this vault'
            : 'No files match "' + filterInput.value.trim() + '"';
          const empty = document.createElement('li');
          empty.className = 'file-empty';
          empty.textContent = files.length === 0
            ? 'This folder has no files yet. Create one with New.'
            : 'Try a different filter.';
          fileList.appendChild(empty);
        } else {
          fileCount.textContent = visible.length +
            (visible.length === 1 ? ' file' : ' files') +
            (visible.length === files.length ? '' : ' of ' + files.length);
        }

        for (const file of visible) {
          const item = document.createElement('li');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'file-button';
          if (active !== null && active.path === file.path) button.classList.add('is-active');
          else if (openPaths.has(file.path)) button.classList.add('is-open');
          const name = document.createElement('span');
          name.className = 'file-name';
          name.textContent = file.name;
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
          button.title = file.path;
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
        placeholderNoVault.hidden = true;
        placeholderNoFile.hidden = true;
        editorWrap.hidden = false;
      }

      function showPlaceholder() {
        const hasTab = activeTab() !== null;
        // The editor is hidden while the placeholder stands in for it, and
        // shown again the moment a tab exists.
        editorWrap.hidden = !hasTab;
        placeholderNoVault.hidden = vault.root !== null;
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
        const payload = await call('writeFile', [tab.path, tab.content]);
        if (payload === null) return;
        tab.saved = tab.content;
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
        tab.cursor = 0;
        tab.scroll = 0;
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

      function applyState(state) {
        vault = state;
        setSidebarCollapsed(state.sidebarCollapsed === true, false);
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
      }

      async function switchVault(path) {
        if (!confirmDiscardAll()) return;
        const state = await call('openVault', [path]);
        if (state === null) return;
        closeBrowser();
        tabs = [];
        activeIndex = -1;
        editor.value = '';
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
        tabs = [];
        activeIndex = -1;
        editor.value = '';
        applyState(state);
        renderTabs();
        updateStatus();
        renderFiles();
      }

      // Vault picker

      function closeBrowser() {
        overlay.hidden = true;
        listing = null;
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
          glyph.textContent = '▸';
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

      function openBrowser() {
        setSidebarOpen(false);
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

      function wire() {
        for (const toggle of sidebarToggles) {
          toggle.addEventListener('click', toggleSidebar);
        }
        wireResizer();
        sidebarScrim.addEventListener('click', () => setSidebarOpen(false));
        openVaultButton.addEventListener('click', openBrowser);
        emptyOpenVaultButton.addEventListener('click', openBrowser);
        closeVaultButton.addEventListener('click', closeVault);
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
        reloadButton.addEventListener('click', reloadFile);
        saveButton.addEventListener('click', saveFile);
        filterInput.addEventListener('input', renderFiles);
        editor.addEventListener('input', () => {
          const tab = activeTab();
          if (tab !== null) tab.content = editor.value;
          markActiveTab();
          updateStatus();
        });
        editor.addEventListener('keyup', updateStatus);
        editor.addEventListener('click', updateStatus);
        editor.addEventListener('keydown', (event) => {
          if (event.key !== 'Tab') return;
          event.preventDefault();
          const start = editor.selectionStart;
          editor.setRangeText('  ', start, editor.selectionEnd, 'end');
          const tab = activeTab();
          if (tab !== null) tab.content = editor.value;
          updateStatus();
        });
        // A browser tab can vanish without warning; the desktop window asks
        // first through its own close handler.
        window.addEventListener('beforeunload', (event) => {
          if (!anyDirty()) return;
          event.preventDefault();
          event.returnValue = '';
        });
        document.addEventListener('keydown', (event) => {
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
