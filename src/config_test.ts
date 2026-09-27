import { join } from "node:path";

import {
  clampSidebarWidth,
  coerceTheme,
  configDir,
  DEFAULT_CONFIG,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_THEME,
  homeDirectory,
  LIST_VIEW_DEFAULTS,
  type ListViewKey,
  listViewValue,
  loadConfig,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  updateConfig,
  withRecentVault,
} from "./config.ts";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

Deno.test("homeDirectory uses the variable this platform actually sets", () => {
  const previous = {
    home: Deno.env.get("HOME"),
    profile: Deno.env.get("USERPROFILE"),
  };
  Deno.env.set("HOME", "/posix-home");
  Deno.env.set("USERPROFILE", "/windows-home");
  try {
    // Windows must not pick up MSYS paths like /c/Users/name that Git Bash
    // puts in HOME.
    const expected = Deno.build.os === "windows"
      ? "/windows-home"
      : "/posix-home";
    assertEqual(homeDirectory(), expected, "home directory");
  } finally {
    if (previous.home === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", previous.home);
    if (previous.profile === undefined) Deno.env.delete("USERPROFILE");
    else Deno.env.set("USERPROFILE", previous.profile);
  }
});

Deno.test("clampSidebarWidth keeps a stored width inside the layout's range", () => {
  // The stored value outlives the window that produced it, so every read path
  // has to survive a hand-edited config: a width of 5 or 5000 would otherwise
  // hide either the file list or the editor on the next launch.
  assertEqual(clampSidebarWidth(300), 300, "a width in range is kept");
  assertEqual(clampSidebarWidth(5), SIDEBAR_MIN_WIDTH, "too narrow is raised");
  assertEqual(
    clampSidebarWidth(5000),
    SIDEBAR_MAX_WIDTH,
    "too wide is lowered",
  );
  assertEqual(clampSidebarWidth(299.6), 300, "a dragged width is rounded");
  assertEqual(
    clampSidebarWidth(Number.NaN),
    DEFAULT_SIDEBAR_WIDTH,
    "a missing or corrupt width falls back to the default",
  );
});

Deno.test("coerceTheme only ever yields a preference the page can apply", () => {
  // The stored value outlives the window that wrote it, and this one is baked
  // into the document before its first paint: an unrecognised value has to mean
  // "follow the OS" rather than an attribute the stylesheet cannot match.
  assertEqual(DEFAULT_THEME, "system", "the OS is the default appearance");
  assertEqual(DEFAULT_CONFIG.theme, "system", "a fresh config follows the OS");
  for (const preference of ["system", "light", "dark"] as const) {
    assertEqual(coerceTheme(preference), preference, `${preference} is kept`);
  }
  assertEqual(coerceTheme("DARK"), "system", "case matters");
  assertEqual(coerceTheme("auto"), "system", "an unknown word falls back");
  assertEqual(coerceTheme(""), "system", "an empty string falls back");
  assertEqual(coerceTheme(null), "system", "a missing value falls back");
  assertEqual(coerceTheme(42), "system", "a number falls back");
  assertEqual(
    coerceTheme({ theme: "dark" }),
    "system",
    "an object falls back rather than being read as its contents",
  );
});

Deno.test("withRecentVault keeps the newest vault first and deduplicates", () => {
  assertEqual(
    withRecentVault(["/a", "/b"], "/c").join(", "),
    "/c, /a, /b",
    "a new vault goes first",
  );
  assertEqual(
    withRecentVault(["/a", "/b"], "/b").join(", "),
    "/b, /a",
    "re-opening a vault moves it to the front",
  );
  const many = Array.from({ length: 20 }, (_, index) => `/${index}`);
  assertEqual(withRecentVault(many, "/new").length, 8, "the list is capped");
});

/**
 * Run `body` with the settings folder inside a scratch directory.
 *
 * The config lives in the real home directory, so a test that wrote there
 * would change the preferences of whoever is running it.
 */
async function withScratchHome(
  body: (home: string) => Promise<void>,
): Promise<void> {
  const home = await Deno.makeTempDir();
  const previous = {
    home: Deno.env.get("HOME"),
    profile: Deno.env.get("USERPROFILE"),
  };
  Deno.env.set("HOME", home);
  Deno.env.set("USERPROFILE", home);
  try {
    await body(home);
  } finally {
    if (previous.home === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", previous.home);
    if (previous.profile === undefined) Deno.env.delete("USERPROFILE");
    else Deno.env.set("USERPROFILE", previous.profile);
    await Deno.remove(home, { recursive: true }).catch(() => {});
  }
}

/** Write the settings file directly, standing in for the other process. */
async function writeConfigFile(home: string, value: unknown): Promise<void> {
  await Deno.mkdir(join(home, ".wazoo-wiki"), { recursive: true });
  await Deno.writeTextFile(
    join(home, ".wazoo-wiki", "config.json"),
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

Deno.test("loadConfig reads what is on disk, not a snapshot from startup", async () => {
  // The desktop window and the dev server are separate processes. A cached
  // config is what let one of them write back settings the other had changed.
  await withScratchHome(async (home) => {
    await writeConfigFile(home, { theme: "dark", sidebarWidth: 400 });
    const config = await loadConfig();
    assertEqual(config.theme, "dark", "a change made behind our back is seen");
    assertEqual(config.sidebarWidth, 400, "and so is the width beside it");
  });
});

Deno.test("updateConfig keeps a setting another process just stored", async () => {
  await withScratchHome(async (home) => {
    // The pair that actually collided: the desktop app resizing its window
    // while the browser changes the appearance. Each patches a different field.
    await writeConfigFile(home, { sidebarWidth: 400, theme: "dark" });
    const next = await updateConfig({ sidebarWidth: 300 });
    assertEqual(next.sidebarWidth, 300, "the patch is applied");
    assertEqual(next.theme, "dark", "the other process's theme survives");
  });
});

Deno.test("overlapping updates in one process do not lose each other", async () => {
  await withScratchHome(async () => {
    // Both start before either has written, which used to collapse to
    // whichever call finished last.
    const [first, second] = await Promise.all([
      updateConfig({ sidebarWidth: 321 }),
      updateConfig({ theme: "dark" }),
    ]);
    assertEqual(first.sidebarWidth, 321, "the first patch applied");
    assertEqual(second.theme, "dark", "the second patch applied");
    const stored = await loadConfig();
    assertEqual(stored.sidebarWidth, 321, "and the width reached the file");
    assertEqual(stored.theme, "dark", "and so did the theme");
  });
});

Deno.test("every list switch is stored, and one rule reads it back", async () => {
  // One test for all three, because they are one setting in kind: a checkbox
  // beside the file list, an item in the Appearance menu, and a boolean that
  // survives a restart. Assets used to be the odd one out — per-session while
  // its two neighbours persisted — and the way that happened is three copies
  // of this same assertion, each forgetting that the other two existed.
  //
  // The rule has to be one rule, and it is: a stored boolean is believed,
  // anything else falls back to that switch's own default. That covers both
  // polarities at once, so "only an explicit false turns this off" and "only
  // an explicit true turns that on" are the same sentence with a different
  // default, and a config written before a switch existed cannot change what
  // the list looks like.
  const keys = Object.keys(LIST_VIEW_DEFAULTS) as ListViewKey[];
  assertEqual(keys.length, 3, "the toolbar's three switches are all declared");

  for (const key of keys) {
    const fallback = LIST_VIEW_DEFAULTS[key];
    await withScratchHome(async (home) => {
      assertEqual(
        (await loadConfig())[key],
        fallback,
        `a fresh config leaves ${key} at its default`,
      );
      // A config written before this switch existed has no key for it at all.
      await writeConfigFile(home, { sidebarWidth: 400 });
      assertEqual(
        (await loadConfig())[key],
        fallback,
        `a config that never heard of ${key} still gets the default`,
      );
      // An explicit boolean is the user's own decision and is honoured either
      // way round, which is the part a single-polarity rule gets wrong.
      await writeConfigFile(home, { [key]: !fallback });
      assertEqual(
        (await loadConfig())[key],
        !fallback,
        `an explicit ${!fallback} for ${key} is honoured`,
      );
      await writeConfigFile(home, { [key]: fallback });
      assertEqual(
        (await loadConfig())[key],
        fallback,
        `and so is an explicit ${fallback}`,
      );
      // A value that is not a boolean is not a decision. Reading "no" as false
      // would let a hand-edited file reflow the list nobody asked to change.
      for (const rubbish of ["no", 0, 1, null, [], {}]) {
        await writeConfigFile(home, { [key]: rubbish });
        assertEqual(
          (await loadConfig())[key],
          fallback,
          `${JSON.stringify(rubbish)} for ${key} is ignored, not obeyed`,
        );
      }
    });
  }
});

Deno.test("one function decides a switch's value, for both directions", () => {
  // The reader of a stored config and the writer of a stored value ask the
  // same question, so they call the same function: a value written through the
  // bindings and read back has to come out as it went in, and the only way to
  // be sure is for there to be one implementation of the rule.
  for (const key of Object.keys(LIST_VIEW_DEFAULTS) as ListViewKey[]) {
    const fallback = LIST_VIEW_DEFAULTS[key];
    assertEqual(listViewValue(key, true), true, `${key} believes a true`);
    assertEqual(listViewValue(key, false), false, `${key} believes a false`);
    assertEqual(
      listViewValue(key, undefined),
      fallback,
      `${key} falls back when nothing was stored`,
    );
    assertEqual(
      listViewValue(key, "true"),
      fallback,
      `${key} ignores a string that looks like one`,
    );
  }
});

Deno.test("a stored write leaves no scratch file behind", async () => {
  await withScratchHome(async () => {
    await updateConfig({ sidebarWidth: 300 });
    const names: string[] = [];
    for await (const entry of Deno.readDir(configDir())) names.push(entry.name);
    assertEqual(
      names.join(","),
      "config.json",
      "the scratch file is renamed away, not left for the next write",
    );
  });
});

Deno.test("a missing or corrupt settings file still yields the defaults", async () => {
  // The app has to start on a bad config, and it now reads the file more often
  // than it used to, so the fallback is on the hot path.
  await withScratchHome(async (home) => {
    assertEqual(
      (await loadConfig()).theme,
      "system",
      "a missing file is the default appearance",
    );
    await writeConfigFile(home, "{not json at all");
    const config = await loadConfig();
    assertEqual(config.theme, "system", "a corrupt file is the default too");
    assertEqual(
      config.sidebarWidth,
      DEFAULT_SIDEBAR_WIDTH,
      "and the default width",
    );
  });
});
