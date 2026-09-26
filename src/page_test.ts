/**
 * Guards for the webview document.
 *
 * src/page.ts is one big string, so neither the type checker nor the browser
 * will tell us when the script reaches for an element the markup does not have
 * — it just silently returns null and the widget stops working. These tests
 * walk the string instead.
 */
import { join } from "node:path";

import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "./config.ts";
import { page, pageForTheme } from "./page.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("every element the script looks up exists in the markup", () => {
  const looked = new Set(
    [...page.matchAll(/\bel\('([\w-]+)'\)/g)].map((match) => match[1]),
  );
  const declared = new Set(
    [...page.matchAll(/\sid="([\w-]+)"/g)].map((match) => match[1]),
  );

  assert(looked.size > 20, "the script looks up the app's elements");
  const missing = [...looked].filter((id) => !declared.has(id));
  assert(
    missing.length === 0,
    `the script looks up ids the markup does not define: ${missing.join(", ")}`,
  );
});

Deno.test("the tab strip's classes are all styled", () => {
  // A class a renderer applies but the stylesheet never matches renders as an
  // unstyled element, which is exactly how the tab strip would break.
  const classes = [
    "tab",
    "tab-state",
    "tab-name",
    "tab-close",
    "is-active",
    "is-dirty",
    "file-button",
    "is-open",
    "is-asset",
    "assets-toggle",
    "menu-popup",
    "menu-button",
    "menu-group",
    "menu-group-label",
    "menu-item",
    "menu-item-label",
    "menu-keys",
  ];
  const unstyled = classes.filter((name) =>
    !page.includes(`.${name}`) ||
    // The class must appear in a rule, not only in the script that applies it.
    !new RegExp(`\\.${name}[^{\\w-]`).test(
      page.slice(0, page.indexOf("</style>")),
    )
  );
  assert(
    unstyled.length === 0,
    `these classes have no style rule: ${unstyled.join(", ")}`,
  );
});

Deno.test("every token used resolves, and dark only overrides light", async () => {
  // Light is the mode we cannot see while the OS is dark, so check it by
  // structure instead: a var() with no definition resolves to nothing and a
  // token that exists only in the dark block leaves light mode unstyled.
  const style = page.slice(0, page.indexOf("</style>"));
  const darkAt = style.indexOf(':root[data-theme="dark"]');
  assert(darkAt > 0, "there is a dark block");
  const light = readTokens(style.slice(0, darkAt));
  const dark = readTokens(style.slice(darkAt));

  const used = new Set(
    [...style.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]),
  );
  // The editor's appearance is a CodeMirror theme extension, not page CSS (see
  // src/editor.ts for why), so its token references are not in this string and
  // a rename on either side would silently unstyle the editor.
  const editorSource = await Deno.readTextFile(
    join(import.meta.dirname!, "editor.ts"),
  );
  const editorUsed = [
    ...editorSource.matchAll(/var\(\s*(--[\w-]+)/g),
  ].map((match) => match[1]);
  assert(
    editorUsed.length > 10,
    "the editor's theme reads the app's tokens",
  );
  const dangling = editorUsed.filter((name) => !light.has(name));
  assert(
    dangling.length === 0,
    `the editor reads tokens nothing defines for light mode: ${
      dangling.join(", ")
    }`,
  );

  // And the other direction: a token nothing consumes is dead weight that the
  // next reader cannot tell from a live one.
  const unused = [...light].filter((name) =>
    !used.has(name) && !editorUsed.includes(name)
  );
  assert(
    unused.length === 0,
    `these tokens are defined but never used: ${unused.join(", ")}`,
  );

  const undefined_ = [...used].filter((name) => !light.has(name));
  assert(
    undefined_.length === 0,
    `these tokens are used but never defined for light mode: ${
      undefined_.join(", ")
    }`,
  );

  const darkOnly = [...dark].filter((name) => !light.has(name));
  assert(
    darkOnly.length === 0,
    `these tokens exist only in dark mode: ${darkOnly.join(", ")}`,
  );
});

/** The custom properties defined in a slice of CSS. */
function readTokens(css: string): Set<string> {
  return new Set(
    [...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]),
  );
}

Deno.test("collapsing never strands the only way to reopen", () => {
  // The toggle in the brand row disappears with the sidebar, so the tabbar
  // must reveal its own when collapsed — and in the drawer layout too, where
  // the brand row is parked off-screen.
  const style = page.slice(0, page.indexOf("</style>"));
  const narrow = style.slice(style.indexOf("@media (max-width: 640px)"));

  assert(
    /\.app\.is-collapsed\s+\.tabbar\s+\.sidebar-toggle\s*\{[^}]*display:\s*inline-flex/
      .test(
        style,
      ),
    "the tabbar shows a toggle once the sidebar is collapsed",
  );
  assert(
    /\.tabbar\s+\.sidebar-toggle\s*\{[^}]*display:\s*inline-flex/.test(narrow),
    "the drawer layout shows a toggle too",
  );
  assert(
    (page.match(
      /class="button button-secondary icon-button sidebar-toggle"/g,
    ) ?? [])
      .length === 2,
    "there is one toggle per layout state",
  );
});

Deno.test("no two icon-only buttons draw the same glyph", () => {
  // These buttons are 28px squares in one band of chrome, so a shared glyph
  // reads as one control drawn twice — which is what the sidebar toggle and the
  // app menu were, both ☰. The toggle draws a panel, the bar's reload is an
  // arrow, the file list's create button is a +, and the menu keeps ☰.
  const iconButtons = [
    ...page.matchAll(/<button ([^>]*)>([\s\S]*?)<\/button>/g),
  ]
    .map(([, attrs, inner]) => ({ attrs, inner: inner.trim() }))
    .filter(({ attrs }) => /\bicon-button\b/.test(attrs));

  assert(iconButtons.length === 5, "the app has five icon-only buttons");
  const by = (pattern: RegExp) =>
    iconButtons.filter(({ attrs }) => pattern.test(attrs));
  const toggles = by(/\bsidebar-toggle\b/);
  const menus = by(/id="menuButton"/);
  const creates = by(/id="newFileButton"/);
  const reloads = by(/id="reloadButton"/);
  assert(
    toggles.length === 2 && menus.length === 1 && creates.length === 1 &&
      reloads.length === 1,
    "one app menu, one create button, one reload, and one toggle per state",
  );
  // The two toggles are never on screen together, so only a shared source keeps
  // them identical when one is edited.
  assert(
    toggles[0].inner === toggles[1].inner,
    "the two toggles draw different icons",
  );
  assert(toggles[0].inner.startsWith("<svg"), "the toggle draws a panel");
  const glyphs = [
    toggles[0].inner,
    menus[0].inner,
    creates[0].inner,
    reloads[0].inner,
  ];
  assert(
    new Set(glyphs).size === glyphs.length,
    "these icon-only buttons draw the same thing, so they read as one control",
  );

  // The glyph was the button's only text, and an aria-hidden SVG contributes
  // nothing to a name, so aria-label is now the whole of it.
  const unnamed = iconButtons.filter(({ attrs }) =>
    !/aria-label="[^"]+"/.test(attrs)
  );
  assert(
    unnamed.length === 0,
    `these icon-only buttons have no accessible name: ${
      unnamed.map(({ attrs }) => attrs).join(", ")
    }`,
  );
});

Deno.test("no icon-drawing control is drawn as a character", () => {
  // A curated set, so a glyph cannot creep back in as a character. Seven were
  // characters: the menu and the create button were icon-buttons in the markup,
  // the tab close, folder disclosure and active check are assigned in the
  // script, and the two placeholders are divs. The folder was a colour emoji,
  // which ignores `color` and so could not follow the palette at all.
  //
  // Typography is deliberately untouched: an ellipsis in a label, a middot
  // between hints and an em dash in prose are part of a sentence, not a control.
  const iconButtons = [
    ...page.matchAll(/<button ([^>]*)>([\s\S]*?)<\/button>/g),
  ]
    .map(([, attrs, inner]) => ({ attrs, inner: inner.trim() }))
    .filter(({ attrs }) => /\bicon-button\b/.test(attrs));
  assert(iconButtons.length > 0, "the app has icon-only buttons to check");
  for (const { attrs, inner } of iconButtons) {
    const characters = [...inner].filter((c) => (c.codePointAt(0) ?? 0) > 127);
    assert(
      characters.length === 0,
      `an icon-only button draws the character${
        characters.length > 1 ? "s" : ""
      } ${JSON.stringify(characters)}: ${attrs}`,
    );
  }

  // The three the markup sweep cannot see, because the script builds them. By
  // the time the page ships the template is already interpolated, so what is
  // assigned is the icon's markup rather than the name it was written under.
  for (
    const [what, assignment] of [
      ["a tab's close button", /close\.innerHTML = '<svg/],
      ["a folder's disclosure", /glyph\.innerHTML = '<svg/],
      [
        "the active command's tick",
        /check\.innerHTML = command\.isActive\(\) \? '<svg/,
      ],
    ] as const
  ) {
    assert(
      assignment.test(page),
      `${what} draws an icon rather than a character`,
    );
  }
  // Rather than list the glyphs that were there — an inventory goes stale the
  // moment one is added, and an emoji is a surrogate pair that a character
  // class splits into two stray halves — the invariant is that no control
  // assigns a non-ASCII character as its text at all.
  const assigned = [...page.matchAll(/textContent\s*=\s*'([^']*)'/g)]
    .map(([, value]) => value)
    .filter((value) => [...value].some((c) => (c.codePointAt(0) ?? 0) > 127));
  assert(
    assigned.length === 0,
    `a control assigns an icon as text: ${JSON.stringify(assigned)}`,
  );
  const placeholders = [
    ...page.matchAll(/class="placeholder-icon" aria-hidden="true"><svg/g),
  ];
  assert(
    placeholders.length === 2,
    `both placeholders draw an icon rather than a character: found ${placeholders.length}`,
  );
});

Deno.test("the vault's path row is spent only when there is no vault", () => {
  // With a vault open that row is the root, and it is the one piece of the
  // sidebar header that is pure decoration: the name already identifies the
  // folder, and no usable sidebar is wide enough to show the path anyway —
  // measured at 338px of text in a 308px box, so what the user read was an
  // ellipsis. With no vault open the same row is the sentence saying what
  // Open vault is for, which is the one time it earns its height.
  assert(
    /vaultPath\.hidden = open;/.test(page),
    "the path row is hidden while a vault is open and shown while none is",
  );
  assert(
    /vaultPath\.textContent = open \? vault\.root : 'Choose the folder that holds your wiki\.'/
      .test(page),
    "and it keeps the guidance an unopened vault needs",
  );
  // Hiding the row must not close the gap it left: the buttons still need to
  // sit clear of the name, and an unopened vault still needs its own spacing.
  assert(
    /\.vault-actions \{[^}]*margin-top: 8px/.test(page),
    "the buttons carry the spacing the path row used to provide",
  );
});

Deno.test("the extension setting is reachable from the list it changes", () => {
  // It was filed as a menu command first, and that put it one level too far
  // from the thing it controls: a user looking at the file list had no reason
  // to think Appearance governed it. Both controls drive one state, and each
  // has to redraw the other, or the two disagree about the same setting.
  assert(
    /<input type="checkbox" id="showExtensions"/.test(page),
    "the sidebar offers the setting beside the list it redraws",
  );
  assert(
    /extensionsInput\.addEventListener\('change', \(\) => setShowExtensions\(extensionsInput\.checked, true\)\)/
      .test(page),
    "and that checkbox drives the same setter the menu command uses",
  );
  assert(
    /extensionsInput\.checked = show;/.test(page),
    "so the menu command and the checkbox cannot drift apart",
  );
  assert(
    /extensionsInput\.checked = state\.showExtensions !== false;/.test(page),
    "and the stored setting wins over the markup's default on load",
  );
  // Two labelled checkboxes, a filter and a button exceed a 200px sidebar, so
  // the row wraps. Grouping keeps the pair together: left free they split
  // across three lines, one checkbox each.
  assert(
    /\.file-tools-checks \{[^}]*display: flex/.test(page),
    "the checkboxes wrap as a pair rather than one per line",
  );
  assert(
    /\.file-tools \{ flex-wrap: wrap/.test(page),
    "and the toolbar is allowed to wrap at all",
  );
});

Deno.test("hiding an extension never changes the file it opens", () => {
  // The list draws a shortened name, but the row is a button that opens by
  // path: if the shortening leaked into the path, a page called README.md and
  // one called README would become the same row.
  assert(
    /name\.textContent = listedName\(file\)/.test(page),
    "the list draws the name the setting produces",
  );
  assert(
    /function listedName\(file\) \{[\s\S]*?vault\.showExtensions/.test(page),
    "and that name depends on the setting rather than always carrying it",
  );
  // Only Markdown loses its extension. A wiki is nearly all .md, so that is the
  // repetition worth hiding; a vault's own .py and .yml files are few, and
  // shortening those would make two different files look alike.
  //
  // This also pins why the shortening is written without a regex: the script
  // ships inside a template literal, where a backslash is an escape, so a
  // /\.md$ reached the browser as /.md$ and stripped the last letter of any
  // name ending in "md".
  assert(
    /!file\.isMarkdown\) return file\.name/.test(page),
    "a file that is not Markdown keeps its name whole",
  );
  assert(
    /toLowerCase\(\)\.endsWith\('\.md'\)[\s\S]*?slice\(0, -3\)/.test(page),
    "and a Markdown one drops exactly its three-character extension",
  );
  assert(
    !/file\.name\.replace\(/.test(page),
    "the shortening uses no regex, which a template literal would mangle",
  );
  assert(
    /button\.title = file\.path/.test(page),
    "and the full path is still on the row, which opens by path",
  );
  // The New file prompt has to carry the real name whatever this says, because
  // it is the one place a name is being typed.
  assert(
    /window\.prompt\('New file, relative to the vault root:', suggested\)/.test(
      page,
    ),
    "the New file prompt still takes a full name",
  );
  assert(
    /const suggested = 'notes\/untitled\.md'/.test(page),
    "including the extension it suggests",
  );
});

Deno.test("the icons come from one curated map", async () => {
  // One map and one frame, so a shape is not drawn twice and two controls
  // cannot drift onto the same mark — the failure the same-glyph test records
  // when the toggle and the menu were both a ☰.
  //
  // This reads src/page.ts rather than `page`, because the map is the thing
  // that builds the page: by the time the document exists it is interpolation
  // output, and a name that has gone unused would be invisible from here.
  const source = await Deno.readTextFile(
    join(import.meta.dirname!, "page.ts"),
  );
  const keys = [...source.matchAll(/^\s{2}(\w+): chromeIcon\(/gm)]
    .map(([, key]) => key);
  assert(
    keys.length >= 9,
    `every icon is named in the map: ${keys.join(", ")}`,
  );
  assert(
    new Set(keys).size === keys.length,
    "no icon is defined twice under two names",
  );
  // currentColor is the point of the migration: it is what lets a glyph follow
  // a palette, which is exactly what the colour emoji could not do.
  assert(
    /stroke="currentColor"/.test(source),
    "the frame inherits its container's colour",
  );
  assert(
    /aria-hidden="true"/.test(source),
    "and contributes nothing to an accessible name",
  );
});

Deno.test("the top bar labels one command and icons another", () => {
  // The rule the bar follows: a control earns a permanent slot by being used
  // while typing, and it earns a *word* only if it is the one you reach for
  // mid-sentence. Save is that one. Reload is the same kind of action but the
  // rarer of the two, so it keeps a glyph; New is not a document action at all
  // and lives in the menu, Ctrl+N, and the + beside the file list.
  const style = page.slice(0, page.indexOf("</style>"));
  const header = page.slice(
    page.indexOf('<header class="tabbar">'),
    page.indexOf("</header>"),
  );
  const buttons = [...header.matchAll(/<button ([^>]*)>/g)].map(([, attrs]) =>
    attrs
  );

  assert(!header.includes("newFileButton"), "the bar carries New again");
  assert(header.includes('id="saveButton"'), "the bar keeps Save");
  assert(
    /class="button button-primary" id="saveButton"/.test(header),
    "Save is still the primary button",
  );
  // A labelled button is a claim about frequency, so there is exactly one.
  const labelled = buttons.filter((attrs) =>
    !/icon-button|sidebar-toggle|menu-button/.test(attrs)
  );
  assert(
    labelled.length === 1,
    `the top bar shows ${labelled.length} labelled commands`,
  );

  // Reload kept its slot as a glyph: a 28px button whose whole content is the
  // arrow, with the word surviving only where it cannot be seen — the label and
  // the tooltip. A string of text back in that button fails here.
  // Slice `header`, not `page`: the index is measured in this string, and using
  // it on `page` lands somewhere in the stylesheet.
  const reload = header.slice(
    header.indexOf(
      '<button class="button button-secondary icon-button" id="reloadButton"',
    ),
  );
  const [reloadAttrs, reloadInner] = reload.split(">");
  assert(
    reloadInner !== undefined && reloadInner.startsWith("<svg"),
    `the reload button is not a glyph: ${reloadInner?.slice(0, 60)}`,
  );
  // The word went into the tooltip and the accessible name, which is the only
  // way a button whose entire content is an aria-hidden arrow has a name at all.
  assert(
    reloadAttrs.includes('title="Reload from disk"') &&
      reloadAttrs.includes('aria-label="Reload from disk"') &&
      reloadInner.includes('aria-hidden="true"'),
    `the reload button is not named for a screen reader: ${reloadAttrs}`,
  );
  assert(
    !header.includes(">Reload"),
    "the word Reload is back in the bar as text",
  );
  // Being a glyph is only legible because it is also a name: the SVG is
  // aria-hidden, so the arrow alone would be an unnamed button.
  assert(
    page.includes("reloadButton.disabled = tab === null;"),
    "the reload button follows the active tab like Save",
  );

  // Removing them was only safe because both stay reachable: the command list
  // still owns them, and it is what the menu and the keyboard render.
  assert(
    page.includes("id: 'new'") && page.includes("id: 'reload'"),
    "a retired command left the command list",
  );
  // The create affordance moved to the file list, enablement and all.
  assert(
    /id="newFileButton"[^>]*disabled/.test(page),
    "the file list's create button ships disabled while no vault is open",
  );
  assert(
    page.includes("newFileButton.disabled = !open;"),
    "the vault decides when the create button opens",
  );
  // It only fits beside the filter because the input yields room: fixed at
  // width:100% the button is pushed out of the row.
  assert(
    /\.file-tools\s*\{[^}]*display:\s*flex/.test(style),
    "the file list's toolbar is a flex row",
  );
  assert(
    /\.filter\s*\{[^}]*flex:\s*1/.test(style),
    "the filter shrinks to make room for the create button",
  );
});

Deno.test("the page edits through the bundled editor, not a bare input", () => {
  // The markup, not either script: the head's appearance script comes before
  // the body, so the boundary is the body's own script.
  const markup = page.slice(page.indexOf("<body"), page.lastIndexOf("<script"));

  // CodeMirror needs a host element it can own, and the handle is the only
  // thing the page is allowed to know about it.
  assert(
    markup.includes('<div class="editor-host" id="editor">'),
    "the editor is mounted into its own host element",
  );
  assert(
    !/<textarea/.test(page),
    "no textarea is left behind to shadow it",
  );
  assert(
    page.includes("window.WikiEditor.create({"),
    "the page creates the editor through the bundle's factory",
  );
  assert(
    page.includes("if (editorApi === null)"),
    "a bundle that failed to load is reported instead of throwing on a keystroke",
  );
  // The toast above is only honest if the rest of the page survives with no
  // editor: the status line reports the cursor, and there is not one.
  assert(
    page.includes(
      "const cursor = editorApi === null ? 0 : editorApi.getCursor();",
    ),
    "a window whose editor never loaded still renders a status line",
  );
  // Every document the page opens is a key the editor remembers, so the two
  // sides agree on what a tab is.
  assert(
    page.includes("editorApi.showDocument(tab.path, tab.content)"),
    "switching tabs shows the document for that path",
  );
  assert(
    page.includes("editorApi?.forgetDocument(tab.path)"),
    "closing a tab releases its document",
  );

  // The textarea's styling has to be gone with it, and the editor's internals
  // must not be styled from here: CodeMirror injects its base theme after this
  // stylesheet with more specificity, so a `.cm-gutters` rule written here
  // loses and the gutter renders light grey in dark mode. The theme is in the
  // bundle instead.
  const style = page.slice(0, page.indexOf("</style>"));
  assert(
    !/\.cm-[\w-]*\s*\{/.test(style),
    "the page leaves CodeMirror's own classes to the editor's theme",
  );
  assert(
    !/^\s*textarea\s*\{/m.test(style),
    "the old textarea rules are gone",
  );
});

Deno.test("the sidebar's drag handle moves the grid track it sits on", () => {
  const style = page.slice(0, page.indexOf("</style>"));

  // The script sets a custom property and the shell's template has to read the
  // same name: writing a width onto the sidebar element instead would leave the
  // track at its old size and the handle silently inert.
  assert(
    /\.app\s*\{[^}]*grid-template-columns:\s*var\(--sidebar-width\)/.test(
      style,
    ),
    "the shell's first track is the sidebar width token",
  );
  assert(
    page.includes("setProperty('--sidebar-width'"),
    "the drag writes that same token",
  );

  // The handle has to straddle the divider: parked inside the panel it would
  // make the user aim one pixel away from the line that moves.
  assert(
    /\.resizer\s*\{[^}]*right:\s*-\d/.test(style),
    "the handle overhangs the sidebar's edge",
  );

  // At drawer width the sidebar is an overlay whose position is its transform,
  // so a handle on its edge would fight the slide-in it sits on.
  const narrow = style.slice(style.indexOf("@media (max-width: 640px)"));
  assert(
    /\.resizer\s*\{[^}]*display:\s*none/.test(narrow),
    "the drawer layout hides the resize handle",
  );

  // The bounds the handle reports are the ones the config enforces, because
  // both are interpolated from the same constants. Literal numbers here would
  // let the two drift apart.
  assert(
    page.includes(`aria-valuemin="${SIDEBAR_MIN_WIDTH}"`) &&
      page.includes(`aria-valuemax="${SIDEBAR_MAX_WIDTH}"`) &&
      page.includes(`aria-valuenow="${DEFAULT_SIDEBAR_WIDTH}"`),
    "the handle reports the shared width bounds",
  );
});

Deno.test("the brand row and the tab bar share one height", () => {
  // The rule under the brand row is the vault panel's border-top while the tab
  // bar draws its own border-bottom. Sized independently, the two rows drift
  // apart and the divider steps at the sidebar edge — which is exactly what two
  // separately-measured rows did before this token existed.
  const style = page.slice(0, page.indexOf("</style>"));

  for (const row of ["brand", "tabbar"]) {
    assert(
      new RegExp(`\\.${row}\\s*\\{[^}]*height:\\s*var\\(--topbar-height\\)`)
        .test(style),
      `the ${row} row takes its height from the shared token`,
    );
  }
  assert(
    /--topbar-height:\s*\d+px/.test(style),
    "the shared height token is defined for light mode",
  );
  // Equal heights are only half of it. A border-bottom is drawn inside its own
  // box and a border-top inside the neighbour's, so rows that merely touch put
  // their rules on opposite sides of the shared edge: 1px apart, which is the
  // stray pixel at the sidebar seam. Both columns must draw the line the same
  // way round.
  assert(
    /\.brand\s*\{[^}]*border-bottom:\s*1px solid/.test(style),
    "the brand row draws the divider under the top bar itself",
  );
  assert(
    !/\.vault\s*\{[^}]*border-top/.test(style),
    "the vault panel does not draw a second, 1px-lower copy of that divider",
  );
  // The same pairing at the bottom edge, where the two rows also have to agree
  // on a height or their border-tops land on different pixels.
  assert(
    /\.sidebar-status\s*\{[^}]*height:\s*var\(--statusbar-height\)/.test(style),
    "the sidebar status row takes the shared status height",
  );
  assert(
    /\.statusbar\s*\{[^}]*height:\s*var\(--statusbar-height\)/.test(style),
    "the workspace status bar takes the shared status height",
  );
  // At drawer width the sidebar overlays the workspace and the tab bar wraps,
  // so a fixed height there would clip it.
  const narrow = style.slice(style.indexOf("@media (max-width: 640px)"));
  assert(
    /\.brand,\s*\.tabbar\s*\{[^}]*height:\s*auto/.test(narrow),
    "the drawer layout lets both rows grow again",
  );
});

Deno.test("the collapsed layout keeps the workspace in a real track", () => {
  // Collapsing hides the sidebar, which removes it from the grid — so without
  // an explicit column the workspace is auto-placed into the 0-width first
  // track and the whole window renders blank. Both layouts need that pin: the
  // two-column shell and the single-column drawer.
  const style = page.slice(0, page.indexOf("</style>"));
  const narrow = style.slice(style.indexOf("@media (max-width: 640px)"));

  assert(
    /\.workspace\s*\{[^}]*grid-column:\s*2/.test(style),
    "the workspace is pinned to the second column",
  );
  assert(
    /\.workspace\s*\{[^}]*grid-column:\s*1/.test(narrow),
    "the narrow layout pins the workspace to the only column",
  );
  assert(
    /\.app\.is-collapsed\s*\{[^}]*grid-template-columns:\s*0/.test(style),
    "collapsing narrows the first track to nothing",
  );
});

/**
 * The page's stylesheet with its comments stripped.
 *
 * Both rules below are explained by a comment that names the very property
 * being asserted on, so matching the raw text would find the prose rather
 * than the declaration.
 */
function styleSheet(): string {
  return page.slice(0, page.indexOf("</style>")).replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
}

Deno.test("nothing is hidden past the edge of a narrow window", () => {
  // The shell clips its overflow rather than scrolling it, so a min-width on
  // the body is not a floor the layout grows into — it is a floor the window
  // cannot shrink below, and everything past it is unreachable. At 280px the
  // page menu sat at x=310 with no way to scroll to it.
  const body = styleSheet().match(/\n\s*body\s*\{([^}]*)\}/);

  assert(body !== null, "the page styles the body");
  assert(
    !/min-width/.test(body![1]),
    "the body has no min-width, so a narrow window cannot clip its controls",
  );
});

Deno.test("the vault picker keeps its actions inside a short window", () => {
  // The dialog is a flex column with a max-height and overflow: hidden, so
  // whichever row refuses to shrink is what pushes the footer out of view.
  // Measured at 360x480 the footer overhung the dialog by 12px, taking Cancel
  // and Use this folder with it.
  const style = styleSheet();
  const list = style.match(/\.dir-list\s*\{([^}]*)\}/);

  assert(list !== null, "the page styles the folder list");
  assert(
    /min-height:\s*0/.test(list![1]),
    "the folder list may shrink instead of pushing the dialog's actions away",
  );
  assert(
    /\.dialog\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/.test(
      style,
    ),
    "the dialog is the flex column those rows share",
  );
});

Deno.test("closing a vault clears the listing it was showing", () => {
  // closeVault and switchVault both change which vault is open, so both have
  // to reload the listing. renderFiles only redraws the array already in
  // memory, which after a close is the previous vault's files — the sidebar
  // kept listing 95 files under a header reading "No vault open".
  assert(
    /async function closeVault\(\)[\s\S]*?await loadFiles\(\)/.test(page),
    "closeVault reloads the listing rather than redrawing the stale one",
  );
  assert(
    /async function switchVault\([\s\S]*?await loadFiles\(\)/.test(page),
    "and switching vaults reloads it the same way",
  );
  assert(
    /async function loadFiles\(\)[\s\S]*?if \(vault\.root === null\) \{\s*files = \[\];/
      .test(page),
    "reloading with no vault open empties the listing",
  );
});

Deno.test("the command menu is built from the command list", () => {
  // The popup ships empty, so the markup cannot drift from the list that
  // drives the enablement, and the list is the only place a command is named.
  assert(
    /<div class="menu-popup" id="commandMenu"[^>]*hidden><\/div>/.test(page),
    "the menu popup ships empty and hidden",
  );
  assert(
    page.includes("commandMenu.lastElementChild.appendChild(item)"),
    "the items come from the render walk, not a second copy in the markup",
  );
  // Both entry points have to land on the same guard: a menu that runs a
  // disabled command, or an external caller that cannot tell a disabled
  // command from an unknown one, fails here rather than on a click.
  assert(
    page.includes("if (!command || !command.canRun()) return false;"),
    "running a command re-checks whether it can run",
  );
  assert(
    page.includes("window.wikiRunCommand = (id) => runCommand(String(id));"),
    "the same path is reachable from outside the page",
  );
  // Escape belongs to the topmost surface: the menu closes before the vault
  // dialog and the sidebar drawer get their turn.
  assert(
    /if \(event\.key === 'Escape' && menuIsOpen\(\)\)/.test(page),
    "the menu takes Escape before the surfaces under it",
  );
  const documentHandler = page.indexOf("document.addEventListener('keydown'");
  assert(
    page.indexOf("event.key === 'Escape' && menuIsOpen()") <
      page.indexOf(
        "event.key === 'Escape' && !overlay.hidden",
        documentHandler,
      ),
    "that check comes first in the handler",
  );
});

Deno.test("the appearance is one choice out of three, and the menu shows it", () => {
  // The palette is plain CSS keyed on an attribute, so the attribute name is
  // the whole coupling: if the script and the stylesheet ever disagree the app
  // silently renders light forever and nothing else in this file would notice.
  const style = page.slice(0, page.indexOf("</style>"));
  assert(
    style.includes(':root[data-theme="dark"]'),
    "the dark palette is selected by the attribute",
  );
  // Comments are allowed to name it; rules are not.
  const rules = style.replace(/\/\*[\s\S]*?\*\//g, "");
  assert(
    !rules.includes("prefers-color-scheme"),
    "a rule also keys on the OS, so the mode has two sources of truth",
  );

  const list = page.slice(
    page.indexOf("const commands = ["),
    page.indexOf("let menuIndex"),
  );
  const choices = [
    ...list.matchAll(
      /id: '(theme-\w+)'[^}]*?isActive: \(\) => vault\.theme === '(\w+)'/g,
    ),
  ]
    .map(([, id, preference]) => ({ id, preference }));
  assert(
    choices.length === 3,
    `expected three appearance choices, found ${choices.length}`,
  );
  assert(
    choices.map((choice) => choice.preference).join(",") ===
      "system,light,dark",
    `the three preferences are not the stored ones: ${
      choices.map((choice) => choice.preference).join(", ")
    }`,
  );
  // Every one of them persists, and none of them bypasses setTheme: a choice
  // that wrote the attribute directly would leave the menu mark and the stored
  // preference disagreeing with what is on screen.
  const runs = [...list.matchAll(/run: \(\) => setTheme\('(\w+)', true\)/g)]
    .map(([, preference]) => preference);
  assert(
    runs.join(",") === "system,light,dark",
    `the appearance commands do not all persist: ${runs.join(", ")}`,
  );

  // A command fires and closes the menu; a choice has to stay put and say which
  // one is on, so the renderer has to treat it as a radio item. A setting that
  // is on or off, rather than one of several, overrides that with a checkbox —
  // a different role, even though it draws the same mark.
  assert(
    page.includes(
      "command.role ?? (isChoice ? 'menuitemradio' : 'menuitem')",
    ),
    "a choice is rendered as a plain command, with no way to override the role",
  );
  assert(
    /role: 'menuitemcheckbox'/.test(list) &&
      /role: 'menuitemcheckbox'[^\n]*isActive: \(\) => vault\.showExtensions/
        .test(list),
    "the extension toggle declares itself a checkbox and says which way it is on",
  );
  assert(
    page.includes(
      "item.setAttribute('aria-checked', command.isActive() ? 'true' : 'false')",
    ),
    "the menu does not report which appearance is on",
  );
  assert(
    /\.menu-check\s*\{[^}]*width:/.test(style),
    "the check has no gutter, so the labels shift when the choice moves",
  );

  // Applied from stored state on the way in, persisted on the way out.
  assert(
    page.includes("setTheme(state.theme, false)"),
    "stored state does not apply the appearance",
  );
  assert(
    page.includes("if (persist) call('setTheme', [vault.theme]);"),
    "a chosen appearance is not written to the config",
  );
  // An OS flip only matters while the preference defers to it.
  assert(
    /systemAppearance\.addEventListener\('change', \(\) => \{\s*if \(vault\.theme === 'system'\)/
      .test(page),
    "an OS flip is not heard, or is heard even after the user pinned a mode",
  );
});

Deno.test("the first paint already has the stored appearance", () => {
  // The window's mode must be settled in the document, not after the bindings
  // answer: a dark desktop would otherwise get a white flash on every launch,
  // and a user who pinned the opposite of their OS would see the wrong palette
  // until the state arrived.
  assert(
    page.includes('data-theme-preference="system"'),
    "the shipped page assumes an appearance instead of asking the OS",
  );
  assert(
    (page.match(/data-theme-preference/g) ?? []).length === 1,
    "the preference is baked in more than once",
  );
  const head = page.slice(page.indexOf("</style>"), page.indexOf("<body"));
  assert(
    head.includes(
      "applyAppearance(document.documentElement.dataset.themePreference)",
    ),
    "the preference is not resolved before the first paint",
  );
  assert(
    head.includes("document.documentElement.dataset.theme = resolved"),
    "the head script does not set the attribute the stylesheet reads",
  );
  assert(
    head.includes("window.matchMedia('(prefers-color-scheme: dark)')"),
    "the head script never asks the OS, so system cannot resolve",
  );

  const dark = pageForTheme("dark");
  assert(dark !== page, "pageForTheme does not change the document");
  assert(
    dark.replace(
      'data-theme-preference="dark"',
      'data-theme-preference="system"',
    ) === page,
    "pageForTheme rewrites more of the document than the preference",
  );
});

Deno.test("both entrypoints bake the stored appearance in", async () => {
  for (const file of ["main.ts", "dev_server.ts"]) {
    const source = await Deno.readTextFile(join(import.meta.dirname!, file));
    assert(
      source.includes("pageForTheme("),
      `${file} serves a document with no appearance baked in`,
    );
    assert(
      !/new Response\(page[,)]/.test(source),
      `${file} still serves the bare page`,
    );
  }
});

Deno.test("no menu entry advertises a shortcut the page does not handle", () => {
  // The menu renders the accelerator next to each label, so a label without a
  // matching branch in the keydown handler is a promise the app breaks the
  // first time a user presses it. (Deno desktop's *native* menu has this bug
  // today: it renders Ctrl+1 and fires nothing.)
  const list = page.slice(
    page.indexOf("const commands = ["),
    page.indexOf("let menuIndex"),
  );
  const labels = [...list.matchAll(/keys: '([^']+)'/g)]
    .map((match) => match[1])
    .filter((label) => label.length > 0);
  assert(labels.length >= 4, "the menu offers shortcuts at all");

  const unhandled = labels.filter((label) => {
    const letter = /^Ctrl\+([A-Z])$/.exec(label);
    if (letter) return !page.includes(`key === '${letter[1].toLowerCase()}'`);
    if (label === "Ctrl+Tab" || label === "Ctrl+Shift+Tab") {
      return !page.includes("event.key === 'Tab'");
    }
    return true;
  });
  assert(
    unhandled.length === 0,
    `these labels have no keydown branch: ${unhandled.join(", ")}`,
  );
});

Deno.test("every global the entrypoint calls is defined by the page", async () => {
  // src/main.ts reaches into the webview by string, so nothing type-checks
  // these names: a rename on either side would only fail at runtime, when the
  // close handler silently stopped seeing unsaved work.
  const entrypoint = await Deno.readTextFile(
    join(import.meta.dirname!, "main.ts"),
  );
  const called = new Set(
    [...entrypoint.matchAll(/executeJs\(\"window\.(\w+)\(/g)].map((match) =>
      match[1]
    ),
  );

  assert(called.size > 0, "the entrypoint calls into the webview");
  const undefined_ = [...called].filter((name) =>
    !page.includes(`window.${name} =`)
  );
  assert(
    undefined_.length === 0,
    `the entrypoint calls globals the page never defines: ${
      undefined_.join(", ")
    }`,
  );
});
