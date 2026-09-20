import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  homeDirectory,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
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
