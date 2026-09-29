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
  // The tooltip is the one of the two labels a mouse user reads, and the two
  // toggles shipped with opposite wording — each right for the layout it
  // appears in, and wrong the moment the state moved. So the wording is
  // derived with the rest, and the shortcut rides along.
  assert(
    /toggle\.title = label \+ ' \(Ctrl\+B\)';/.test(page),
    "the toggle's tooltip is rewritten with the state, not left in the markup",
  );
  assert(
    /syncSidebarToggles\(\)[\s\S]*?toggle\.setAttribute\('aria-label', label\)/
      .test(
        page,
      ),
    "and the tooltip cannot be derived from anything but the accessible name",
  );
  // The two layouts keep different states for the same control, so a window
  // dragged across the breakpoint has to re-derive the labels; otherwise both
  // toggles go on describing the layout that just left.
  assert(
    /narrowWindow\.addEventListener\('change', syncSidebarToggles\);/.test(
      page,
    ),
    "crossing the breakpoint re-derives what both toggles say",
  );
});

Deno.test("no two icon-only buttons draw the same glyph", () => {
  // These buttons are 24-28px squares in one band of chrome, so a shared glyph
  // reads as one control drawn twice — which is what the sidebar toggle and the
  // app menu were, both ☰. The toggle draws a panel, the bar's reload is an
  // arrow, the file list's create button is a +, the menu keeps ☰, and the
  // vault's own button is a folder.
  const iconButtons = [
    ...page.matchAll(/<button ([^>]*)>([\s\S]*?)<\/button>/g),
  ]
    .map(([, attrs, inner]) => ({ attrs, inner: inner.trim() }))
    .filter(({ attrs }) => /\bicon-button\b/.test(attrs));

  assert(iconButtons.length === 6, "the app has six icon-only buttons");
  const by = (pattern: RegExp) =>
    iconButtons.filter(({ attrs }) => pattern.test(attrs));
  const toggles = by(/\bsidebar-toggle\b/);
  const menus = by(/id="menuButton"/);
  const creates = by(/id="newFileButton"/);
  const reloads = by(/id="reloadButton"/);
  const opens = by(/id="openVaultButton"/);
  assert(
    toggles.length === 2 && menus.length === 1 && creates.length === 1 &&
      reloads.length === 1 && opens.length === 1,
    "one app menu, one create button, one reload, one toggle per state, and one button for the vault",
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
    opens[0].inner,
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
  // script, and the placeholder is a div. The folder was a colour emoji,
  // which ignores `color` and so could not follow the palette at all. There was
  // a second placeholder on the no-vault panel; the panel is gone, and with it
  // the only remaining use of the folder at placeholder size.
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
    placeholders.length === 1,
    `the one placeholder left draws an icon rather than a character: found ${placeholders.length}`,
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
  // Hiding the row must not close the gap it left, and the way to guarantee
  // that is not to pad the button but to stop it being a row of its own: it
  // shares the name's row, so the header is one line with an optional sentence
  // under it.
  const headAt = page.search(/<div class="vault-head"[^>]*>/);
  assert(headAt > 0, "the vault header is one row in the markup");
  const head = page.slice(headAt, page.indexOf("</section>", headAt));
  assert(
    /id="openVaultButton"/.test(head),
    "the vault's action shares the row that holds its name",
  );
  // The name takes the width it needs and the button keeps its own, so a long
  // folder name ellipsises instead of pushing it off the panel.
  assert(
    /\.vault-actions \{[^}]*margin-left: auto/.test(page),
    "the button sits at the far end of the name's row",
  );
});

Deno.test("the folder dialog is the only way in, and it is the app's home", () => {
  // It used to have a panel of its own: an empty state with a folder icon, a
  // sentence, and a button whose only job was to open the dialog. So the app
  // had two surfaces for one action and the first click bought nothing, and
  // closing a vault put you back on a panel you then had to click through to
  // leave again. One dialog now opens itself when there is no vault, and the
  // sidebar's button opens that same dialog when there is one.
  assert(
    !/placeholderNoVault|emptyOpenVaultButton|Open a folder to begin|Choose a vault/
      .test(page),
    "there is no second surface for opening a vault",
  );
  assert(
    /async function init\(\)[\s\S]*?if \(vault\.root === null\) openBrowser\(\);/
      .test(
        page,
      ),
    "the app opens the dialog itself when it starts with no vault",
  );
  // After the listing is reloaded, not before: the dialog browses from the
  // state the app is in, so it must be opened once that state is the new one.
  const closeAt = page.indexOf("async function closeVault()");
  const closeBody = page.slice(
    closeAt,
    page.indexOf("async function", closeAt + 10),
  );
  const listingAt = closeBody.indexOf("await loadFiles();");
  assert(
    listingAt > 0 &&
      closeBody.indexOf("openBrowser();", listingAt) > listingAt,
    "and closing a vault returns to it rather than to a panel with a button",
  );
  // With nothing open the dialog is the app, so it names that rather than the
  // switch, and it does not offer a way out of itself: Cancel, Escape and the
  // scrim all lead to a window with no vault and no way to work in it.
  assert(
    /browserTitle\.textContent = vault\.root === null[\s\S]{0,80}'Open a vault'/
      .test(
        page,
      ),
    "the dialog says which of the two questions it is asking",
  );
  assert(
    /cancelBrowseButton\.hidden = vault\.root === null;/.test(page),
    "Cancel is hidden when there is nothing to return to",
  );
  assert(
    /function closeBrowser\(\) \{[\s\S]*?if \(vault\.root === null\) return;/
      .test(
        page,
      ),
    "and Escape cannot dismiss it into an app with no vault",
  );
  // The guard reads the state as it is, and choosing a folder is how a user
  // with no vault gets one — so that path has to take the dialog down without
  // asking the guard, or the app opens its vault and leaves the dialog over it.
  assert(
    /async function switchVault\([\s\S]*?hideBrowser\(\);/.test(page),
    "opening a vault from the dialog puts the dialog away",
  );
  assert(
    /function closeBrowser\(\)[\s\S]*?if \(vault\.root === null\) return;\s*hideBrowser\(\);/
      .test(
        page,
      ),
    "and the guarded path delegates to the same hide",
  );
});

Deno.test("the vault header's menu is the command list, not a second copy", async () => {
  // The sidebar's path row is gone while a vault is open, so the whole path
  // has to come out some other way; the header's own menu is it. The menu is
  // filled from the command list rather than written out again, so an action
  // can never exist in one place and not the other, and the header's item and
  // the app menu's entry are the same command with one run path.
  assert(
    /<div class="menu-popup vault-menu" id="vaultMenu"[^>]*hidden><\/div>/.test(
      page,
    ),
    "the header's menu ships empty and hidden, like the app menu",
  );
  assert(
    /for \(const command of commands\.filter\(\(entry\) => entry\.context\)\)/
      .test(
        page,
      ),
    "its items are the commands marked for it",
  );
  assert(
    /item\.addEventListener\('click', \(\) => \{\s*hideVaultMenu\(\);\s*runCommand\(command\.id\);/
      .test(page),
    "and they run the way the app menu's do",
  );
  // Fixed positioning is measured against the window, and the sidebar is a
  // transformed element in the drawer layout, so a menu inside it would be
  // placed relative to a panel that may be off screen.
  assert(
    page.indexOf('id="vaultMenu"') > page.indexOf("</aside>"),
    "the menu lives outside the sidebar, whose transform would capture it",
  );
  // It is the same popup class, anchored at right: 0 for the button it grew
  // out of. Left and right both set with width: auto stretches the box to the
  // window instead of hugging its item, which is a 735px menu with one line in
  // it. Measured, not guessed.
  const rule = page.match(/\.vault-menu\s*\{([^}]*)\}/);
  assert(
    rule !== null && /right:\s*auto/.test(rule[1]),
    "the menu clears the side of the anchor it is not using",
  );
  // The path comes out through the webview's own clipboard, in the row's
  // action and not in a binding: a binding would mean the app launching a
  // process, and the app is built without --allow-run on purpose.
  assert(
    /id: 'copy-vault-path'[^}]*canRun: \(\) => vault\.root !== null, context: true, run: copyVaultPath/
      .test(
        page,
      ),
    "copying the path is one of those commands, and it says it needs a vault",
  );
  assert(
    /await copyText\(path\);\s*showToast\('Copied the vault path'\);/.test(
      page,
    ),
    "and it says when it worked",
  );
  assert(
    /showToast\('Could not copy the path\.'\)/.test(page),
    "and when it did not, rather than failing quietly",
  );
  const bindings = await Deno.readTextFile(
    join(import.meta.dirname!, "bindings.ts"),
  );
  assert(
    !/Deno\.Command|reveal|openExternal/i.test(bindings),
    "the binding layer launches no process to do it",
  );
  // With no vault open the menu has nothing to act on, and a menu of one
  // greyed-out item is a worse answer than no menu.
  assert(
    /if \(vault\.root === null\) return;\s*openVaultMenu\(event\.clientX/.test(
      page,
    ),
    "the header's menu does not open when there is no vault",
  );
  // A right-click near the edge of the window must not open a menu that runs
  // off it, with its only item unreachable.
  assert(
    /Math\.min\(x, window\.innerWidth - box\.width - edge\)/.test(page) &&
      /Math\.min\(y, window\.innerHeight - box\.height - edge\)/.test(page),
    "and it is pulled back inside the window",
  );
  // Escape closes it from the one document handler the other surfaces share,
  // and opening it closes the app menu, so there is never a question of which
  // of two popups Escape means.
  assert(
    /function openVaultMenu\([\s\S]*?closeMenu\(false\);/.test(page),
    "opening the header's menu closes the app menu, so only one is ever up",
  );
  const keydown = page.slice(
    page.indexOf("document.addEventListener('keydown'"),
  );
  assert(
    /event\.key === 'Escape' && vaultMenuIsOpen\(\)/.test(keydown) &&
      keydown.indexOf("vaultMenuIsOpen()") <
        keydown.indexOf("event.key === 'Escape' && menuIsOpen()"),
    "Escape closes the header's menu first, in the handler the surfaces share",
  );
});

Deno.test("the vault's one button is named for the state it acts on", () => {
  // It was a labelled button, so the word came with it. As an icon the name has
  // to come from somewhere, and what it has to say changes: with a vault open
  // the same button switches it, and "Open a vault" then describes neither what
  // it does nor the fact that a vault is already open.
  assert(
    /<button[^>]*id="openVaultButton"[^>]*title="Open a vault"[^>]*aria-label="Open a vault"/
      .test(page),
    "the open button ships a name, since an aria-hidden glyph names nothing",
  );
  assert(
    /openVaultButton\.title = open \? 'Open another vault' : 'Open a vault';/
      .test(
        page,
      ),
    "and it changes with the state it acts on",
  );
  assert(
    /openVaultButton\.setAttribute\('aria-label', open \? 'Open another vault' : 'Open a vault'\);/
      .test(page),
    "and the accessible name changes with it, not only the tooltip",
  );
  // Closing a vault is a menu entry, the way VS Code keeps Close Folder in its
  // File menu rather than on the folder: the header keeps the one action a user
  // reaches for while browsing, and a second button beside it was a second way
  // to reach a rarer action. One command, one place — so nothing in the markup
  // or the script is left pointing at a button that is no longer there.
  assert(
    !/closeVaultButton/.test(page),
    "nothing is left pointing at a close button the header no longer has",
  );
  assert(
    /id: 'close-vault', group: 'Vault', label: 'Close vault', keys: '', canRun: \(\) => vault\.root !== null, run: closeVault/
      .test(
        page,
      ),
    "and Close vault is one menu command, which says when it cannot run",
  );
  // The file list empties with the vault, so the row that filters and creates
  // from it has nothing to act on: it was a filter over nothing and a disabled
  // create button, the part of closing a vault that had not been finished.
  assert(
    /<div class="file-tools" id="fileTools">/.test(page),
    "the file list's toolbar is something the page can hide",
  );
  assert(
    /fileTools\.hidden = !open;/.test(page),
    "and it goes when the vault it acts on does",
  );
});

Deno.test("both scrolling rows ask for a thin scrollbar", () => {
  // The app is dark and the platform's default scrollbar is sized and coloured
  // for a light page, so it sat in the middle of the file list as a light grey
  // bar in the one column a reader is always scrolling. The tab strip already
  // asked for a thin one; this makes the pair agree rather than leaving the
  // next scrolling row to rediscover it.
  for (const row of ["file-list", "tabs"]) {
    assert(
      new RegExp(`\\.${row} \\{[^}]*scrollbar-width: thin`).test(page),
      `the ${row} asks for a thin scrollbar`,
    );
  }
});

Deno.test("a file row says which page is showing, and which rows are assets", () => {
  // The active row was brand-coloured and bold, and the open ones carried a
  // rail: both states a screen reader cannot see. In a list where a hundred
  // rows differ only by folder, "which page am I in" has to be said rather than
  // tinted.
  assert(
    /button\.setAttribute\('aria-current', 'true'\)/.test(page),
    "the row for the open document is marked as the current one",
  );
  // Marked in the active branch, not the open one: a row with a buffer behind
  // it is not the document on screen, and marking those too would make
  // "current" mean "open" in the one list where the two differ.
  const rows = page.slice(page.indexOf("for (const file of visible)"));
  const activeBranch = rows.slice(
    rows.indexOf("if (active !== null && active.path === file.path)"),
    rows.indexOf("} else if (openPaths.has(file.path))"),
  );
  assert(
    /button\.setAttribute\('aria-current', 'true'\)/.test(activeBranch),
    "and it is the active row that is marked, not every row that is open",
  );
  // An asset was dimmed, which is the only thing that said it was not a page of
  // the wiki. Said once more in the row's own words rather than in an
  // aria-label: replacing the visible name is what breaks voice control, and
  // the row already names itself correctly.
  assert(
    /kind\.className = 'sr-only';\s*kind\.textContent = 'static file'/.test(
      page,
    ),
    "an asset row says it is a static file, in the row rather than over it",
  );
  assert(
    /if \(file\.scope === 'asset'\) \{\s*const kind = document\.createElement\('span'\)/
      .test(
        page,
      ),
    "and only assets are marked as one",
  );
  assert(
    !/button\.aria-label|button\.setAttribute\('aria-label'/.test(rows),
    "no file row overrides its visible name with an aria-label",
  );
});

Deno.test("every list switch is reachable from the list it changes", () => {
  // Extensions was filed as a menu command first, which put it one level too
  // far from the thing it controls: a user looking at the file list had no
  // reason to think Appearance governed it. So each switch has two controls —
  // the checkbox beside the list and the item in the menu — and both drive one
  // state, or the two disagree about the same setting.
  //
  // They are now one table and one setter, and this is the test that says so.
  // Written per setting, it is three tests that can each pass while the third
  // one is wired differently from the other two, which is exactly what happened:
  // Assets got a checkbox and no menu item, and forgot itself on every launch.
  // The table lives in src/page.ts's own scope and is injected into the page,
  // so what the script wires up is the same list that drew the markup. This is
  // that list as the browser receives it: the first entry, which pins the order
  // the two surfaces are drawn in.
  assert(
    /const LIST_VIEWS = \[\{"key":"showAssets"/.test(page),
    "the switches reach the script as one table, in the toolbar's order",
  );
  for (const key of ["showAssets", "showExtensions", "showPaths"]) {
    assert(
      new RegExp(`"key":"${key}"`).test(page),
      `the table declares ${key}`,
    );
  }
  // The table draws the markup, so the three labels are the same list the
  // script wires up. These ids are the ones the label elements have always
  // had — they come from the key, so a rename would be a break the stylesheet
  // would not explain.
  for (const id of ["assetsToggle", "extensionsToggle", "pathsToggle"]) {
    assert(
      new RegExp(`id="${id}"`).test(page),
      `the toolbar has the label the table derives: ${id}`,
    );
  }
  for (const key of ["showAssets", "showExtensions", "showPaths"]) {
    assert(
      new RegExp(`<input type="checkbox" id="${key}"`).test(page),
      `and a checkbox for ${key} beside the list it redraws`,
    );
  }
  assert(
    /for \(const view of listViews\) \{\s*view\.input\.addEventListener\('change', \(\) => setListView\(view\.key, view\.input\.checked, true\)\)/
      .test(page),
    "and each checkbox drives the one setter the menu command uses",
  );
  assert(
    /function setListView\(key, show, persist\) \{[\s\S]*?vault\[key\] = show;/
      .test(page) &&
      /function setListView\(key, show, persist\) \{[\s\S]*?viewByKey\[key\]\.input\.checked = show;/
        .test(page),
    "which moves the state and the checkbox together, so the two cannot drift",
  );
  assert(
    /function setListView\(key, show, persist\) \{[\s\S]*?call\(viewByKey\[key\]\.operation, \[show\]\)/
      .test(page),
    "and stores it, so every switch survives a restart like every other",
  );
  // The stored state wins over the markup's checked attribute on load. It is
  // already a boolean for all three, so the rule is one typeof test and the
  // switch's own default for a caller that sent a partial state — which is
  // what src/appearance_check.ts sends, and why the fallback is not a guess.
  assert(
    /const stored = state\[view\.key\];[\s\S]*?typeof stored === 'boolean' \? stored : view\.default;/
      .test(page),
    "and the stored setting wins over the markup's default on load",
  );
  // One menu item per switch, from the same table, and each says which way it
  // is on rather than firing and closing the menu.
  assert(
    /\.\.\.listViews\.map\(\(view\) => \(\{[\s\S]*?role: 'menuitemcheckbox'[\s\S]*?isActive: \(\) => vault\[view\.key\]/
      .test(page),
    "the Appearance menu has an item per switch, reporting which way it is on",
  );
  // Three labelled checkboxes, a filter and a button are more than a 200px
  // sidebar's toolbar has, so the row wraps. Grouping keeps them together: left
  // free they split across lines one checkbox each.
  assert(
    /\.file-tools-checks \{[^}]*display: flex/.test(page),
    "the checkboxes wrap as a group rather than one per line",
  );
  assert(
    /\.file-tools \{ flex-wrap: wrap/.test(page),
    "and the toolbar is allowed to wrap at all",
  );
});

Deno.test("what each switch changes is still its own", () => {
  // The table shares how a switch is wired; it cannot share what it does, and
  // the three effects are different enough to be worth pinning separately. If
  // this test fails, one switch has been wired to another's state.
  // Extensions: the name.
  assert(
    /function listedName\(file\) \{[\s\S]*?vault\.showExtensions/.test(page),
    "the shortened name depends on showExtensions",
  );
  // Paths: the second line. The span is not created at all when it is off,
  // rather than hidden with CSS: a display:none node is out of sight but still
  // in the tab order and still read aloud, which is not what turning the
  // setting off means.
  assert(
    /if \(vault\.showPaths\) \{\s*if \(separator !== -1\)/.test(page),
    "the folder line is left out of the row entirely when showPaths is off",
  );
  // Assets: which files are listed. Read from the state, not the checkbox, so
  // the stored preference survives a vault with nothing to list — reading the
  // checkbox is what made this one per-session in all but name.
  assert(
    /const listed = hasAssets && vault\.showAssets/.test(page),
    "the list of files reads showAssets from the state",
  );
  assert(
    /for \(const view of listViews\) \{\s*if \(view\.needsAssets\) view\.label\.hidden = !hasAssets;/
      .test(page),
    "and the switch hides itself in a vault that declares no assets",
  );
  // The row still names the file it opens, so no switch can turn two different
  // files into the same row.
  assert(
    /name\.textContent = listedName\(file\)/.test(page) &&
      /button\.title = file\.path/.test(page),
    "the name and the row's title are untouched by the switches",
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
  // And the other half of the same failure: an icon nothing draws is a name in
  // the map claiming a shape is part of the app when it is not. The no-vault
  // placeholder went when the empty state did and left its folder behind.
  const undrawn = keys.filter((key) => !source.includes(`ICONS.${key}`));
  assert(
    undrawn.length === 0,
    `these icons are in the map but nothing draws them: ${undrawn.join(", ")}`,
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

/** One palette block's declarations, keyed by custom property name. */
function palette(selector: string): Map<string, string> {
  const sheet = styleSheet();
  const from = sheet.indexOf(selector);
  assert(from !== -1, `src/page.ts declares ${selector}`);
  const body = sheet.slice(from).match(/\{([^}]*)\}/)![1];
  return new Map(
    [...body.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
}

Deno.test("the palette is wazoo.dev's, and its purple is only selection", () => {
  // wazoo.dev/DESIGN.md, which this repository cannot read at build time: a
  // clone of wiki-desktop does not bring that file along, and a build that
  // failed when it was missing would be worse than a copy. So the values live in
  // src/page.ts and this test is the only thing that notices the copy going
  // stale — which is the point, because a palette nobody checks drifts back
  // towards whatever was there before within a few edits.
  const light = palette(":root {");
  const dark = palette(':root[data-theme="dark"] {');

  // The brand, in both modes: Sunset Orange for anything actionable, Highlight
  // for the marker that shows state, Ink for the text sitting on top of it.
  for (const [mode, tokens] of Object.entries({ light, dark })) {
    for (
      const [name, value] of Object.entries({
        "--brand": "#ff8c00",
        "--brand-dark": "#f57c00",
        "--brand-marker": "#ffaa00",
        "--on-brand": "#1f1b14",
      })
    ) {
      assert(
        tokens.get(name) === value,
        `${mode} ${name} is the design system's ${value}, not ${
          tokens.get(name)
        }`,
      );
    }
  }

  // The backgrounds the spec names, one per mode: Eggshell and Ink for light,
  // Void and Surface for dark. Dark being the spec's default is the reason the
  // dark canvas is a true #040404 rather than the near-black it was.
  assert(light.get("--canvas") === "#f7f2e8", "light paints Eggshell");
  assert(light.get("--text") === "#1f1b14", "light text is Ink");
  assert(dark.get("--canvas") === "#040404", "dark paints Void");
  assert(dark.get("--panel") === "#0f0f0f", "dark panels are Surface");
  assert(dark.get("--text") === "#b0b0b1", "dark text is the spec's grey");

  // One deliberate departure, and it is a legibility one. Sunset Orange on
  // Eggshell is 2.1:1 — a fill and a marker, never text — so the light palette's
  // word-carrying accent is a darkened orange at 5:1. Dark can keep the brand's
  // own value because orange on void is 9:1.
  assert(
    light.get("--brand-text") === "#a65000",
    "the light accent is legible on Eggshell",
  );
  assert(
    dark.get("--brand-text") === "#ff8c00",
    "the dark accent is legible on Void",
  ); // The spec's purple is a selection colour and this is the only place it is
  // allowed to appear — once per palette, and nowhere else. It used to be the
  // whole brand family, which is what turned the app violet; if it creeps back
  // into --brand or a focus ring, the palette has stopped being the design
  // system's.
  const purple = new Set(
    [...styleSheet().matchAll(/(--[a-z-]+):\s*([^;]+);/g)]
      .filter(([, , value]) => /846ce4|132,\s*108,\s*228/i.test(value!))
      .map(([, name]) => name),
  );
  assert(
    purple.size === 1 && purple.has("--selection-soft"),
    `the design system's purple is only ever selection, not ${
      [...purple].join(", ")
    }`,
  );
  // Both palettes carry it, or selecting text looks like a bug in one mode.
  for (const [mode, tokens] of Object.entries({ light, dark })) {
    assert(
      /132,\s*108,\s*228/.test(tokens.get("--selection-soft")!),
      `${mode} selects text in the design system's purple`,
    );
  }

  // The browser chrome the window draws around the page, kept to the value the
  // light canvas actually paints.
  assert(
    /<meta name="theme-color" content="#f7f2e8"/.test(page),
    "the window's own colour matches the light canvas",
  );
});

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
      /role: 'menuitemcheckbox'[\s\S]*?isActive: \(\) => vault\[view\.key\]/
        .test(list),
    "a list switch declares itself a checkbox and says which way it is on",
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
    // The webview keeps a profile directory next to the binary, so a document
    // served without no-store survives a rebuild and a launch can paint the
    // last build's stylesheet. That is not hypothetical: one build's cache held
    // 62 copies of the palette the app had already moved off, which is a very
    // confusing way to find out a change did not take.
    assert(
      /"cache-control":\s*"no-store"/.test(source),
      `${file} serves the document without no-store, so a stale document can outlive a build`,
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
    if (label === "Ctrl+Tab" || label === "Ctrl+Shift+Tab") {
      return !page.includes("event.key === 'Tab'");
    }
    const plain = /^Ctrl\+([A-Z])$/.exec(label);
    if (plain !== null) {
      return !page.includes(`key === '${plain[1].toLowerCase()}'`);
    }
    // A chord is advertised with its modifiers, and the handler has to read
    // them as part of the branch. Asserting the letter alone would pass for a
    // handler that also fires on the bare Ctrl+<letter>, taking a key nobody
    // offered along with the one they did.
    const shifted = /^Ctrl\+Shift\+([A-Z])$/.exec(label);
    if (shifted !== null) {
      return !page.includes(
        `key === '${shifted[1].toLowerCase()}' && event.shiftKey`,
      );
    }
    // The Alt chord, which is also the one that is not under the Ctrl guard:
    // an Alt+letter binding has to be reached before the handler bails out on
    // anything that is not Ctrl or Cmd, or the label is a promise nothing keeps.
    const alt = /^Shift\+Alt\+([A-Z])$/.exec(label);
    if (alt !== null) {
      return !page.includes(`key.toLowerCase() === '${alt[1].toLowerCase()}'`);
    }
    return true;
  });
  assert(
    unhandled.length === 0,
    `these labels have no keydown branch: ${unhandled.join(", ")}`,
  );
});

Deno.test("every command has its own id", () => {
  // The list is rendered one item per entry, so a repeated id is a repeated
  // row: the menu showed "Format all open pages" twice, and both rows ran the
  // same function, which is a worse bug than one row or none — it looks like
  // the app is offering two different things and is offering the same thing
  // twice. The ids are also what `window.wikiRunCommand` is keyed on, so a
  // duplicate silently makes one of them unreachable by name.
  const list = page.slice(
    page.indexOf("const commands = ["),
    page.indexOf("let menuIndex"),
  );
  const ids = [...list.matchAll(/id: '([^']+)'/g)].map((match) => match[1]);
  assert(ids.length > 0, "the list has commands in it at all");
  const seen = new Set<string>();
  const repeated = ids.filter((id) => {
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });
  assert(
    repeated.length === 0,
    `these command ids are declared more than once: ${
      [...new Set(repeated)].join(", ")
    }`,
  );
});

Deno.test("find takes the chord the host has, and is the only command that does", () => {
  const list = page.slice(
    page.indexOf("const commands = ["),
    page.indexOf("let menuIndex"),
  );
  const find = /\{ id: 'find'[^\n]*/.exec(list);
  assert(find !== null, "find is in the command list");
  assert(
    find![0].includes("keys: 'Ctrl+F'"),
    "find advertises the chord a reader already knows",
  );
  assert(
    find![0].includes("findInPage(false)"),
    "and opens find without the replace row",
  );

  // Replace is a second command, not a row that is always there, and it is the
  // only way to reach one. Both references agree on the shape: VS Code opens
  // find on Ctrl+F and adds the row on Ctrl+H, and the p5.js editor (following
  // Sublime) gives Find and Replace different chords. A found-and-shown
  // replace row is a page-rewriting button in the middle of a read-only-looking
  // panel, which is the accident this avoids.
  const replace = /\{ id: 'replace'[^\n]*/.exec(list);
  assert(replace !== null, "replace is its own command");
  assert(
    replace![0].includes("keys: 'Ctrl+H'"),
    "and carries the chord the reference editors pair with Ctrl+F",
  );
  assert(
    replace![0].includes("findInPage(true)"),
    "and opens find with the replace row revealed",
  );
  const replaceBranch = page.slice(
    page.indexOf("key === 'h'"),
    page.indexOf("key === 'o'"),
  );
  assert(
    replaceBranch.includes("event.preventDefault();") &&
      replaceBranch.includes("findInPage(true);"),
    "the Ctrl+H branch takes the browser's history chord and reveals replace",
  );

  // The chord has to be taken rather than merely offered: without
  // preventDefault the browser's find bar opens on top of the editor's panel,
  // and the reader gets two find boxes and the wrong one focused.
  const branch = page.slice(
    page.indexOf("key === 'f'"),
    page.indexOf("key === 'o'"),
  );
  assert(
    branch.includes("event.preventDefault();"),
    "the chord is taken from the browser, not shared with it",
  );
  assert(
    branch.includes("findInPage(false);"),
    "and it opens the editor's panel with no replace row",
  );

  // The page must not build a find bar of its own. Its own count would be a
  // second answer to a question the editor already answers, and the two would
  // disagree the moment a line scrolled out of the rendered range — which is
  // the reason for owning the chord in the first place.
  assert(
    (page.match(/id: 'find'/g) ?? []).length === 1,
    "there is exactly one find command",
  );
  // No find *panel* of its own. The sidebar's file filter is a search input
  // and is none of this test's business, so what is checked is a panel rather
  // than the word.
  assert(
    !/find-bar|findBar|find-panel|findPanel/.test(page),
    "the page draws no find panel of its own",
  );
  assert(
    !/<input[^>]+name=["']search["']/i.test(page),
    "and no second search field, which is what a hand-rolled find bar starts as",
  );
});

Deno.test("no command advertises a shortcut the host already owns", () => {
  // The browser dev server and the desktop window share one page, so a chord
  // the browser has bound is a chord this app cannot have. It shipped as
  // Ctrl+Shift+I first and the press opened a console the user had not asked
  // for, which in dev:web is indistinguishable from the app being broken.
  //
  // The desktop webview has no developer tools attached today, so nothing here
  // can see the collision happening -- which is exactly why it is a test
  // rather than a thing to remember.
  const reserved = [
    "Ctrl+Shift+I", // developer tools
    "Ctrl+Shift+J", // developer tools, console
    "Ctrl+Shift+C", // inspect
    "F12",
    "Ctrl+Shift+Delete",
  ];
  const list = page.slice(
    page.indexOf("const commands = ["),
    page.indexOf("let menuIndex"),
  );
  const labels = [...list.matchAll(/keys: '([^']+)'/g)].map((m) => m[1]);
  const taken = labels.filter((label) => reserved.includes(label));
  assert(
    taken.length === 0,
    `these shortcuts belong to the browser, not to the app: ${
      taken.join(", ")
    }`,
  );
});

Deno.test("formatting runs on the buffer, on pages only, and says what it did", () => {
  // The wiring, asserted against the source, the way the other editor tests in
  // this repo do: the page is a string and the editor is a bundle, so there is
  // no DOM here to drive.
  assert(
    page.includes("window.WikiFormat.formatMarkdown(before)"),
    "the command formats the text the editor holds",
  );
  assert(
    page.includes("editorApi.applyFormatted(after)"),
    "the formatted text goes back through the editor's handle",
  );

  // The formatter must not reach for the file on disk. Reading it and writing
  // it back is the one shape that loses a tab's unsaved edits, and the app has
  // no reason to do either -- the editor already holds the page.
  const format = page.slice(
    page.indexOf("function formatFile()"),
    page.indexOf("function formatAllOpenPages()"),
  );
  assert(
    !/call\('(readFile|writeFile)'/.test(format),
    "formatting does not read or write the file behind the tab",
  );

  // Only what the vault calls a page. The file list already carries the
  // scope, so the check is a comparison rather than a guess from the extension.
  assert(
    page.includes("file.scope === 'input'"),
    "formatting is gated on the vault listing the file under wiki.input",
  );
  assert(
    page.includes("is not a wiki page"),
    "a file that is not a page is refused by name, not silently skipped",
  );

  // Nothing to do has to say so. A key that formats a tidy page and reports
  // success anyway is how a user ends up pressing it twice to find out.
  assert(
    page.includes("is already formatted"),
    "a page with nothing to fix says so instead of reporting success",
  );
  // And a format that changed something is not a save: the buffer is dirty
  // until the user saves, and the toast has to not imply otherwise.
  assert(
    page.includes("not saved yet"),
    "the toast says the formatted page has not been written yet",
  );

  // A bundle that did not load is reported rather than throwing on a keystroke,
  // the same as the editor itself.
  assert(
    page.includes("The formatter failed to load"),
    "a missing formatter is reported instead of throwing",
  );
});

Deno.test("formatting every open page is the same call, run over the tab strip", () => {
  // The claim this command rests on is that it is not a second feature: one
  // formatter, one answer to what a page is, called once per open page. If a
  // second formatter or a second scope check ever appears here, the two
  // commands can disagree about the same file, and the disagreement is a page
  // the user formatted with one and not the other.
  const all = page.slice(
    page.indexOf("function formatAllOpenPages()"),
    page.indexOf("function formatterAvailable()"),
  );
  assert(
    all.includes("window.WikiFormat.formatMarkdown("),
    "it formats through the same entry the single-page command uses",
  );
  // The only function it declares is itself. A second one named format
  // anything would be a second formatter, which is the thing this command is
  // supposed not to be.
  const declared = [...all.matchAll(/function (format[A-Za-z]*)\(/g)].map(
    (match) => match[1],
  );
  assert(
    declared.length === 1 && declared[0] === "formatAllOpenPages",
    `it declares no formatter of its own, only these: ${declared.join(", ")}`,
  );
  assert(
    (all.match(/fileIsPage\(/g) ?? []).length >= 2,
    "it asks the one page check, rather than a second scope test of its own",
  );
  assert(
    !/scope\s*===/.test(all),
    "the scope comparison lives in fileIsPage alone, not repeated here",
  );

  // The active tab is the editor's document and the rest are the page's
  // buffers, and only the first can go through the handle. Getting this the
  // wrong way round means formatting a tab the editor is still showing and
  // then having the editor's stale copy overwrite it on the next keystroke.
  assert(
    all.indexOf("editorApi.applyFormatted(after)") <
      all.indexOf("window.WikiFormat.formatMarkdown(tab.content)"),
    "the tab on screen goes through the editor before the others are touched",
  );
  assert(
    all.includes("tab === active"),
    "a tab is not formatted twice, once through the editor and once as a buffer",
  );

  // Neither shape may reach the disk, for the reason the single-page command
  // does not: it is the one that loses unsaved edits.
  assert(
    !/call\('(readFile|writeFile)'/.test(all),
    "formatting every open page still does not touch the files behind the tabs",
  );

  // The dirty dots on the tabs nobody is looking at are drawn from their
  // buffers, so nothing else redraws them.
  assert(
    all.includes("renderTabs()"),
    "the tab strip is redrawn, so the dots on the hidden tabs follow",
  );

  // A count with nothing to count against is not a report. "Formatted 3" means
  // something quite different when three pages were open and when three hundred
  // were, and the summary has to say which happened.
  assert(
    all.includes("pages.length"),
    "the summary counts against the number of open pages",
  );
  assert(
    all.includes("'Every open page is already formatted'"),
    "a pass that changed nothing says so instead of reporting a count of zero",
  );
  // And it must not claim a save.
  assert(
    all.includes("not saved yet"),
    "the summary says the pages have not been written yet",
  );
});

Deno.test("formatting every open page is offered only when there is one to do", () => {
  const list = page.slice(
    page.indexOf("const commands = ["),
    page.indexOf("let menuIndex"),
  );
  const command = /id: 'format-all'[^\n]*/.exec(list);
  assert(command !== null, "the command is in the list at all");
  const entry = command![0];
  // Two reasons it cannot run: nothing open that is a page, and a bundle that
  // did not load. A menu entry that is enabled and then does nothing is worse
  // than one that is honestly greyed out.
  assert(
    entry.includes("tabs.some((tab) => fileIsPage(tab.path))"),
    "it needs at least one open file that is a wiki page",
  );
  assert(
    entry.includes("window.WikiFormat !== undefined"),
    "it is disabled when the formatter did not load",
  );
  assert(
    entry.includes("run: formatAllOpenPages"),
    "the menu entry and the command run the same function",
  );
});

Deno.test("no command id is listed twice", () => {
  // An id is what the menu item's data-command, the keyboard's focusCommand,
  // and window.wikiRunCommand all address a command by, so a repeat is not a
  // cosmetic duplicate: runCommand finds the first, the menu draws both, and
  // the entry the user can see is not the entry the key reaches. It shipped
  // once, as two identical lines in the list, and only the rendered menu
  // showed it.
  const list = page.slice(
    page.indexOf("const commands = ["),
    page.indexOf("let menuIndex"),
  );
  const ids = [...list.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
  assert(ids.length > 0, "there are commands to check at all");
  const seen = new Set<string>();
  const repeated = ids.filter((id) =>
    seen.has(id) ? true : (seen.add(id), false)
  );
  assert(
    repeated.length === 0,
    `these command ids are listed more than once: ${repeated.join(", ")}`,
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
