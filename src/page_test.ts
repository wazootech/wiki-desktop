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
import { page } from "./page.ts";

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
  // A class the renderer applies but the stylesheet never matches renders as
  // an unstyled element, which is exactly how the tab strip would break.
  const classes = [
    "tab",
    "tab-state",
    "tab-name",
    "tab-close",
    "is-active",
    "is-dirty",
    "file-button",
    "is-open",
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

Deno.test("every token used resolves, and dark only overrides light", () => {
  // Light is the mode we cannot see while the OS is dark, so check it by
  // structure instead: a var() with no definition resolves to nothing and a
  // token that exists only in the dark block leaves light mode unstyled.
  const style = page.slice(0, page.indexOf("</style>"));
  const darkAt = style.indexOf("@media (prefers-color-scheme: dark)");
  assert(darkAt > 0, "there is a dark block");
  const light = readTokens(style.slice(0, darkAt));
  const dark = readTokens(style.slice(darkAt));

  const used = new Set(
    [...style.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]),
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
