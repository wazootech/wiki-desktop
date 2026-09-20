/**
 * The appearance check: both palettes, driven in the real desktop webview.
 *
 * `deno task check:appearance`. Nothing else can answer the two questions the
 * palette rests on. The unit tests read the page as a string, so they can see
 * that the dark palette is declared and that no rule reads
 * prefers-color-scheme, but not that an engine resolves either; the browser dev
 * server is a different engine from the desktop's, and nothing in it can be
 * told to report a desktop appearance at all.
 *
 * Here the app's own document is served (`pageForTheme`, and the editor asset
 * at the path the app serves it from), the appearance the OS is asked about is
 * emulated ahead of the page's own head script, and the answers are read back
 * out of the running document. One process, one window, one case at a time: the
 * document is rebuilt per case — that is exactly what `pageForTheme` bakes —
 * and the window is reloaded between cases, so each pass starts from a fresh
 * document the way a launch does.
 *
 * What it asserts, per case, is the state that was previously only asserted
 * about the source: the mode is settled before the body exists, the tokens the
 * stylesheet declares for that mode are the ones the engine resolves, flipping
 * the desktop moves the mode only while the preference is `system`, and pinning
 * one stores it through the bindings and stops following the desktop.
 */
import { THEME_PREFERENCES, type ThemePreference } from "./config.ts";
import { editorScriptResponse, isEditorScript } from "./editor_asset.ts";
import { page, pageForTheme } from "./page.ts";

/** Which palette the attribute resolves to, which is all the page knows too. */
type Mode = "light" | "dark";

/** One pass: a stored preference to bake, and a desktop for the OS to report. */
interface AppearanceCase {
  name: string;
  stored: ThemePreference;
  desktop: Mode;
}

/** Every stored preference against both desktops, so neither rule is assumed. */
const CASES: AppearanceCase[] = THEME_PREFERENCES.flatMap((stored) =>
  (["dark", "light"] as const).map((desktop) => ({
    name: `${stored}-on-a-${desktop}-desktop`,
    stored,
    desktop,
  }))
);

/** What the mode has to be before the first paint, given those two inputs. */
function expectedMode(c: AppearanceCase): Mode {
  return c.stored === "system" ? c.desktop : c.stored;
}

function otherMode(mode: Mode): Mode {
  return mode === "light" ? "dark" : "light";
}

function commandFor(mode: Mode): string {
  return `theme-${mode}`;
}

/** The label the menu gives each preference, which is what a user reads. */
const PREFERENCE_LABEL: Record<ThemePreference, string> = {
  system: "Match the system",
  light: "Light",
  dark: "Dark",
};

/*
 * The expected colours come out of the stylesheet rather than being written
 * here a second time: this check is about whether the engine applied the
 * palette, not about whether the palette is a particular shade, and a hardcoded
 * copy would fail the day someone tunes a token.
 */
const CHECKED_TOKENS: ReadonlyArray<readonly [string, keyof Reading]> = [
  ["--canvas", "canvas"],
  ["--panel", "panel"],
  ["--panel-muted", "panelMuted"],
  ["--text-editor", "textEditor"],
];

/** The declarations of one `{ ... }` block, keyed by custom property name. */
function declarations(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) {
    found.set(name, value.trim());
  }
  return found;
}

function blockFor(selector: string): Map<string, string> {
  const at = page.indexOf(selector);
  if (at === -1) {
    throw new Error(
      `src/page.ts no longer declares ${selector}, so this check has nothing to compare against`,
    );
  }
  const open = page.indexOf("{", at);
  const close = page.indexOf("}", open);
  return declarations(page.slice(open, close));
}

const LIGHT = blockFor(":root {");
const DARK = blockFor(':root[data-theme="dark"]');
for (const tokens of [LIGHT, DARK]) {
  for (const [name] of CHECKED_TOKENS) {
    if (!tokens.has(name)) {
      throw new Error(
        `a palette in src/page.ts does not declare ${name}, which this check compares`,
      );
    }
  }
}

function tokensFor(mode: Mode): Map<string, string> {
  return mode === "dark" ? DARK : LIGHT;
}

/** `#f5f7fb` as the browser reports a painted colour. */
function toRgb(hex: string): string {
  const digits = hex.replace("#", "");
  const full = digits.length === 3
    ? digits.split("").map((digit) => digit + digit).join("")
    : digits;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The scripts this check injects into the head, ahead of the page's own.
 *
 * Each one exists so a claim can be measured instead of reasoned about: the
 * first records the mode the document was ever given and whether `<body>` had
 * been parsed at that moment, the second answers the page's
 * prefers-color-scheme question from a desktop this process controls, and the
 * third stands in for the desktop bindings, which is the only way to watch a
 * choice reach `setTheme`.
 */
function injectedHead(c: AppearanceCase): string {
  return `
<script>
  window.__case = ${JSON.stringify(c.name)};
  window.__firstTheme = null;
  new MutationObserver((_records, observer) => {
    const theme = document.documentElement.dataset.theme;
    if (window.__firstTheme === null && theme) {
      window.__firstTheme = { theme: theme, bodyParsed: document.body !== null };
      observer.disconnect();
    }
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
</script>
<script>
  window.__os = { dark: ${c.desktop === "dark"} };
  window.__osListeners = [];
  const realMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = function (query) {
    if (String(query).indexOf("prefers-color-scheme") === -1) {
      return realMatchMedia(query);
    }
    return {
      media: query,
      get matches() { return window.__os.dark; },
      addEventListener: function (type, fn) {
        if (type === "change") window.__osListeners.push(fn);
      },
      removeEventListener: function () {},
    };
  };
  window.__setOs = function (dark) {
    window.__os.dark = dark;
    for (const fn of window.__osListeners) fn({ matches: dark });
  };
</script>
<script>
  window.__persisted = [];
  window.__stateServed = false;
  window.bindings = {
    getState: function () {
      window.__stateServed = true;
      window.__servedTheme = ${JSON.stringify(c.stored)};
      return Promise.resolve({
        root: null,
        name: null,
        recents: [],
        sidebarCollapsed: false,
        sidebarWidth: 250,
        theme: window.__servedTheme,
      });
    },
    setTheme: function (theme) {
      window.__persisted.push(theme);
      return Promise.resolve({ theme: theme });
    },
  };
</script>
<script>
  window.__errors = [];
  window.addEventListener("error", function (event) {
    window.__errors.push(String(event.message || event.error));
  });
  window.addEventListener("unhandledrejection", function (event) {
    window.__errors.push("rejection: " + String(event.reason));
  });
</script>
`;
}

/** Which case the server is currently handing out. */
let current = CASES[0];

const server = Deno.serve((request) => {
  if (isEditorScript(new URL(request.url).pathname)) {
    return editorScriptResponse();
  }
  const html = pageForTheme(current.stored).replace(
    "<title>Wazoo Wiki</title>",
    "<title>Wazoo Wiki</title>" + injectedHead(current),
  );
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
});

const win = new Deno.BrowserWindow({
  title: "Wazoo Wiki appearance check",
  width: 900,
  height: 640,
});

/**
 * Everything the probe reads back. It is one expression so that what is measured
 * is one moment in the document's life, not several.
 */
const READ = `(() => {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const meta = document.querySelector('meta[name="theme-color"]');
  const checked = document.querySelector('.menu-item[aria-checked="true"]');
  const label = checked ? checked.querySelector('.menu-item-label') : null;
  return {
    case: window.__case,
    errors: window.__errors.slice(0, 4),
    firstTheme: window.__firstTheme,
    stateServed: window.__stateServed,
    servedTheme: window.__servedTheme,
    desktop: window.__os.dark ? 'dark' : 'light',
    preference: root.dataset.themePreference,
    mode: root.dataset.theme,
    canvas: style.getPropertyValue('--canvas').trim(),
    panel: style.getPropertyValue('--panel').trim(),
    panelMuted: style.getPropertyValue('--panel-muted').trim(),
    textEditor: style.getPropertyValue('--text-editor').trim(),
    colorScheme: style.colorScheme,
    meta: meta ? meta.content : null,
    bodyBackground: document.body ? getComputedStyle(document.body).backgroundColor : null,
    persisted: window.__persisted.slice(),
    checkedLabel: label ? label.textContent : null,
    canRunCommands: typeof window.wikiRunCommand === 'function',
  };
})()`;

interface Reading {
  case: string;
  errors: string[];
  firstTheme: { theme: string; bodyParsed: boolean } | null;
  stateServed: boolean;
  servedTheme: string | null;
  desktop: Mode;
  preference: string;
  mode: string;
  canvas: string;
  panel: string;
  panelMuted: string;
  textEditor: string;
  colorScheme: string;
  meta: string | null;
  bodyBackground: string | null;
  persisted: string[];
  checkedLabel: string | null;
  canRunCommands: boolean;
}

/**
 * `executeJs` answers with an `{ ok, value }` envelope, and the value of an
 * expression the caller stringified is that string — so unwrap, and let callers
 * JSON-decode what they asked to be stringified. Measuring the envelope instead
 * of the value is a mistake that reads as a page which never loaded.
 */
async function evaluate(expression: string): Promise<unknown> {
  const result = await win.executeJs(expression) as
    | { ok?: boolean; value?: unknown }
    | unknown;
  if (result && typeof result === "object" && "ok" in result) {
    const envelope = result as { ok?: boolean; value?: unknown };
    if (envelope.ok !== true) {
      throw new Error(`executeJs refused: ${JSON.stringify(result)}`);
    }
    return envelope.value;
  }
  return result;
}

async function read(): Promise<Reading> {
  const raw = await evaluate(`JSON.stringify(${READ})`);
  return JSON.parse(String(raw)) as Reading;
}

/**
 * The same reading, with the menu open.
 *
 * The menu renders its items when it opens, so which appearance it checks
 * cannot be read from a closed one — that would report `null` whether the page
 * marked the right entry or no entry at all. Opening it is also the closest
 * thing here to what a user does to see the choice.
 */
async function readWithMenuOpen(): Promise<Reading> {
  await evaluate("document.getElementById('menuButton').click(), true");
  await settle(80);
  const reading = await read();
  await evaluate("document.getElementById('menuButton').click(), true");
  return reading;
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The page is up when the document says which case it is (a reload is the only
 * thing that changes that) and the app has asked for its state, which it does
 * once, after the body script runs.
 */
async function waitForPage(c: AppearanceCase): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const up = await evaluate(
      `window.__case === ${
        JSON.stringify(c.name)
      } && window.__stateServed === true`,
    ).catch(() => false);
    if (up === true) return true;
    await settle(150);
  }
  return false;
}

interface Report {
  failures: number;
  check(label: string, ok: boolean, detail?: string): void;
  detail(label: string, value: string): void;
}

function newReport(): Report {
  return {
    failures: 0,
    check(label, ok, detail = "") {
      if (!ok) this.failures++;
      console.log(
        `${ok ? "  ok  " : " FAIL "} ${label}${
          detail ? `\n         ${detail}` : ""
        }`,
      );
    },
    detail(label, value) {
      console.log(`       ${label}: ${value}`);
    },
  };
}

/**
 * One case, start to finish: what the document did on its own, then the desktop
 * flipping under it, then a preference pinned against that desktop, then the
 * preference handed back to the desktop.
 *
 * Returns false when the document could not be loaded at all, which makes the
 * remaining cases meaningless.
 */
async function runCase(
  report: Report,
  c: AppearanceCase,
  index: number,
): Promise<boolean> {
  console.log(`\n${index + 1}/${CASES.length}  ${c.name}`);

  current = c;
  if (index > 0) {
    // The served document is rebuilt per case, so a reload is a fresh launch:
    // new bake, new emulated desktop, new observer.
    await evaluate("window.location.reload(), true").catch(() => {});
  }
  if (!await waitForPage(c)) {
    report.check(
      "the window loaded the case's document",
      false,
      index === 0
        ? "the window never ran the served document's script"
        : "the window did not reload between cases",
    );
    return false;
  }
  await settle(250);

  const mode = expectedMode(c);
  const tokens = tokensFor(mode);
  const loaded = await read();

  report.check(
    "the mode is settled before the body exists",
    loaded.firstTheme?.theme === mode &&
      loaded.firstTheme?.bodyParsed === false,
    `first mode ${loaded.firstTheme?.theme} at bodyParsed=${loaded.firstTheme?.bodyParsed}, expected ${mode} before the body`,
  );
  report.check(
    `the document bakes the stored preference (${c.stored})`,
    loaded.preference === c.stored,
    `data-theme-preference=${loaded.preference}`,
  );
  report.check(
    "the app's own state carries the preference the document was baked with",
    loaded.servedTheme === c.stored,
    `getState answered theme=${loaded.servedTheme}`,
  );

  const wrong = CHECKED_TOKENS.filter(([name, key]) =>
    loaded[key] !== tokens.get(name)
  );
  report.check(
    `the engine resolves the ${mode} palette the stylesheet declares`,
    wrong.length === 0,
    wrong.length === 0
      ? CHECKED_TOKENS.map(([name, key]) => `${name}=${loaded[key]}`).join(" ")
      : wrong
        .map(([name, key]) =>
          `${name}: declared ${tokens.get(name)}, resolved ${loaded[key]}`
        )
        .join("; "),
  );
  report.check(
    `color-scheme is ${mode}, so native chrome matches`,
    loaded.colorScheme === mode,
    `color-scheme=${loaded.colorScheme}`,
  );
  report.check(
    "the theme-color meta is the resolved canvas",
    loaded.meta === loaded.canvas,
    `meta=${loaded.meta} --canvas=${loaded.canvas}`,
  );
  report.check(
    "the resolved canvas is what the body actually paints",
    loaded.bodyBackground === toRgb(String(loaded.canvas)),
    `body=${loaded.bodyBackground} --canvas=${loaded.canvas}`,
  );
  report.check(
    "the page ran without errors",
    loaded.errors.length === 0,
    loaded.errors.join(" | ") || "none",
  );
  report.check(
    "nothing is stored merely by launching",
    loaded.persisted.length === 0,
    `setTheme called with ${JSON.stringify(loaded.persisted)}`,
  );

  // 2. The desktop flips under the page. Only a `system` preference may follow.
  const flipped = { ...c, desktop: otherMode(c.desktop) };
  await evaluate(`window.__setOs(${flipped.desktop === "dark"})`);
  const afterFlip = await read();
  const wantedOnFlip = c.stored === "system" ? otherMode(mode) : mode;
  report.check(
    c.stored === "system"
      ? "the desktop flip moves the mode"
      : "a pinned preference ignores the desktop",
    afterFlip.mode === wantedOnFlip,
    `desktop=${afterFlip.desktop} mode=${afterFlip.mode}, expected ${wantedOnFlip}`,
  );

  // 3. Pin the opposite of what is on, through the page's own command.
  const pinned = otherMode(mode);
  const ran = await evaluate(
    `window.wikiRunCommand(${JSON.stringify(commandFor(pinned))})`,
  );
  await settle(100);
  const afterPin = await read();
  report.check(
    `the ${pinned} command changes the mode`,
    ran === true && afterPin.mode === pinned,
    `ran=${ran} mode=${afterPin.mode}`,
  );
  report.check(
    "the choice is stored through the bindings",
    afterPin.persisted[afterPin.persisted.length - 1] === pinned,
    `setTheme called with ${JSON.stringify(afterPin.persisted)}`,
  );
  const menuAfterPin = await readWithMenuOpen();
  report.check(
    "the menu checks the chosen appearance",
    menuAfterPin.checkedLabel === PREFERENCE_LABEL[pinned],
    `checked in the open menu=${JSON.stringify(menuAfterPin.checkedLabel)}`,
  );

  // 4. The desktop flips again while that preference is pinned.
  const back = otherMode(flipped.desktop);
  await evaluate(`window.__setOs(${back === "dark"})`);
  const afterSecondFlip = await read();
  report.check(
    "the pinned mode survives a desktop flip",
    afterSecondFlip.mode === pinned,
    `desktop=${afterSecondFlip.desktop} mode=${afterSecondFlip.mode}`,
  );

  // 5. Hand it back: `system` follows the desktop again, as it did on launch.
  await evaluate(`window.wikiRunCommand("theme-system")`);
  await settle(100);
  const afterSystem = await read();
  report.check(
    "handing the choice back to the desktop takes effect at once",
    afterSystem.mode === back,
    `desktop=${afterSystem.desktop} mode=${afterSystem.mode}, expected ${back}`,
  );
  const menuAfterSystem = await readWithMenuOpen();
  report.check(
    "the menu checks `Match the system` again",
    menuAfterSystem.checkedLabel === PREFERENCE_LABEL.system,
    `checked in the open menu=${JSON.stringify(menuAfterSystem.checkedLabel)}`,
  );

  return true;
}

/**
 * Deliberately not top-level await: this module has to finish evaluating before
 * the runtime loads the served document into the window, and awaiting here
 * blocks that — the webview never navigates and the backend exits.
 */
async function drive(): Promise<void> {
  const report = newReport();
  console.log(
    `appearance check: ${CASES.length} cases, served by pageForTheme, read from the desktop webview`,
  );

  for (const [index, c] of CASES.entries()) {
    if (!await runCase(report, c, index)) break;
  }

  console.log("");
  if (report.failures === 0) {
    console.log(`every check passed (${CASES.length} cases)`);
  } else {
    console.log(`${report.failures} check(s) failed`);
  }

  win.close();
  server.shutdown();
  Deno.exit(report.failures === 0 ? 0 : 1);
}

setTimeout(drive, 400);
