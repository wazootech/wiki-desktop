import {
  ACTIVITY_BAR_WIDTH,
  DEFAULT_SIDEBAR_VIEW,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_SPLIT_RATIO,
  DEFAULT_THEME,
  LIST_VIEW_DEFAULTS,
  type ListViewKey,
  type ListViewSetter,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  setterFor,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  type SidebarView,
  type ThemePreference,
} from "./config.ts";
import { PLEX_MONO_LATIN, PLEX_MONO_LATIN_EXT } from "./plex_mono.ts";

/** One switch on the file list's own toolbar, and everything both surfaces need. */
interface ListView {
  /** The setting it drives, and the key it is stored under. */
  key: ListViewKey;
  /** What the toolbar checkbox says. */
  label: string;
  /** Its tooltip: what turning it off does. */
  title: string;
  /** What the Appearance menu says, which is not always the same words. */
  menu: string;
  /**
   * Set on the switch that only means something in some vaults. Assets is the
   * one: a vault that declares no static files has no such distinction to
   * offer, so the checkbox stays hidden rather than ticking nothing.
   */
  needsAssets: boolean;
  /** What it is worth before anyone has said otherwise. */
  default: boolean;
  /** The label's element id, which the script hides. */
  labelId: string;
  /** The command id, so the menu item and the checkbox run the same entry. */
  command: string;
  /** The operation that stores it. */
  operation: ListViewSetter;
}

/** The switch's own name, without the `show` every one of them starts with. */
function shortName(key: ListViewKey): string {
  return key.replace(/^show/, "").toLowerCase();
}

/**
 * The file list's three switches, declared once.
 *
 * They differ in what they change — a name, a second line, which files are
 * listed at all — and agree in everything else: a checkbox beside the list, an
 * item in the Appearance menu, one stored boolean, and a value that survives a
 * restart. Writing that agreement out three times is how Assets came to be
 * per-session while its two neighbours persisted, so everything both surfaces
 * share is derived from this table: the markup, the listeners, the menu
 * commands, the stored operation, and the default the checkbox starts at.
 */
const LIST_VIEWS: ListView[] = ([
  {
    key: "showAssets",
    label: "Assets",
    title: "List the vault's static files too",
    menu: "List the vault's static files",
    needsAssets: true,
  },
  {
    key: "showExtensions",
    label: "Extensions",
    title: "Write each file's extension out in full",
    menu: "Show file extensions",
    needsAssets: false,
  },
  {
    key: "showPaths",
    label: "Paths",
    title: "Write each file's folder on a second line under its name",
    menu: "Show folder paths",
    needsAssets: false,
  },
] as const).map((view) => ({
  ...view,
  default: LIST_VIEW_DEFAULTS[view.key],
  // showAssets -> assetsToggle, which is the id the label has always had, so
  // the CSS and anything reaching for it keep working.
  labelId: shortName(view.key) + "Toggle",
  command: "toggle-" + shortName(view.key),
  operation: setterFor(view.key),
}));

/** One switch's checkbox, as the toolbar's markup has always written it. */
function listViewCheckbox(view: ListView): string {
  return `<label class="assets-toggle" id="${view.labelId}" title="${view.title}"${
    view.default ? " checked" : ""
  }${view.needsAssets ? " hidden" : ""}>
            <input type="checkbox" id="${view.key}" />${view.label}
          </label>`;
}

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
  /*
   * The activity bar's three views. 20px rather than the 15px of the toolbar
   * glyphs, because these are the only marks on screen that say which pane is
   * open: at 15px a strip of them is a column of grey smudges, and the bar is
   * 48px wide precisely so the mark can be the size of a tab.
   */
  explorer: chromeIcon(
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M8 13h8" /><path d="M8 17h5" />',
    20,
  ),
  search: chromeIcon(
    '<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />',
    20,
  ),
  recentlyChanged: chromeIcon(
    '<path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />',
    20,
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
  /**
   * A section header's own disclosure. It points down, which is the state a
   * section spends most of its life in, and the CSS turns it sideways when the
   * section is collapsed -- so the rotation is one rule rather than two icons
   * that have to be kept in step.
   */
  sectionChevron: chromeIcon('<path d="m6 9 6 6 6-6" />', 12),
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
 * The sidebar's views, declared once, in the order the activity bar draws them.
 *
 * The same arrangement as the list's switches above, and for the same reason:
 * the bar's buttons, the panes the script switches between, the View commands
 * in the menu and the stored setting all come from this one list, so a view
 * cannot be a button with no pane behind it, and a pane cannot be reachable
 * with no way to reach it.
 *
 * The pane's *contents* are not here. Each view draws its own toolbar, listing
 * and footer in the markup, because those are the things that differ; a table
 * of them would be a template rather than a list, and the table is here to be
 * enumerated, not to be rendered.
 */
interface PaneView {
  /** The stored key, and the value the setting and `setSidebarView` use. */
  key: SidebarView;
  /**
   * What the view is called, everywhere the user can read a name for it: the
   * View menu and the button's own accessible name.
   */
  label: string;
  /**
   * The button's tooltip — a description of the view rather than its name, so
   * the bar can say more than the one word the menu already gives.
   */
  hint: string;
  /** The markup the button draws. */
  icon: string;
}

const PANES: PaneView[] = [
  {
    key: "explorer",
    label: "Explorer",
    hint: "Vault files",
    icon: ICONS.explorer,
  },
  {
    key: "search",
    label: "Search",
    hint: "Search every page",
    icon: ICONS.search,
  },
  {
    key: "recent",
    label: "Recently changed",
    hint: "Pages by when they were last edited",
    icon: ICONS.recentlyChanged,
  },
];

/**
 * One button on the activity bar, drawn from the table above.
 *
 * `aria-label` is the view's name and `title` is its hint, rather than both
 * being the same words: a screen-reader user tabbing the bar and a user reading
 * the View menu should hear the same thing for the same view, and the tooltip
 * can afford to say more than that.
 */
function activityButton(view: PaneView): string {
  return `<button class="activity-button" type="button" id="activity-${view.key}"
            data-view="${view.key}" role="tab" aria-selected="false" tabindex="-1"
            aria-controls="pane-${view.key}" title="${view.hint}" aria-label="${view.label}"
          >${view.icon}</button>`;
}

/**
 * One pane: the section the bar switches to, wrapping whatever the view draws.
 *
 * Hidden in the markup and revealed by the script, so a pane can never be on
 * screen before the stored view has said which one should be -- and so the
 * no-JavaScript document is an empty sidebar rather than a wrong one.
 */
function paneSection(view: PaneView, body: string): string {
  return `<section class="pane" id="pane-${view.key}" data-view="${view.key}"
             role="tabpanel" aria-labelledby="activity-${view.key}" tabindex="-1" hidden>
            ${body}
          </section>`;
}

/** A pane's own name, which the bar's glyph only implies. */
function paneTitle(view: PaneView): string {
  return `<div class="pane-title">${view.label}</div>`;
}

/**
 * The three panes, drawn once here so the template holds one reference each and
 * the two never drift: the ids below are the ones the script looks up, and the
 * switcher pairs them with {@link PANES} by the `data-view` on each section.
 */
function paneMarkup(key: SidebarView): string {
  const view = PANES.find((entry) => entry.key === key);
  if (view === undefined) throw new Error(`no view named ${key}`);
  if (key === "explorer") {
    // The file list as it has always been, with what used to be sidebar chrome
    // now scoped to this pane: the filter and the three switches act on a
    // listing, and the create button is the listing's own action.
    return paneSection(
      view,
      `${paneTitle(view)}
            <div class="view-tools" id="viewTools">
              <label class="sr-only" for="filter">Filter files</label>
              <input class="filter" id="filter" type="search" placeholder="Filter files" autocomplete="off" />
              <button class="button button-secondary icon-button" id="newFileButton" type="button" title="New file (Ctrl+N)" aria-label="New file" disabled>${ICONS.newFile}</button>
              <div class="view-tools-checks">${
        LIST_VIEWS.map(listViewCheckbox).join("\n                ")
      }</div>
            </div>
            <ul class="file-list" id="fileList" aria-label="Vault files"></ul>
            <div class="view-status">
              <span id="fileCount">No vault open</span>
              <span class="transport" id="transportBadge" hidden>Browser dev mode</span>
            </div>`,
    );
  }
  if (key === "search") {
    // One query box and a grouped result list. No toolbar beyond the box: there
    // is nothing to filter by, nothing to create, and no switch that means
    // anything here -- which is the point of the pane owning its chrome.
    return paneSection(
      view,
      `${paneTitle(view)}
            <div class="view-tools" id="searchTools">
              <label class="sr-only" for="searchQuery">Search this vault</label>
              <input class="filter" id="searchQuery" type="search" placeholder="Search this vault" autocomplete="off" spellcheck="false" />
            </div>
            <div class="search-results" id="searchResults" role="list" aria-label="Search results"></div>
            <div class="view-status">
              <span id="searchStatus">Type to search every page</span>
            </div>`,
    );
  }
  // Recently changed, as two panes: the files themselves, and the history of
  // the days they were written on. No toolbar on either, and only one new
  // operation behind the pair -- the listing already carries each file's
  // modification time, so both panes are two readings of what the app has
  // already loaded. The divider between them is draggable, because a vault
  // with a long tail of old files wants the history a thumb's width and no
  // more, and because a split the reader cannot move is a layout they have to
  // live with rather than one they chose.
  return paneSection(
    view,
    `${paneTitle(view)}
            <div class="split" id="recentSplit">
              ${
      splitSection(
        "changes",
        "Changes",
        "Files written most recently",
        `<ul class="file-list" id="recentList" aria-label="Recently changed files"></ul>
                <div class="commit-box" id="commitBox">
                  <div class="commit-state" id="commitState">Reading the vault's git status</div>
                  <label class="sr-only" for="commitMessage">Message for the ticked files</label>
                  <input class="commit-input" id="commitMessage" type="text"
                         placeholder="Commit message" autocomplete="off" spellcheck="true" />
                  <div class="commit-row commit-actions">
                    <button class="button button-secondary commit-button commit-amend" id="amendButton" type="button" disabled
                            aria-describedby="remoteState"
                            title="Replace the last commit with these files and this message">Amend</button>
                    <button class="button button-primary commit-button commit-primary" id="commitButton" type="button" disabled>Commit</button>
                  </div>
                  <div class="commit-row commit-remote">
                    <span class="commit-branch" id="remoteState">Reading where this branch stands</span>
                    <button class="button button-secondary commit-button" id="pushButton" type="button" disabled
                            aria-describedby="remoteStatus">Push</button>
                  </div>
                  <div class="commit-branch-status" id="remoteStatus" role="note"></div>
                  <div class="commit-note" id="commitNote" role="status"></div>
                </div>`,
      )
    }
              <div class="pane-divider" id="recentDivider" role="separator" aria-orientation="horizontal"
                   aria-label="Resize the changes and history panes" aria-controls="changesBody"
                   aria-valuemin="0" aria-valuemax="100" aria-valuenow="${
      Math.round(DEFAULT_SPLIT_RATIO * 100)
    }"
                   title="Drag to resize, double-click to even them out" tabindex="0"></div>
              ${
      splitSection(
        "history",
        "History",
        "Writes grouped by day",
        '<ol class="activity" id="recentHistory" aria-label="Files changed by day"></ol>',
      )
    }
            </div>
            <div class="view-status">
              <span id="recentStatus">No vault open</span>
            </div>`,
  );
}

/**
 * One collapsible section of a split pane: a header that says what the section
 * holds and how much of it there is, and the body that scrolls.
 *
 * Drawn from a key and a name rather than written out twice, so the changes and
 * history sections cannot drift into looking like two different controls -- and
 * so the count badge is in the header because that is the only place a reader
 * can size a section without opening it.
 *
 * The body is markup rather than script-built, because the list inside it is an
 * element the script looks up by id: a view that filled its own list would be
 * one more place for a null to hide.
 */
function splitSection(
  key: string,
  label: string,
  hint: string,
  body: string,
): string {
  return `<section class="split-pane" id="${key}Pane" aria-label="${label}">
                <div class="split-head">
                  <button class="split-toggle" id="${key}Toggle" type="button" aria-expanded="true"
                          aria-controls="${key}Body" title="${hint}">
                    ${ICONS.sectionChevron}<span class="split-name">${label}</span>
                    <span class="split-count" id="${key}Count">0</span>
                  </button>
                </div>
                <div class="split-body" id="${key}Body">${body}</div>
              </section>`;
}

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
  <meta name="theme-color" content="#f7f2e8" />
  <title>Wazoo Wiki</title>
  <style>
    /*
     * The design system's body face, embedded rather than linked: an offline
     * app has to look the same with no network, and the stack used to name a
     * locally installed Inter that nothing ever loaded — so the type in every
     * toolbar was whatever the machine happened to have. Two subsets, because a
     * vault's filenames are user data and a wiki can contain an umlaut. The
     * unicode ranges are the ones Google Fonts splits the family on.
     */
    @font-face {
      font-family: "IBM Plex Mono";
      font-style: normal;
      font-weight: 400;
      font-display: swap;
      src: url("${PLEX_MONO_LATIN}") format("woff2");
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @font-face {
      font-family: "IBM Plex Mono";
      font-style: normal;
      font-weight: 400;
      font-display: swap;
      src: url("${PLEX_MONO_LATIN_EXT}") format("woff2");
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
    }
    /*
     * Two palettes, one per mode, selected by the data-theme attribute on <html>.
     * Nothing here reads prefers-color-scheme, so that attribute is the single
     * answer to "which mode is this": the head script below sets it from the
     * stored preference (src/config.ts) and, when that preference is system, from
     * the OS — before the first paint, and again whenever the OS flips. Each
     * palette is written once, so they cannot drift apart, and a rename of the
     * attribute is a failure rather than a silently unstyled window.
     *
     * The colours are wazoo.dev/DESIGN.md's, not this file's: Eggshell and Ink
     * for light, Void and Surface for dark, Sunset Orange for anything the user
     * can act on, and the spec's purple only behind selected text. That file is
     * not read at build time — a clone of this repository does not bring it
     * along — so the twelve documented tokens are copied here and
     * src/page_test.ts is what notices the copy going stale. Where the spec
     * gives one value for a role this app needs several of, the extras are
     * neutral steps between the values it does give, which is what keeps the
     * greys warm instead of drifting back to the cold ones this replaced.
     */
    :root {
      color-scheme: light;
      --canvas: #f7f2e8;
      --panel: #fffdf8;
      --panel-muted: #f2ede2;
      --line: #e2dacb;
      --line-strong: #cdc2ae;
      --surface-hover: #efe9dc;
      --surface-raised: #fbf7ef;
      --text: #1f1b14;
      --text-soft: #4b4332;
      --text-faint: #7c7c7c;
      --text-label: #1f1b14;
      --text-body: #2e2820;
      --text-editor: #241f18;
      --dot: #c4b9a4;
      --muted: #6b6355;
      --brand: #ff8c00;
      --brand-dark: #f57c00;
      /* Not the brand's own value: Sunset Orange on Eggshell is 2.1:1, which is
         a fill and a marker but never text. The accent that carries words is a
         darkened orange at 5:1, for the same reason the dark palette can keep
         the brand's value and this one cannot. */
      --brand-text: #a65000;
      --brand-soft: #fdebd2;
      --brand-marker: #ffaa00;
      /* Ink on Sunset Orange is 7.3:1. White on it would be 2.3:1, so the text
         on a brand-coloured button is the spec's light-mode ink either way. */
      --on-brand: #1f1b14;
      --brand-shadow: rgba(255, 140, 0, 0.24);
      --kbd-bg: #f2ede2;
      --kbd-line: #e2dacb;
      --warn-text: #8a5a00;
      --success: #17845b;
      --warning: #c77700;
      /* The one role the spec's purple has: selected text. */
      --selection-soft: rgba(132, 108, 228, 0.22);
      /* Syntax, read by the editor bundle's highlight style. */
      --syntax-heading: #1f1b14;
      --syntax-link: #a65000;
      --syntax-code: #7a4a12;
      --syntax-marker: #8a8172;
      --syntax-muted: #6b6355;
      --syntax-keyword: #9b2f6f;
      --syntax-string: #17724f;
      --syntax-number: #a8540a;
      --syntax-type: #2f6f9f;
      --overlay: rgba(31, 27, 20, 0.38);
      --focus-ring: rgba(255, 140, 0, 0.45);
      --toast-bg: #fffdf8;
      --shadow: 0 18px 45px rgba(31, 27, 20, 0.1);
      --sidebar-width: ${DEFAULT_SIDEBAR_WIDTH}px;
      --activity-bar-width: ${ACTIVITY_BAR_WIDTH}px;
      /* The brand row and the tab bar share this height so the divider under
         them is one continuous line across the window, not two steps. The
         status rows pair up the same way at the bottom edge. */
      --topbar-height: 41px;
      --statusbar-height: 26px;
    }

    :root[data-theme="dark"] {
      color-scheme: dark;
      /* Void and Surface, from the same file, and dark is the spec's default
         rather than this app's afterthought. */
      --canvas: #040404;
      --panel: #0f0f0f;
      --panel-muted: #131313;
      --line: #262626;
      --line-strong: #333333;
      --surface-hover: #1a1a1a;
      --surface-raised: #161616;
      --text: #b0b0b1;
      --text-soft: #9a9a9b;
      --text-faint: #7c7c7c;
      --text-label: #d4d4d5;
      --text-body: #b0b0b1;
      --text-editor: #c8c8c9;
      --dot: #3a3a3a;
      --muted: #7c7c7c;
      --brand: #ff8c00;
      --brand-dark: #f57c00;
      /* On void the brand's own value is 9:1, so here it can carry words. */
      --brand-text: #ff8c00;
      --brand-soft: rgba(255, 140, 0, 0.16);
      --brand-marker: #ffaa00;
      --on-brand: #1f1b14;
      --brand-shadow: rgba(255, 140, 0, 0.2);
      --kbd-bg: #141414;
      --kbd-line: #2a2a2a;
      --warn-text: #ffb74d;
      --success: #35c08c;
      --warning: #ffaa00;
      --selection-soft: rgba(132, 108, 228, 0.32);
      --syntax-heading: #ffffff;
      --syntax-link: #ffb74d;
      --syntax-code: #e8bd87;
      --syntax-marker: #8a8a8b;
      --syntax-muted: #939396;
      --syntax-keyword: #f0a6c8;
      --syntax-string: #8fd9ad;
      --syntax-number: #ffc27a;
      --syntax-type: #8fc7ff;
      --overlay: rgba(0, 0, 0, 0.66);
      --focus-ring: rgba(255, 140, 0, 0.45);
      --toast-bg: #161616;
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
      font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      /* The design system's own advice for monospaced text, and the reason it
         reads as set rather than typed. */
      letter-spacing: -0.025em;
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
    .dir-button:focus-visible, .tab:focus-visible, .tab-close:focus-visible,
    .search-hit-name:focus-visible, .search-match:focus-visible,
    .activity-button:focus-visible {
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
      flex-direction: row;
      min-height: 0;
      /* The resize handle is positioned against this box. */
      position: relative;
      border-right: 1px solid var(--line);
      background: var(--panel);
    }

    /*
     * The activity bar, and the pane beside it.
     *
     * The column is two boxes because the bar and the pane have different jobs
     * and different lifetimes: the bar belongs to the sidebar and survives every
     * view switch, while the pane, its toolbar, its listing and its footer all
     * belong to one view. That is the whole reason the switcher exists -- a new
     * view is a new pane, not a fourth block in a fixed order.
     *
     * The bar is inside the sidebar's width rather than beside it, so the width
     * clamp below has to spend this much of the window before the editor gives
     * up any.
     */
    .activity-bar {
      display: flex; flex-direction: column; align-items: center;
      width: var(--activity-bar-width); flex-shrink: 0;
      padding: 0 0 9px;
      border-right: 1px solid var(--line);
      background: var(--panel-muted);
    }
    .activity-tabs {
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      width: 100%;
    }
    /*
     * The mark keeps the top row's height so its baseline lines up with the
     * wordmark beside it and with the tab bar across the seam. The bar draws no
     * horizontal rule there: it is a column, and the pane's own divider ending
     * at its edge is what says where the top row stops.
     */
    .activity-brand {
      display: grid; place-items: center;
      width: 100%; height: var(--topbar-height); flex-shrink: 0;
      padding: 0; border: 0; border-bottom: 1px solid var(--line);
      background: transparent; color: inherit; cursor: pointer;
    }
    /*
     * The mark is the sidebar's toggle, and it is the top of the bar it hides.
     *
     * A button rather than a div with a listener, because the mark is the one
     * control in this app that has to be reachable without a pointer: a div is
     * not focusable and is not in the tab order, and a sidebar that can only be
     * closed by clicking is a sidebar some readers cannot close. Carrying the
     * sidebar-toggle class rather than a handler of its own is what keeps one
     * rule deciding what every toggle says, which is the same reason the tab
     * bar's copy is that class too.
     */
    .activity-brand:hover { background: var(--surface-hover); }
    .activity-brand:focus-visible { outline: 1px solid var(--brand-marker); outline-offset: -1px; }
    .activity-button {
      position: relative;
      display: grid; place-items: center;
      width: 40px; height: 40px; margin-top: 6px; padding: 0;
      border: 0; border-radius: 9px;
      color: var(--muted); background: transparent;
    }
    .activity-button:first-child { margin-top: 7px; }
    .activity-button:hover { color: var(--text); background: var(--surface-hover); }
    .activity-button.is-active { color: var(--brand-text); background: var(--brand-soft); }
    /*
     * The same rail the file list gives an open row, and for the same reason: a
     * tint alone is a distinction the eye can miss at the edge of the window.
     * A positioned bar rather than an inset shadow, because the button's radius
     * would hook the accent around its corners.
     */
    .activity-button.is-active::before {
      position: absolute; top: 9px; bottom: 9px; left: -4px; width: 2px;
      border-radius: 999px; background: var(--brand-marker); content: "";
    }
    .sidebar-pane {
      display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0;
    }
    .panes { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .pane { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    /*
     * Each pane names itself. The activity bar says which view is on in a
     * column of glyphs, which is a visual answer; this is the one a screen
     * reader lands on, and the one a user looks for when the bar's marks are
     * small.
     */
    .pane-title {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 13px 6px;
      color: var(--muted); font-size: 9.5px; font-weight: 750;
      letter-spacing: .09em; text-transform: uppercase;
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
    .tabbar .sidebar-toggle { align-self: flex-start; }
    /*
     * The official Wazoo mark, inline so the page stays one string with no
     * asset route. Used bare and unrecoloured: the brand guide forbids
     * stretching, rotating, or recolouring the logo assets. Copy of
     * https://wazoo.dev/assets/wazoo.svg (the file the site and its JSON-LD
     * both point at), with the clip-path id namespaced for inlining.
     */
    /*
     * The mark, which the activity bar owns the top slot of. It was the first
     * thing in the brand row and is now the corner of the strip, so the wordmark
     * beside it has the row to itself -- which is what the brand block "had room
     * to give up" means in practice. A span rather than a div because its new
     * home is a button, and a button's content is phrasing content only.
     */
    .brand-mark { display: grid; place-items: center; width: 26px; height: 26px; flex-shrink: 0; }
    .brand-mark svg { width: 100%; height: 100%; }
    /* Explicit line-heights: the two lines have to fit the row's padding box,
       and a fallback font's natural metrics are taller than the token allows. */
    /* The wordmark is the one thing the design system keeps sans: Inter for the
       logotype, IBM Plex Mono for everything else. Inter is not embedded, so
       this is a named local face with a real fallback rather than a promise. */
    .brand-name {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px; font-weight: 760; line-height: 1.2; letter-spacing: -.01em;
    }
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
     * A view's own toolbar, drawn inside the pane rather than across the top of
     * the sidebar. It used to be the file list's, and that was the coupling:
     * Filter, Assets, Extensions and New file all act on a listing, so with a
     * switcher they belong to the Explorer view and a view whose content is not
     * a listing has no use for any of them. Each pane brings its own; one that
     * needs none (Recently changed) has none.
     *
     * A view's toolbar is hidden outright with no vault open, for the reason it
     * was: the listings behind it empty, so what was left was a filter over
     * nothing and a disabled create button.
     */
    .view-tools { display: flex; align-items: center; gap: 6px; }
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
      color: var(--text-soft); font-size: 11px; white-space: nowrap; cursor: pointer;
    }
    /* accent-color is the one piece of a native control the palette does not
       reach on its own: left alone, the three switches are the platform's blue
       in an otherwise orange window. */
    .assets-toggle input { margin: 0; accent-color: var(--brand); }
    /*
     * Two rows at every width, which is the whole point of the order below: the
     * filter takes what is left of the first row and the button sits on it, and
     * the switches get the second row to themselves. The button used to come
     * after the switches, so it only joined their row when the column was at
     * least 250px wide and dropped to an orphaned row of its own below that —
     * three rows of toolbar at the default width's left-hand end, and a fourth
     * line for the file list in a column the user had made narrower on purpose.
     */
    .view-tools { flex-wrap: wrap; padding: 0 10px 8px; }
    .view-tools .filter { flex-basis: 100px; }
    /*
     * A full basis is what pins this to its own row, so the row count does not
     * depend on how far the column happens to be dragged. And it wraps inside
     * itself rather than shrinking: three switches are 179px of text, the
     * column's inner width at the 180px minimum is 160px, and clipping "Paths"
     * is the one outcome the wrap above exists to prevent — which, at that
     * width, it did not.
     */
    .view-tools-checks {
      display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px;
      flex-basis: 100%; flex-shrink: 0;
    }

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
    .file-time { display: block; color: var(--muted); font-size: 10px; }
    .file-empty { padding: 12px 9px; color: var(--muted); font-size: 11.5px; line-height: 1.5; }

    /*
     * A pane split in two: the sections above and below a divider, each with
     * its own header, its own count, and its own scroll. The heights are set
     * from the script as a flex ratio rather than as pixels, so the pair still
     * adds up when the sidebar is resized underneath them and when the pane is
     * taller or shorter than it was.
     */
    .split { display: flex; flex: 1; min-height: 0; flex-direction: column; }
    .split-pane { display: flex; min-height: 0; flex-direction: column; }
    #changesPane { flex: 7 1 0; }
    #historyPane { flex: 3 1 0; }
    .split-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    /* Collapsed means folded to its header, so the section it shares the column
       with gets the space. */
    .split-pane.is-collapsed { flex: 0 0 auto; }
    .split-pane.is-collapsed .split-body { display: none; }

    .split-head { flex: none; }
    /*
     * The commit box at the foot of the changes section: what git has pending,
     * a line to write the message on, and the buttons that act on both.
     *
     * It sits below the list rather than above it because the list is what
     * the reader is reading and the box is what they do once they have decided.
     * It is pinned to the bottom of the section rather than scrolling with the
     * list, because a Commit button that scrolls out of reach halfway down a
     * long vault is a button nobody finds.
     *
     * One row each, top to bottom: state, field, actions, branch. The field
     * used to share a row with both buttons, and at a 230px sidebar -- which is
     * the default and not an edge case -- the three of them did not fit: the
     * field was crushed to about fifteen pixels and the Commit label ran off
     * the edge of the sidebar and was cut. A field is the one control here that
     * cannot be abbreviated, so it takes the width and the buttons share what
     * is left.
     *
     * The vertical rhythm: 6px between the field and the buttons, which the
     * reader does in sequence; 8px where the box changes subject, before the
     * branch row; 3px under a line of small text. Every control is 28px tall,
     * so the field and the buttons share a baseline rather than stepping.
     */
    .commit-box {
      flex: none; margin: 0; padding: 8px 8px 9px;
      border-top: 1px solid var(--line); background: var(--surface-raised);
    }
    .commit-state {
      margin-bottom: 6px; color: var(--muted); font-size: 10.5px; line-height: 1.4;
    }
    .commit-state.is-error { color: var(--brand-text); }
    .commit-row { display: flex; gap: 6px; align-items: center; }
    .commit-input {
      display: block; width: 100%; min-width: 0; height: 28px; padding: 0 8px;
      border: 1px solid var(--line); border-radius: 6px;
      background: var(--panel); color: var(--text-body);
      font-family: inherit; font-size: 11.5px;
    }
    .commit-input:focus-visible { outline: 1px solid var(--brand-marker); outline-offset: -1px; }
    .commit-actions { margin-top: 6px; }
    /* Amend keeps the width its word needs and Commit takes the rest, so the
       primary action is the large one and the two do not swap sizes as the
       label changes between "Commit" and "Commit 12". Both clip to an
       ellipsis rather than overflowing the box, which is what a min-width on
       its own invites in a column this narrow. */
    .commit-button {
      flex: none; min-width: 0; height: 28px; padding: 0 9px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    /* Amend gives up width before Commit does: the primary verb is the one a
       reader is reaching for, and a 46px floor keeps its own word from
       disappearing entirely in a column this narrow. */
    .commit-amend { flex: 0 1 auto; min-width: 46px; }
    .commit-primary { flex: 1 1 auto; }
    .commit-remote { margin-top: 8px; }
    /* Reference rather than status: this names where Push would send the
       branch, so it truncates instead of wrapping. Wrapped, it ran to eight
       lines in a 98px column and pushed the History section off the bottom of
       a 675px window. The full text is in the tooltip, and the status line
       underneath carries the part that changes what the reader does. */
    .commit-branch {
      flex: 1; min-width: 0; color: var(--muted); font-size: 10.5px; line-height: 1.4;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .commit-branch-status {
      margin-top: 3px; color: var(--muted); font-size: 10.5px; line-height: 1.4;
    }
    .commit-branch-status:empty { display: none; }
    .commit-branch-status.is-error { color: var(--brand-text); }
    /* A vault that is not in a repository has no source control at all, so the
       box says so once and drops the controls that could never act. A greyed
       out Amend and a dead Push under a disabled field is three affordances
       for a feature that is not there. */
    .commit-box.is-unavailable .commit-amend,
    .commit-box.is-unavailable .commit-remote,
    .commit-box.is-unavailable .commit-branch-status { display: none; }
    /* A detached HEAD is not a branch: there is nowhere for Push to go and no
       branch name to show, so the row goes rather than saying so in the space
       of two. */
    .commit-box.has-no-branch .commit-remote { display: none; }
    .commit-note {
      margin-top: 5px; color: var(--muted); font-size: 10.5px; line-height: 1.4;
    }
    .commit-note:empty { display: none; }
    .commit-note.is-error { color: var(--brand-text); }
    /*
     * A row the reader can tick. The checkbox is a real input rather than a
     * drawn box so the keyboard, the focus ring and the platform's own
     * high-contrast rendering all come with it, and it is a label wrapping the
     * input so the row's file name is its accessible name for free.
     */
    .change-check {
      display: grid; place-items: center; flex: none;
      width: 22px; align-self: stretch; cursor: pointer;
    }
    .change-check input { margin: 0; cursor: pointer; }
    .file-list > li:has(.change-check) { display: flex; align-items: stretch; }
    .file-list > li:has(.change-check) .file-button { flex: 1; min-width: 0; }
    .split-toggle {
      display: flex; align-items: center; gap: 4px; width: 100%;
      padding: 5px 8px; border: 0; background: transparent;
      color: var(--text-body); font-size: 11px; font-weight: 700; text-align: left;
    }
    .split-toggle:hover { background: var(--surface-hover); }
    .split-toggle .icon { flex: none; color: var(--muted); }
    /* One rule turns the chevron sideways, so there is no second icon to keep
       in step with the first. */
    .split-toggle[aria-expanded="false"] .icon { transform: rotate(-90deg); }
    .split-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* The count is what lets a section be sized without being opened, so it is
       the one piece of the header that is never truncated. */
    .split-count {
      flex: none; min-width: 16px; padding: 0 5px; border-radius: 999px;
      background: var(--surface-hover); color: var(--muted);
      font-size: 9.5px; font-weight: 600; line-height: 14px; text-align: center;
    }

    /*
     * The divider between the two sections. A real 7px target around a hairline,
     * because a 1px handle is a handle nobody can find, and it takes the
     * sidebar resizer's keyboard contract wholesale: it is a separator, it is
     * focusable, the arrows move it a step and Shift a bigger one, and Home and
     * End take it to either end.
     */
    .pane-divider {
      flex: none; height: 7px; margin: 0 -7px; cursor: row-resize;
      background: transparent; touch-action: none;
    }
    .pane-divider::after {
      display: block; height: 1px; margin: 3px 7px;
      background: var(--line); content: "";
    }
    .pane-divider:hover::after, .pane-divider.is-dragging::after { background: var(--brand-marker); }
    .pane-divider:focus-visible { outline: 1px solid var(--brand-marker); outline-offset: -1px; }

    /*
     * The history: one entry per day, on a rail, the way a commit graph reads.
     * The rail is a border on the day column rather than a drawn element per
     * entry, so it is continuous for free and a day with no files never leaves
     * a gap in it.
     */
    .activity { flex: 1; min-height: 0; margin: 0; padding: 2px 7px 8px; overflow-y: auto; list-style: none; scrollbar-width: thin; }
    .activity-day { position: relative; padding: 3px 0 3px 15px; }
    /* The rail: the first day starts it, the last one stops it, and every day in
       between runs one continuous line. */
    .activity-day::before {
      position: absolute; top: 0; bottom: 0; left: 4px; width: 1px;
      background: var(--line); content: "";
    }
    .activity-day:first-child::before { top: 9px; }
    .activity-day:last-child::before { bottom: auto; height: 9px; }
    .activity-day:only-child::before { display: none; }
    /* The commit dot, over the rail. */
    .activity-day::after {
      position: absolute; top: 7px; left: 1px; width: 7px; height: 7px;
      border: 2px solid var(--surface-raised); border-radius: 50%;
      background: var(--brand-marker); box-sizing: border-box; content: "";
    }
    .activity-day:first-child::after { background: var(--brand-text); }
    .activity-when { display: block; color: var(--text-body); font-size: 10.5px; font-weight: 700; }
    .activity-files { margin: 1px 0 0; padding: 0; list-style: none; }
    .activity-files .file-button { padding: 2px 6px; font-size: 11px; }

    /*
     * A view's footer, inside the pane for the same reason as its toolbar. It
     * was one row for the whole sidebar, and its one piece of content — "95
     * files" — means nothing in a search view, so each pane now carries its own
     * and the word is spent on that view.
     */
    .view-status {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      height: var(--statusbar-height); padding: 0 13px;
      border-top: 1px solid var(--line); color: var(--muted); font-size: 10px;
    }

    /*
     * Search results: a file's name, then its matching lines under it.
     *
     * Grouped rather than flattened because a hit in a wiki is nearly always
     * "this page, these lines" — a flat list of lines makes the reader assemble
     * that grouping from sixty rows, which is the work the grouping is for.
     */
    .search-results {
      flex: 1; min-height: 0; padding: 0 7px 8px; overflow-y: auto; list-style: none;
      scrollbar-width: thin;
    }
    .search-hit { margin-bottom: 5px; }
    .search-hit-name {
      display: flex; align-items: baseline; gap: 6px; width: 100%;
      padding: 4px 8px; border: 0; border-radius: 6px;
      color: var(--text-body); background: transparent; text-align: left; font-size: 12px;
    }
    .search-hit-name:hover { background: var(--surface-hover); }
    .search-hit-more { color: var(--muted); font-size: 9.5px; }
    .search-match {
      display: flex; align-items: baseline; gap: 7px; width: 100%;
      padding: 3px 8px 3px 14px; border: 0; border-radius: 6px;
      color: var(--text-soft); background: transparent; text-align: left; font-size: 11px; line-height: 1.35;
    }
    .search-match:hover { color: var(--text); background: var(--surface-hover); }
    .search-line { flex-shrink: 0; color: var(--muted); font-size: 9.5px; }
    .search-preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .search-empty { padding: 12px 9px; color: var(--muted); font-size: 11.5px; line-height: 1.5; }
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
    /* A path is text about a file, so it takes the same face as everything else
       rather than reaching for a local monospace of its own. */
    .path-row .filter { flex: 1; font-family: inherit; }
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
      /* The bar keeps its own width here: it is the only way to change view
         while the drawer is up, and the scrim only dismisses a click that lands
         outside the drawer, which a bar button never is. */
      .activity-bar { padding-bottom: 0; }
      /* The drawer is an overlay whose position is the state itself, so a
         resize handle on its edge would fight the slide-in. */
      .resizer { display: none; }
      /* The drawer overlays the workspace here, so the rows no longer have to
         line up — and a wrapping tab or status bar must be free to grow. */
      .brand, .tabbar { height: auto; min-height: var(--topbar-height); }
      .view-status, .statusbar { height: auto; min-height: var(--statusbar-height); }
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
      <nav class="activity-bar" aria-label="Sidebar views">
        <button class="activity-brand sidebar-toggle" type="button" title="Hide vault files (Ctrl+B)" aria-label="Hide vault files" aria-expanded="true">
          <span class="brand-mark" aria-hidden="true">
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
          </span>
        </button>
        <div role="tablist" id="activityBar" aria-orientation="vertical" aria-label="Views">
        ${PANES.map(activityButton).join("\n        ")}
        </div>
      </nav>

      <div class="sidebar-pane">
      <div class="brand">
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

      <div class="panes" id="sidebarPanes">
        ${PANES.map((view) => paneMarkup(view.key)).join("\n        ")}
      </div>
      </div>

      <div class="resizer" id="sidebarResizer" role="separator" aria-orientation="vertical"
           aria-label="Resize the vault sidebar" aria-controls="sidebarPanes"
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
            <p id="placeholderNoFileText">Pick a file from the Explorer view to open it in a tab.</p>
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
      // The switches, as the table in src/page.ts declared them. Injected
      // rather than written again here: the table is what drew the markup
      // above, and this is the same list the script wires up, so the two cannot
      // be different lists.
      const LIST_VIEWS = ${JSON.stringify(LIST_VIEWS)};
      // And the views, from the same kind of table in the same file. The markup
      // above drew the bar and the panes from it; this is the list the script
      // switches between and the menu's View entries are generated from, so
      // the three cannot be different lists.
      const PANES = ${
  JSON.stringify(
    PANES.map(({ key, label }) => ({ key, label })),
  )
};
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
      const viewTools = el('viewTools');
      const searchTools = el('searchTools');
      const searchQuery = el('searchQuery');
      const searchResults = el('searchResults');
      const searchStatus = el('searchStatus');
      const recentList = el('recentList');
      const commitState = el('commitState');
      const commitMessage = el('commitMessage');
      const commitButton = el('commitButton');
      const amendButton = el('amendButton');
      const pushButton = el('pushButton');
      const remoteState = el('remoteState');
      const remoteStatus = el('remoteStatus');
      const commitNote = el('commitNote');
      const commitBox = el('commitBox');
      const recentHistory = el('recentHistory');
      const recentStatus = el('recentStatus');
      const recentSplit = el('recentSplit');
      const recentDivider = el('recentDivider');
      const changesPane = el('changesPane');
      const changesToggle = el('changesToggle');
      const changesCount = el('changesCount');
      const historyPane = el('historyPane');
      const historyToggle = el('historyToggle');
      const historyCount = el('historyCount');
      // The two sections as one list, because folding one and counting one are
      // the same two lines each and the divider's arithmetic is a third. The ids
      // are written out above rather than built from a key on purpose: that is
      // what lets the page tests check every one of them against the markup.
      const splitSections = [
        { pane: changesPane, toggle: changesToggle, count: changesCount },
        { pane: historyPane, toggle: historyToggle, count: historyCount },
      ];
      const vaultPath = el('vaultPath');
      const filterInput = el('filter');
      // The three switches, each paired with the elements it owns. One list
      // drives the markup above, the listeners below, and the Appearance
      // commands, so a switch cannot have a checkbox in one of those and not
      // the other two.
      const listViews = LIST_VIEWS.map((view) => ({
        ...view,
        input: el(view.key),
        label: el(view.labelId),
      }));
      // And one lookup by key, so the setter below does not have to search.
      const viewByKey = {};
      for (const view of listViews) viewByKey[view.key] = view;
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
      // The bar's buttons and the panes they switch to, matched by data-view
      // rather than by id: the two lists are drawn from the same table above,
      // and a pane with no button would leave it unreachable.
      const activityBar = el('activityBar');
      const activityButtons = document.querySelectorAll('.activity-button');
      const sidebarPanes = document.querySelectorAll('.pane');

      // Below this width the sidebar is a drawer rather than a column, so the
      // same button means "slide it in" instead of "collapse the column".
      const narrowWindow = window.matchMedia('(max-width: 640px)');

      /*
       * The split between the changes list and the history below it, as the
       * share of the pane the first one takes.
       *
       * A ratio rather than a height because the pane belongs to the window: a
       * height chosen on a tall window is most of a short one. The bounds are
       * the two ends of that bargain -- a section squeezed to nothing is a
       * section that was not really offered, and one left with the lot is a
       * split that is not one. They are imported from the settings file rather
       * than written here, because the same three numbers are what the stored
       * ratio is clamped to on the other side of the transport.
       *
       * The split is remembered. It used not to be, on the grounds that a split
       * set once for one session is not a preference -- but the reader who
       * dragged the history down to a rail did that because of what they were
       * reading, and they will be reading the same vault tomorrow. A divider
       * that forgets is a divider dragged once per launch.
       */
      /** Below this, the pane cannot be divided at all and the split holds still. */
      const MIN_SPLIT_PANE_HEIGHT = 72;

      /** Clamp a stored or dragged share to the ends the divider can reach. */
      function clampSplitRatio(ratio) {
        // A value the transport never sent must not reach a flexGrow as NaN,
        // which would drop both sections to their content height.
        const wanted = Number.isFinite(ratio) ? ratio : ${DEFAULT_SPLIT_RATIO};
        return Math.min(
          ${MAX_SPLIT_RATIO},
          Math.max(${MIN_SPLIT_RATIO}, wanted),
        );
      }

      /**
       * Put the split where this share says, and say where that ended up.
       *
       * Separate from the divider's own handler because the stored share
       * arrives with the launch state, before anything has been dragged:
       * applying it is a redraw, not an event, and it has no reason to wait
       * for a pointer to find out what height the window turned out to be.
       */
      function applySplit(ratio) {
        // Rounded to a thousandth before anything else sees it, and returned
        // rounded rather than raw, because that is the share that gets stored.
        // Adding 0.1 to 0.7 in binary lands just under it, so an unrounded
        // share would put 0.30000000000000004 in the settings file and drift a
        // little further on every nudge.
        const share = Math.round(clampSplitRatio(ratio) * 1000) / 1000;
        const grow = Math.round(share * 100) / 10;
        changesPane.style.flexGrow = String(grow);
        historyPane.style.flexGrow = String(10 - grow);
        recentDivider.setAttribute(
          'aria-valuenow',
          String(Math.round(share * 100)),
        );
        return share;
      }

      /*
       * Which history answer is the current one.
       *
       * The same guard the search view uses, for the same reason: asking the
       * backend for the days is a round trip, and a slow earlier answer landing
       * on a newer one is how a list ends up drawn twice.
       */
      let historyToken = 0;

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
        sidebarWidth: ${DEFAULT_SIDEBAR_WIDTH},
        sidebarView: '${DEFAULT_SIDEBAR_VIEW}',
        splitRatio: ${DEFAULT_SPLIT_RATIO},
        theme: '${DEFAULT_THEME}',
      };
      // Before the stored state arrives, every switch is worth its default, so
      // the toolbar never draws a checkbox that disagrees with the list behind
      // it for the moment between the two.
      for (const view of LIST_VIEWS) vault[view.key] = view.default;
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
          const result = await bridge[name](...(args || []));
          lastCallError = '';
          return result;
        } catch (error) {
          lastCallError = (error && error.message) || 'Something went wrong.';
          showToast(lastCallError);
          return null;
        }
      }

      /**
       * Why the last call failed, kept so a pane can say it in place.
       *
       * A toast is the right answer for something that just went wrong on its
       * own, and the wrong one for a failure the reader is about to try again:
       * the commit box needs to carry the reason next to the button, because
       * a git that refuses for an unconfigured author is a sentence about what
       * to do next, and a toast that has already faded is not.
       */
      let lastCallError = '';

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

      /* Views: one switcher, and every pane's own chrome */

      /**
       * The view whose name the state should hold, or the file list.
       *
       * Coerced in the page as well as in the binding, for the same reason the
       * theme is: the stored state is a value from a settings file, and a view
       * this build has no pane for would leave the sidebar showing nothing at
       * all. An unknown name is a file list, which is the one answer that is
       * always there.
       */
      function knownView(view) {
        return PANES.some((entry) => entry.key === view) ? view : '${DEFAULT_SIDEBAR_VIEW}';
      }

      /**
       * Show one view's pane and hide the rest. This is the whole of the
       * switcher: nothing here knows what any pane contains, so a view is
       * added by writing a pane and a row in the table, and the switcher is not
       * edited.
       *
       * The choice is worth keeping -- it is where the user was, the way the
       * sidebar's width and collapsed state are -- so it is written to the
       * settings unless this is just applying stored state.
       */
      function setSidebarView(view, persist) {
        const next = knownView(view);
        vault.sidebarView = next;
        for (const button of activityButtons) {
          const active = button.dataset.view === next;
          button.classList.toggle('is-active', active);
          button.setAttribute('aria-selected', String(active));
          // Roving tabindex: the bar is one tab stop, and the arrows move
          // within it, which is what a row of role="tab" buttons owes its user.
          button.tabIndex = active ? 0 : -1;
        }
        for (const pane of sidebarPanes) pane.hidden = pane.dataset.view !== next;
        // Redrawn on arrival rather than kept: a search scan is milliseconds on
        // a wiki-sized vault, and it is the only way the results can never be
        // describing a file that has since been saved over.
        if (next === 'search') runSearch();
        if (next === 'recent') renderRecent();
        if (persist) {
          call('setSidebarView', [next]);
          refreshMenu();
        }
      }

      /** The bar's own click: switch view, or fold the sidebar away if it is already on. */
      function chooseView(view) {
        if (view === vault.sidebarView && !narrowWindow.matches) {
          toggleSidebar();
          return;
        }
        setSidebarView(view, true);
      }

      function wireActivityBar() {
        for (const button of activityButtons) {
          button.addEventListener('click', () => chooseView(button.dataset.view));
        }
        activityBar.addEventListener('keydown', (event) => {
          const step = event.key === 'ArrowDown' ? 1
            : event.key === 'ArrowUp' ? -1
            : 0;
          if (step === 0) return;
          event.preventDefault();
          const buttons = Array.from(activityButtons);
          const current = buttons.indexOf(document.activeElement);
          const next = (current + step + buttons.length) % buttons.length;
          // Moving the focus is not moving the view: arrow keys across a bar
          // land on a button and say so, and Enter or Space takes it. Switching
          // under the keyboard as the focus moves would make the arrows feel
          // like they were skipping steps.
          buttons[next].focus();
        });
      }

      /**
       * Apply one of the list's switches, and tell the two controls that show
       * it.
       *
       * One function for all three, because they differ in what they change and
       * not in how: the state, the checkbox beside the list, the item in the
       * Appearance menu, and the stored value all move together here, and each
       * of the three redraws the other two. That is what stops the menu and the
       * sidebar from answering differently about the same setting — and what
       * Assets was missing when it alone was per-session.
       */
      function setListView(key, show, persist) {
        vault[key] = show;
        if (persist) call(viewByKey[key].operation, [show]);
        viewByKey[key].input.checked = show;
        renderFiles();
        refreshMenu();
      }

      /** The name as the list draws it, which may be without its extension. */
      function listedName(file) {
        // The switch itself is table-driven; what it changes is not, because
        // only the name is shortened. Turned off, the extension is hidden here
        // and shown only where a name is being typed — the New file prompt,
        // which has to carry the real name regardless. The tab strip and the
        // status bar keep it, because a tab is the document's identity rather
        // than one entry in a list of similar names.
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
      // The activity bar is inside the column rather than beside it, so the
      // floor is spent before the column can be asked to grow: a sidebar
      // dragged out to 520px on a 900px window would otherwise leave the editor
      // 380px, which is the width this floor exists to prevent.
      const ACTIVITY_BAR_WIDTH = ${ACTIVITY_BAR_WIDTH};

      function widestSidebarThatFits() {
        return Math.max(
          ${SIDEBAR_MIN_WIDTH},
          Math.min(
            ${SIDEBAR_MAX_WIDTH},
            window.innerWidth - WORKSPACE_FLOOR - ACTIVITY_BAR_WIDTH,
          ),
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

      async function openFile(path, line) {
        setSidebarOpen(false);
        const existing = tabs.findIndex((tab) => tab.path === path);
        if (existing !== -1) {
          selectTab(existing);
        } else {
          const payload = await call('readFile', [path]);
          if (payload === null) return;
          openPayload(payload);
        }
        // A search result names a line, and the jump has to follow the open
        // rather than lead it: the editor holds one document at a time, so a
        // jump issued first would land on whatever was on screen and leave the
        // line the user clicked in a file they were not looking at.
        if (typeof line === 'number' && line > 0) editorApi?.goToLine(line);
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
        // from it has nothing to act on and goes with it. Search and Recently
        // changed hide their toolbars the same way; their panes stay, and say
        // why they are empty.
        viewTools.hidden = !open;
        searchTools.hidden = !open;
        newFileButton.disabled = !open;
        renderRecent();
        refreshMenu();
      }

      /**
       * The files the listing is offering right now, with the Assets switch
       * applied. Shared rather than written twice: the Explorer list and the
       * Recently changed sort are the same set in a different order, and a
       * second copy of the switch's rule would be one that could disagree.
       */
      function listedFiles() {
        if (hasAssetFiles() && vault.showAssets) return files;
        return files.filter((file) => file.scope !== 'asset');
      }

      function hasAssetFiles() {
        return files.some((file) => file.scope === 'asset');
      }

      function renderFiles() {
        // The vault's own config says which files are the wiki's pages. Its
        // static files are one tick away by default, because a build output
        // folder beside 400 pages is not what a wiki looks like.
        const hasAssets = hasAssetFiles();
        // The switch reads the state rather than the checkbox, so the stored
        // preference survives a vault that has nothing to offer: the checkbox
        // is a mirror of the state, never the other way round, which is what
        // made Assets forget itself on every launch.
        for (const view of listViews) {
          if (view.needsAssets) view.label.hidden = !hasAssets;
        }
        const listed = listedFiles();
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
          if (vault.showPaths) {
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
            : 'Pick a file from the Explorer view to open it in a tab.';
        }
        // The recently changed list draws the same rows, so the open and active
        // rails on it follow the tab strip -- but only while it is the pane on
        // screen, because rebuilding it on every keystroke of the Explorer's
        // filter would be a list of thousands rebuilt to be looked at by nobody.
        if (vault.sidebarView === 'recent') renderRecent();
      }

      /* Search and Recently changed: the other two panes */

      /**
       * One keystroke is not one search. The scan itself is a walk of a few
       * hundred kilobytes and needs nothing around it, but a vault at the
       * listing's 5000-file bound is a different matter, and firing a scan per
       * character is the one thing that would make the window stutter. A short
       * wait, and a token so a slow earlier answer cannot land on top of a
       * newer one.
       */
      const SEARCH_DEBOUNCE_MS = 150;
      let searchTimer;
      let searchToken = 0;

      function scheduleSearch() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
      }

      async function runSearch() {
        const query = searchQuery.value.trim();
        const token = (searchToken += 1);
        if (vault.root === null) {
          searchResults.textContent = '';
          searchStatus.textContent = 'No vault open';
          return;
        }
        if (query === '') {
          searchResults.textContent = '';
          searchStatus.textContent = 'Type to search every page';
          return;
        }
        const hits = await call('search', [query]);
        // A response that is no longer the question is discarded rather than
        // drawn: rendering it would show results for a string the box no longer
        // holds.
        if (token !== searchToken) return;
        renderSearch(Array.isArray(hits) ? hits : [], query);
      }

      function renderSearch(hits, query) {
        searchResults.textContent = '';
        const total = hits.reduce((sum, hit) => sum + hit.matches.length, 0);
        searchStatus.textContent = total === 0
          ? 'No page contains "' + query + '"'
          : total + (total === 1 ? ' match in ' : ' matches in ') + hits.length +
            (hits.length === 1 ? ' file' : ' files');
        if (hits.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'search-empty';
          empty.textContent = 'Searches the text of every file in this vault. ' +
            'Names, not just pages, so a word in a .yml is found too.';
          searchResults.appendChild(empty);
          return;
        }

        for (const hit of hits) {
          const group = document.createElement('div');
          group.className = 'search-hit';
          group.setAttribute('role', 'listitem');

          const name = document.createElement('button');
          name.type = 'button';
          name.className = 'search-hit-name';
          name.title = hit.path;
          const label = document.createElement('span');
          label.textContent = baseName(hit.path);
          name.appendChild(label);
          // Said rather than implied: a file holding more matches than the row
          // carries must not look like that was all of them.
          if (hit.truncated) {
            const more = document.createElement('span');
            more.className = 'search-hit-more';
            more.textContent = 'more matches';
            name.appendChild(more);
          }
          // The file's own row opens its first match, which is what a reader
          // who clicked the page's name rather than a line wanted.
          name.addEventListener('click', () => openFile(hit.path, hit.matches[0].line));
          group.appendChild(name);

          for (const match of hit.matches) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'search-match';
            row.title = hit.path + ':' + match.line;
            const at = document.createElement('span');
            at.className = 'search-line';
            at.textContent = match.line;
            const preview = document.createElement('span');
            preview.className = 'search-preview';
            preview.textContent = match.text;
            row.appendChild(at);
            row.appendChild(preview);
            row.addEventListener('click', () => openFile(hit.path, match.line));
            group.appendChild(row);
          }
          searchResults.appendChild(group);
        }
      }

      /**
       * The listing, newest write first, with when that was in words under each
       * name. This is the question a wiki reader opens the app with -- what is
       * new in here -- and it needed no operation behind it: the walk already
       * records each file's modification time for exactly this.
       *
       * Both sections are redrawn on arrival rather than kept, and the history
       * asks the backend for its days rather than bucketing the listing here:
       * which day a write belongs to is decided once, in src/vault.ts, where it
       * is tested, and a second copy of that rule in this string would be one
       * more thing to keep in step.
       */
      function renderRecent() {
        const recent = recentFiles();
        if (vault.root === null) {
          recentStatus.textContent = 'No vault open';
        } else if (recent.length === 0) {
          recentStatus.textContent = 'No files in this vault';
        } else {
          recentStatus.textContent = latestSentence(recent[0].modified);
        }
        changesCount.textContent = String(recent.length);
        renderChanges(recent);
        renderHistory();
        // The ticks are git's answer rather than the listing's, and the working
        // tree moves without the app hearing about it, so this is asked for
        // every time the pane is drawn rather than once at launch.
        refreshGitStatus();
      }

      /**
       * The listing as this view wants it: newest write first.
       *
       * One function rather than a sort at each of the two places that need
       * it, because the list is drawn twice — once by the pane, and once more
       * by a status arriving — and a second sort is a second answer to which
       * file is "most recent".
       */
      function recentFiles() {
        return listedFiles().slice().sort((left, right) =>
          right.modified - left.modified
        );
      }

      /*
       * What git has pending for this vault, and what the reader has ticked.
       *
       * gitPending is null until the first status lands, and null again
       * whenever the answer is "this folder is not a repository" -- which is
       * not the same as an empty map, because a vault outside a repository and
       * a repository with nothing to commit are two different sentences and
       * the pane has to be able to say which one it is.
       *
       * ticked is per session and never stored: it is a decision about files
       * that are changing underneath it, and a stored tick would be a stored
       * claim about a working tree that no longer exists.
       */
      let gitPending = null;
      let ticked = new Set();
      let gitPendingTotal = 0;
      let gitNote = '';
      let gitNoteIsError = false;
      let committing = false;
      let amending = false;
      let pushing = false;
      let gitToken = 0;
      /*
       * Where the branch stands against the remote, or null when there is no
       * repository to ask. Every field inside it can be null for a different
       * reason -- no branch, no upstream, no count -- and the box says which,
       * because "nothing to push" and "we do not know whether there is anything
       * to push" are not the same sentence and only the first one is an answer
       * the button can act on.
       */
      let gitRemote = null;

      /**
       * Ask git what is pending, then redraw the list's ticks and the box.
       *
       * Token-guarded for the same reason the history is: opening the pane and
       * a save landing together can put two statuses in flight, and the slower
       * one would otherwise draw its answer under a list that has already moved
       * on. Only the newest answer is allowed to write.
       *
       * A failure is a sentence in the box rather than an exception: a vault
       * with no git installed, or a git that will not answer, is an ordinary
       * state for a reader to be in, and the rest of the pane still works.
       */
      async function refreshGitStatus() {
        const token = (gitToken += 1);
        if (vault.root === null) {
          gitPending = null;
          gitPendingTotal = 0;
          gitRemote = null;
          ticked = new Set();
          updateCommitBox();
          return;
        }
        const result = await call('vaultStatus', []);
        if (token !== gitToken) return;
        if (result === null) {
          // Null is also how a failed call comes back, so the distinction is
          // made by whether anything was pending a moment ago: a folder that
          // has never been a repository and a git that just failed both leave
          // nothing pending, and the note carries the difference.
          gitPending = null;
          gitPendingTotal = 0;
          gitRemote = null;
          ticked = new Set();
          // A null answer is either "not a repository", which needs no note
          // because the state line already says it, or a call that failed,
          // which does. The two are told apart by the message being there.
          setGitNote(lastCallError, lastCallError !== '');
          updateCommitBox();
          return;
        }
        gitPending = new Map(
          result.changes.map((change) => [change.path, change]),
        );
        gitPendingTotal = result.total;
        gitRemote = result.remote;
        // Ticks follow git: a path that no longer has a pending change cannot
        // stay ticked, because committing it would be committing nothing. A tick
        // the reader placed on a file that is still pending is left alone,
        // because that is a decision they made and re-deciding it for them
        // would be the app second-guessing a person on every refresh.
        for (const path of [...ticked]) {
          if (!gitPending.has(path)) ticked.delete(path);
        }
        // Everything git has pending starts ticked. Unticking is the decision
        // and ticking is the absence of one, which is the right way round: the
        // reader still has to write a message and press the button, and a box
        // that has to be ticked once per file before anything can happen is a
        // box nobody reaches. A tick the reader placed stays placed as long as
        // the file is still pending, because that is a decision they made.
        for (const path of gitPending.keys()) ticked.add(path);
        updateCommitBox();
        renderChanges(recentFiles());
      }

      /** What the box says about the repository, above the message line. */
      function updateCommitBox() {
        const paths = [...ticked];
        // One readiness for all three verbs. They take the same ticked files
        // and the same message, so a box that let one of them through while
        // the others were disabled would be saying the gesture is not ready
        // and then doing it anyway.
        const ready = gitPending !== null &&
          paths.length > 0 &&
          commitMessage.value.trim() !== '' &&
          !committing &&
          !pushing;
        commitButton.disabled = !ready;
        // The count is on the button without the noun: at the default sidebar
        // width "Commit 1 file" does not fit beside Amend, and what the
        // overflow did to it was cut the word off mid-label. The state line
        // above says what the files are, so the button can say how many.
        commitButton.textContent = committing
          ? 'Committing'
          : paths.length > 0
          ? 'Commit ' + paths.length
          : 'Commit';
        commitButton.title = ready
          ? 'Commit ' + paths.length +
            (paths.length === 1 ? ' ticked file' : ' ticked files') +
            ' with this message'
          : 'Write a message, and tick a file, to commit';
        // An amend is a commit that replaces the last one, so it is ready on
        // exactly the same terms -- except when the last commit is already
        // somewhere else, where replacing it is not an edit anybody else can
        // see. The backend refuses that too; this is the button admitting it
        // before the reader writes a message they cannot use.
        amendButton.disabled = !ready || (gitRemote !== null && gitRemote.published);
        amendButton.textContent = amending ? 'Amending' : 'Amend';
        amendButton.title = amendButton.disabled && gitRemote !== null &&
            gitRemote.published
          ? 'The last commit is already on ' + gitRemote.upstream +
            ', so it cannot be replaced. Commit the file instead.'
          : 'Replace the last commit with these files and this message';
        pushButton.disabled = pushing ||
          committing ||
          gitRemote === null ||
          gitRemote.upstream === null ||
          !(gitRemote.ahead > 0);
        pushButton.textContent = pushing
          ? 'Pushing'
          : gitRemote !== null && gitRemote.ahead > 0
          ? 'Push ' + gitRemote.ahead
          : 'Push';
        pushButton.title = pushButton.disabled && gitRemote !== null &&
            gitRemote.behind > 0
          ? 'Pull first: the remote has ' + gitRemote.behind +
            (gitRemote.behind === 1 ? ' commit' : ' commits') + ' this does not.'
          : 'Push ' + (gitRemote === null ? '' : gitRemote.branch) +
            ' to ' + (gitRemote === null ? 'its remote' : gitRemote.upstream);

        // A vault with no repository has no commit, no amend and no branch,
        // so the box says that once and drops the controls that could never
        // act. They are hidden rather than disabled because a greyed-out
        // Amend beside a greyed-out Commit is two controls offering nothing.
        commitBox.classList.toggle(
          'is-unavailable',
          vault.root === null || gitPending === null,
        );
        // A detached HEAD is not a branch: there is nowhere for Push to go and
        // no branch name to show, so the row goes rather than saying so in the
        // space of two.
        commitBox.classList.toggle(
          'has-no-branch',
          gitRemote !== null && gitRemote.branch === null,
        );

        if (vault.root === null) {
          commitState.textContent = 'Open a vault to commit to a repository.';
          commitState.classList.remove('is-error');
        } else if (gitPending === null) {
          commitState.textContent = 'Not a git repository, so there is nothing to commit.';
          commitState.classList.remove('is-error');
        } else if (gitPending.size === 0) {
          commitState.textContent = 'Nothing pending. Every file is committed.';
          commitState.classList.remove('is-error');
        } else {
          // Two numbers, because they answer two questions: what git has, and
          // what this commit would take. "3 changed" with two of them unticked
          // would be true and useless.
          const shown = gitPending.size;
          const counted = gitPendingTotal > shown
            ? 'first ' + shown + ' of ' + gitPendingTotal + ' changed'
            : (shown === 1 ? '1 changed' : shown + ' changed');
          const chosen = paths.length === 0
            ? 'none ticked'
            : paths.length === shown && shown === gitPendingTotal
            ? 'all ticked'
            : paths.length + ' of ' + gitPendingTotal + ' ticked';
          commitState.textContent = counted + ' · ' + chosen;
          commitState.classList.remove('is-error');
        }
        remoteState.textContent = remoteLabel();
        remoteState.title = remoteState.textContent;
        remoteStatus.textContent = remoteStatusLine();
        remoteStatus.classList.toggle('is-error', remoteIsError());
        if (gitNote !== '') commitNote.textContent = gitNote;
        else commitNote.textContent = '';
        commitNote.classList.toggle('is-error', gitNoteIsError);
      }

      /**
       * The branch and where it goes, in the fewest words that still name both.
       *
       * Reference rather than status, and truncated rather than wrapped: the
       * full sentence this used to be ran to eight lines in a 98px column and
       * cost the History section its place. The status line underneath carries
       * what changes what the reader does, and the tooltip carries what the
       * truncation cut.
       */
      function remoteLabel() {
        if (vault.root === null || gitRemote === null) return '';
        if (gitRemote.branch === null) return 'detached HEAD';
        if (gitRemote.upstream === null) return gitRemote.branch;
        return gitRemote.branch + ' → ' + gitRemote.upstream;
      }

      /**
       * What about the branch the reader can act on, and nothing else.
       *
       * Fragments rather than sentences, because this is a line of 10.5px type
       * beside two buttons and every word here costs a wrap. "Behind" in
       * particular is not this app's problem to fix -- it cannot pull -- so it
       * says what the next step is, because a line that says "1 behind" and
       * leaves the reader guessing whether Push will work is the sort of thing
       * that gets discovered by being refused.
       *
       * The order is the order of what stops the reader: behind stops a push,
       * a missing upstream stops there being a push at all, and a published
       * last commit stops an amend. What is merely true -- commits waiting to
       * go -- is on the Push button already, so it is not repeated here, and
       * the amend fragment says only the fact: the button above it is visibly
       * off, and the reason in the tooltip is one line long.
       */
      function remoteStatusLine() {
        if (vault.root === null || gitRemote === null) return '';
        if (gitRemote.branch === null) return 'no branch to push from';
        const parts = [];
        if (gitRemote.behind > 0) {
          parts.push(
            gitRemote.behind === 1
              ? '1 behind · pull first'
              : gitRemote.behind + ' behind · pull first',
          );
        }
        if (gitRemote.upstream === null) {
          parts.push('never pushed · nowhere to push to');
        }
        if (gitRemote.published) {
          parts.push('last commit already pushed');
        }
        return parts.join(' · ');
      }

      /**
       * Whether the branch line is saying something went wrong.
       *
       * A detached HEAD and a missing upstream are both ordinary states, so
       * neither is dressed up as a failure; only the case where git would not
       * answer at all is, because that one is a real fault in the setup rather
       * than a fact about the repository.
       */
      function remoteIsError() {
        return gitRemote === null && gitPending !== null;
      }

      function setGitNote(text, isError) {
        gitNote = text;
        gitNoteIsError = isError;
      }

      /**
       * Commit the ticked files with what the message line says.
       *
       * The paths go over rather than a "commit everything" flag, because that
       * is the whole promise the checkbox makes: a commit from here can only
       * contain what the reader ticked. The button is disabled until there is
       * both a message and a tick, and the message is checked again in the
       * backend, because a disabled button is a hint and not a boundary.
       */
      async function commitTicked() {
        if (committing) return;
        const paths = [...ticked];
        const message = commitMessage.value.trim();
        if (paths.length === 0 || message === '') return;
        committing = true;
        setGitNote('Committing ' + paths.length + ' files.', false);
        updateCommitBox();
        const result = await call('commitFiles', [message, paths]);
        committing = false;
        if (result === null) {
          setGitNote(
            lastCallError === ''
              ? 'The commit did not go through.'
              : lastCallError,
            true,
          );
          updateCommitBox();
          return;
        }
        // The message line is emptied on success and kept on failure. A commit
        // that worked should not leave its own words under the cursor waiting
        // to be committed again, and one that failed should leave them exactly
        // where they were, because they are still the thing to fix.
        commitMessage.value = '';
        // "1 file" rather than "1 files": the button already counts properly,
        // and a note that miscounts the commit it just made is the sort of
        // thing a reader trusts about the next one.
        const howMany = result.committed.length === 1
          ? '1 file'
          : result.committed.length + ' files';
        setGitNote(
          result.hash === ''
            ? 'Committed ' + howMany + '.'
            : 'Committed ' + howMany + ' as ' + result.hash + '.',
          false,
        );
        ticked = new Set();
        renderRecent();
      }

      /**
       * Fold the ticked files into the last commit, with this message.
       *
       * The usual reason to amend is a subject line somebody would rather not
       * live with, and the reader is standing in the pane with the files
       * already ticked. Leaving to amend means leaving the app, and reaching
       * for a terminal over a working tree this app has open, which is the
       * arrangement where a message and a commit end up disagreeing.
       *
       * Refused when the last commit is already on the remote -- a disabled
       * button above and a sentence from git's own history check behind it,
       * because a button's disabled state is a hint and not a boundary. It
       * replaces the previous message, which is the other thing worth knowing:
       * the note says so after the fact rather than a confirmation first,
       * since a second dialog in a pane this small is a worse place to put it.
       */
      async function amendTicked() {
        if (committing || pushing) return;
        const paths = [...ticked];
        const message = commitMessage.value.trim();
        if (paths.length === 0 || message === '') return;
        committing = true;
        amending = true;
        setGitNote('Replacing the last commit with ' + paths.length + ' files.', false);
        updateCommitBox();
        const result = await call('amendFiles', [message, paths]);
        committing = false;
        amending = false;
        if (result === null) {
          setGitNote(
            lastCallError === ''
              ? 'The amend did not go through.'
              : lastCallError,
            true,
          );
          updateCommitBox();
          return;
        }
        // Cleared for the same reason the commit box is: the words are in the
        // commit now, and leaving them under the cursor invites a second
        // commit with the same subject.
        commitMessage.value = '';
        setGitNote(
          'Replaced the last commit' +
            (result.hash === '' ? '.' : ' with ' + result.hash + '.'),
          false,
        );
        ticked = new Set();
        renderRecent();
      }

      /**
       * Push this branch to the remote its configuration already names.
       *
       * No arguments go over, deliberately: the destination is read out of git
       * on the other side rather than chosen here, so there is nothing for a
       * mis-click to aim and nothing for anything else to aim either. There is
       * no force either, which means a branch that is behind will be refused
       * with git's reason rather than resolved -- the reader can pull, or say
       * so, but this app does not throw somebody else's commit away.
       *
       * A second status is asked for afterwards rather than the counts being
       * guessed at: what "up to date" means is git's answer, not ours.
       */
      async function pushTicked() {
        if (committing || pushing) return;
        if (gitRemote === null || gitRemote.upstream === null) return;
        if (!(gitRemote.ahead > 0)) return;
        const ahead = gitRemote.ahead;
        pushing = true;
        setGitNote(
          'Pushing ' + ahead + (ahead === 1 ? ' commit' : ' commits') +
            ' to ' + gitRemote.upstream + '.',
          false,
        );
        updateCommitBox();
        const result = await call('pushBranch', []);
        pushing = false;
        if (result === null) {
          setGitNote(
            lastCallError === '' ? 'The push did not go through.' : lastCallError,
            true,
          );
          updateCommitBox();
          return;
        }
        setGitNote('Pushed ' + result.branch + ' to ' + result.remote + '.', false);
        // The counts in the branch line are the only thing that has changed and
        // only git knows the new ones, so the status is asked for again rather
        // than decremented here.
        refreshGitStatus();
      }

      /**
       * The changes section: the listing itself, newest write first.
       *
       * Split out of {@link renderRecent} only so the two sections can be
       * redrawn without each other -- saving a file moves one list and leaves
       * the other's days alone until the next arrival.
       *
       * The tick on each row is git's answer, not the listing's: a file the
       * reader wrote thirty seconds ago may be identical to the one in the
       * last commit, and offering to commit it would be offering to write an
       * empty commit. So the list keeps saying what it says -- when the file
       * was written -- and only the files git has something pending for get a
       * box at all.
       */
      function renderChanges(recent) {
        recentList.textContent = '';
        if (recent.length === 0) {
          const empty = document.createElement('li');
          empty.className = 'file-empty';
          empty.textContent = vault.root === null
            ? 'Open a vault to see what changed in it.'
            : 'This folder has no files yet.';
          recentList.appendChild(empty);
          return;
        }

        const openPaths = new Set(tabs.map((tab) => tab.path));
        const active = activeTab();
        for (const file of recent) {
          const item = document.createElement('li');
          // The tick is drawn only where git has something pending, rather than
          // on every row. A box beside a file with no pending change is a box
          // that cannot do anything, and a list of 135 of them buries the two
          // that can. Its absence is the answer: that file has nothing to
          // commit.
          if (gitPending !== null && gitPending.has(file.path)) {
            item.appendChild(changeTick(file.path));
          }
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'file-button';
          if (active !== null && active.path === file.path) {
            button.classList.add('is-active');
            button.setAttribute('aria-current', 'true');
          } else if (openPaths.has(file.path)) {
            button.classList.add('is-open');
          }
          if (file.scope === 'asset') button.classList.add('is-asset');
          button.title = file.path;
          const name = document.createElement('span');
          name.className = 'file-name';
          name.textContent = listedName(file);
          const when = document.createElement('span');
          when.className = 'file-time';
          when.textContent = relativeTime(file.modified);
          // The exact date in the title, because "3 days ago" is the answer to
          // "how long ago" and not to "when".
          when.title = new Date(file.modified).toLocaleString();
          button.appendChild(name);
          button.appendChild(when);
          button.addEventListener('click', () => openFile(file.path));
          item.appendChild(button);
          recentList.appendChild(item);
        }
      }

      /**
       * The checkbox on one row of the changes list.
       *
       * A label wrapping a real input rather than a drawn box, so the row's
       * name is the accessible name, the platform's own focus ring and
       * high-contrast rendering come with it, and a click on the box does not
       * have to be reimplemented. The label is what makes the whole 22px
       * column a target, which is the difference between ticking a list and
       * aiming at it.
       */
      function changeTick(path) {
        const label = document.createElement('label');
        label.className = 'change-check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = ticked.has(path);
        const change = gitPending.get(path);
        // git's own two-letter code in the tooltip, so the tick says why it is
        // there. The list is the vault's files and git's codes are a different
        // vocabulary; this is where the two meet.
        label.title = change.status.replace(/ /g, '') + ': ' + gitMeaning(change);
        label.setAttribute(
          'aria-label',
          'Commit ' + path + ' (' + gitMeaning(change) + ')',
        );
        input.addEventListener('change', () => {
          if (input.checked) ticked.add(path);
          else ticked.delete(path);
          updateCommitBox();
        });
        label.appendChild(input);
        return label;
      }

      /** What one of git's status codes means, in the app's own words. */
      function gitMeaning(change) {
        const code = change.status.trim();
        if (code === '??') return 'new file, not added yet';
        if (code === 'A') return 'added to the index';
        if (code === 'M') return 'edited';
        if (code === 'D') return 'deleted';
        if (code === 'R') return 'renamed';
        if (code === 'C') return 'copied';
        return change.staged ? 'staged' : 'edited on disk';
      }

      /**
       * The other half of the split: the same writes as days, newest day
       * first, on a rail.
       *
       * It is drawn from the vaultActivity operation, so the empty state has
       * to be handled here as well as the full one: a closed vault, or a folder
       * the walk could not date a single file in, is a history with nothing in
       * it, and the section says which of the two it is rather than showing an
       * empty rail.
       */
      async function renderHistory() {
        const token = (historyToken += 1);
        recentHistory.textContent = '';
        const days = vault.root === null
          ? []
          : await call('vaultActivity', []);
        // The scan is a round trip, so two arrivals can be in flight at once --
        // switching to this view and the listing landing together. Without this
        // the slower one lands on top of the newer one and the rail grows a
        // second copy of every day, under a badge still counting one set.
        if (token !== historyToken) return;
        historyCount.textContent = String(days.length);
        if (days.length === 0) {
          const empty = document.createElement('li');
          empty.className = 'file-empty';
          empty.textContent = vault.root === null
            ? 'Open a vault to see its history.'
            : 'Nothing in this vault has a date yet.';
          recentHistory.appendChild(empty);
          return;
        }
        for (const day of days) {
          const item = document.createElement('li');
          item.className = 'activity-day';
          const when = document.createElement('span');
          when.className = 'activity-when';
          when.textContent = dayLabel(day.day);
          when.title = new Date(day.day).toLocaleDateString();
          const files = document.createElement('ul');
          files.className = 'activity-files';
          for (const file of day.files) {
            files.appendChild(historyRow(file));
          }
          item.appendChild(when);
          item.appendChild(files);
          recentHistory.appendChild(item);
        }
      }

      /**
       * One file in the history. The same open action as the changes list, and
       * the same active and open marks, so a file reads the same in both
       * sections -- otherwise the history would be a second, quieter truth
       * about which document is on screen.
       */
      function historyRow(file) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'file-button';
        const active = activeTab();
        if (active !== null && active.path === file.path) {
          button.classList.add('is-active');
          button.setAttribute('aria-current', 'true');
        } else if (tabs.some((tab) => tab.path === file.path)) {
          button.classList.add('is-open');
        }
        if (file.scope === 'asset') button.classList.add('is-asset');
        button.title = file.path;
        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = listedName(file);
        button.appendChild(name);
        button.addEventListener('click', () => openFile(file.path));
        item.appendChild(button);
        return item;
      }

      /**
       * A day's name, in the words a reader would use for it.
       *
       * Today and yesterday are named rather than dated, because a history's
       * first two entries are the ones being read and "Today" is the answer to
       * "is any of this mine?". Past that it is the weekday and the date, and
       * past a week the weekday stops earning its space.
       */
      function dayLabel(day) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          .getTime();
        const days = Math.round((today - day) / 86400000);
        if (days <= 0) return 'Today';
        if (days === 1) return 'Yesterday';
        const date = new Date(day);
        if (days < 7) {
          return date.toLocaleDateString(undefined, { weekday: 'long' });
        }
        return date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });
      }

      /**
       * Move the divider between the two sections, and fold or open either of
       * them.
       *
       * The divider keeps the sidebar resizer's contract rather than inventing
       * one: a pointer drag that holds capture for its length, arrows to nudge
       * it, Shift for a bigger nudge, Home and End for the ends, and a
       * double-click to even the two out. It is a separator, so that is what it
       * says it is.
       *
       * The split is a ratio rather than a height, because the pane's height
       * belongs to the window: a height remembered from a tall window would be
       * most of a short one. And it is not remembered at all -- a split the
       * reader set once for one session is not a preference, and the one
       * setting it would add is a setting with nothing to be right about.
       */
      function wireSplit() {
        /** The two sections, as a share of the pane, clamped to what fits. */
        function setSplit(ratio, persist) {
          const pane = recentSplit.getBoundingClientRect().height;
          // A pane too short to divide leaves the ratio alone rather than
          // setting a negative height, which is how a split ends up with one
          // section pushed off the top of the window.
          if (pane < MIN_SPLIT_PANE_HEIGHT * 2) return;
          vault.splitRatio = applySplit(ratio);
          // Stored once the gesture is over, not once per pointermove: a drag
          // across a tall pane is hundreds of moves, and the setting is a
          // decision the reader makes by letting go.
          if (persist) call('setSplitRatio', [vault.splitRatio]);
        }

        /** Where the divider sits now, as the same share setSplit takes. */
        function splitRatio() {
          const top = changesPane.getBoundingClientRect().height;
          const bottom = historyPane.getBoundingClientRect().height;
          const total = top + bottom;
          return total === 0 ? ${DEFAULT_SPLIT_RATIO} : top / total;
        }

        for (const section of splitSections) {
          section.toggle.addEventListener('click', () =>
            toggleSection(section)
          );
        }

        let dragging = false;
        function endDrag(event) {
          if (!dragging) return;
          dragging = false;
          recentDivider.classList.remove('is-dragging');
          if (recentDivider.hasPointerCapture(event.pointerId)) {
            recentDivider.releasePointerCapture(event.pointerId);
          }
          setSplit(splitRatio(), true);
        }

        recentDivider.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          dragging = true;
          recentDivider.focus();
          // The drag would otherwise select the text it passes over.
          event.preventDefault();
          recentDivider.classList.add('is-dragging');
          try {
            recentDivider.setPointerCapture(event.pointerId);
          } catch {
            // A synthetic pointer has no active id to capture. The drag still
            // works while the pointer is over the handle, which is what keeps
            // this driveable from a test or a script.
          }
        });

        recentDivider.addEventListener('pointermove', (event) => {
          if (!dragging) return;
          const top = recentSplit.getBoundingClientRect().top;
          const height = recentSplit.getBoundingClientRect().height;
          setSplit((event.clientY - top) / height);
        });

        recentDivider.addEventListener('pointerup', endDrag);
        recentDivider.addEventListener('pointercancel', endDrag);

        recentDivider.addEventListener('dblclick', () => {
          setSplit(${DEFAULT_SPLIT_RATIO}, true);
        });

        recentDivider.addEventListener('keydown', (event) => {
          const step = event.shiftKey ? 0.1 : 0.02;
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            setSplit(
              splitRatio() + (event.key === 'ArrowDown' ? step : -step),
              true,
            );
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            setSplit(
              event.key === 'Home' ? ${MIN_SPLIT_RATIO} : ${MAX_SPLIT_RATIO},
              true,
            );
          }
        });
      }

      /**
       * Fold a section to its header, or open it again.
       *
       * The badge stays put when the section is folded, which is the whole
       * point of having one: a collapsed history still says how many days are
       * in it, so folding it is a way of reading the list and not a way of
       * losing it.
       */
      function toggleSection(section) {
        const folded = section.toggle.getAttribute('aria-expanded') === 'true';
        section.toggle.setAttribute('aria-expanded', String(!folded));
        section.pane.classList.toggle('is-collapsed', folded);
        recentDivider.hidden = splitSections.every((entry) =>
          entry.pane.classList.contains('is-collapsed')
        );
      }

      function latestSentence(modified) {
        if (!modified) return 'No dates in this vault';
        return 'Latest: ' + relativeTime(modified);
      }

      function relativeTime(stamp) {
        // A file system that will not say when is not a reason to print NaN.
        if (!stamp) return 'Unknown date';
        const seconds = Math.round((Date.now() - stamp) / 1000);
        if (seconds < 60) return 'Just now';
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return counted(minutes, 'minute') + ' ago';
        const hours = Math.round(minutes / 60);
        if (hours < 24) return counted(hours, 'hour') + ' ago';
        const days = Math.round(hours / 24);
        if (days < 31) return counted(days, 'day') + ' ago';
        // Past a month "29 days ago" stops being useful, so the date itself
        // takes over and this is no longer a guess.
        return new Date(stamp).toLocaleDateString();
      }

      function counted(amount, noun) {
        return amount + ' ' + noun + (amount === 1 ? '' : 's');
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
          // The matches were about the vault that just closed. Left on screen
          // they would be rows that open a folder this app no longer has open.
          runSearch();
          return;
        }
        const result = await call('listFiles');
        if (result === null) return;
        files = result;
        renderFiles();
        // The same for every other listing: a new file, a reloaded vault, a
        // vault that was edited on disk. A search result names a line in a
        // particular version of a file, so keeping the old answers across any
        // of those is a result pointing at text that has moved.
        runSearch();
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
        setSidebarView(state.sidebarView, false);
        // Every switch, from one loop and one rule. The stored state is already
        // a boolean for all three; anything else means a caller sent a partial
        // state, and the switch's own default is the honest answer for that.
        for (const view of listViews) {
          const stored = state[view.key];
          view.input.checked = typeof stored === 'boolean' ? stored : view.default;
        }
        applySidebarWidth();
        // The split comes back with the state, so the divider is where the
        // reader left it before the first paint of this session rather than
        // snapping to the default under their hands.
        vault.splitRatio = applySplit(vault.splitRatio);
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
        // One menu item per view, from the same table the bar draws, so the two
        // surfaces cannot offer different views -- and a check mark rather than
        // a second, separate "which view" switch to keep in step with it.
        ...PANES.map((view) => ({
          id: 'view-' + view.key,
          group: 'View',
          label: view.label,
          keys: '',
          canRun: () => true,
          isActive: () => vault.sidebarView === view.key,
          run: () => setSidebarView(view.key, true),
        })),
        // Three choices rather than three commands, so each one reports whether
        // it is the active one and the menu can show that.
        { id: 'theme-system', group: 'Appearance', label: 'Match the system', keys: '', canRun: () => true, isActive: () => vault.theme === 'system', run: () => setTheme('system', true) },
        { id: 'theme-light', group: 'Appearance', label: 'Light', keys: '', canRun: () => true, isActive: () => vault.theme === 'light', run: () => setTheme('light', true) },
        { id: 'theme-dark', group: 'Appearance', label: 'Dark', keys: '', canRun: () => true, isActive: () => vault.theme === 'dark', run: () => setTheme('dark', true) },
        // One menu item per switch, generated from the same table the toolbar's
        // checkboxes come from, so a switch cannot be in one surface and not
        // the other and a fourth needs no line here. A checkbox rather than a
        // command, because the setting is a state to be shown, not an action to
        // have taken: aria-checked is what says which way it is on.
        ...listViews.map((view) => ({
          id: view.command,
          group: 'Appearance',
          label: view.menu,
          keys: '',
          role: 'menuitemcheckbox',
          canRun: () => true,
          isActive: () => vault[view.key],
          run: () => setListView(view.key, !vault[view.key]),
        })),
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
        wireActivityBar();
        wireSplit();
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
        commitMessage.addEventListener('input', updateCommitBox);
        // Enter commits from the message line, for the same reason Enter saves
        // in the editor: the reader has finished writing it, and the button is
        // the only other thing to reach for. The button's own disabled state is
        // the check, so a line with nothing ticked and Enter does nothing
        // rather than committing something unintended. It commits rather than
        // amends, and that is the safe way round: a commit somebody did not
        // mean is a second commit, an amend somebody did not mean is a commit
        // that no longer exists.
        commitMessage.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commitTicked();
        });
        commitButton.addEventListener('click', commitTicked);
        amendButton.addEventListener('click', amendTicked);
        pushButton.addEventListener('click', pushTicked);
        saveButton.addEventListener('click', saveFile);
        reloadButton.addEventListener('click', reloadFile);
        filterInput.addEventListener('input', renderFiles);
        searchQuery.addEventListener('input', scheduleSearch);
        // Enter searches now rather than waiting out the debounce, which is the
        // one case where the delay is the user's own.
        searchQuery.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          clearTimeout(searchTimer);
          runSearch();
        });
        // The setting lives in the sidebar, next to the list it draws, as well
        // as the Appearance menu. Both controls drive the same state, so this
        // syncs the checkbox and refreshes the menu's own check mark.
        for (const view of listViews) {
          view.input.addEventListener('change', () => setListView(view.key, view.input.checked, true));
        }
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
      // The panes ship hidden and the bar's buttons ship unchecked, so the
      // stored view has to be applied before anything is on screen rather than
      // when the state arrives. If that call then fails, this is the answer
      // that leaves a usable window rather than an empty one.
      setSidebarView(vault.sidebarView, false);
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
