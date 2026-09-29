import { join } from "node:path";

import {
  activityByDay,
  browseDirectory,
  createVaultFile,
  detectNewlineStyle,
  isInsideRoot,
  listVaultFiles,
  MAX_SEARCH_MATCHES,
  normalizeVaultPath,
  readVaultFile,
  searchVaultFiles,
  toEditorText,
  VaultError,
  VaultFile,
  writeVaultFile,
} from "./vault.ts";

/** Dependency-free assertions, so the tests run without fetching anything. */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function assertThrows(fn: () => unknown, message: string) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error(`${message}: expected the call to throw`);
}

async function withTempVault(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "wazoo-wiki-test-" });
  try {
    await run(root);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

/**
 * The app's core promise: what you did not touch, it does not rewrite.
 *
 * A document model can only hold one line ending — a `<textarea>` normalizes
 * on assignment and so does CodeMirror's document — so the file's own
 * convention is preserved here, at the boundary, in both directions.
 */
Deno.test("reading and writing a file leaves every byte it did not change", async () => {
  const cases = [
    { name: "LF", newline: "\n", body: "# Title\n\nBody line.\n" },
    { name: "CRLF", newline: "\r\n", body: "# Title\r\n\r\nBody line.\r\n" },
    { name: "classic CR", newline: "\r", body: "# Title\r\rBody line.\r" },
    // A BOM is the front matter's invisible neighbour: it is the first thing
    // the YAML parser sees, and an editor that drops it rewrites page one of
    // every file it opens. Neither editor can hold one either — the reading is
    // done with a text decoder that keeps it as a character.
    {
      name: "BOM + CRLF",
      newline: "\r\n",
      body: "\uFEFF# Title\r\n\r\nBody line.\r\n",
    },
  ] as const;

  await withTempVault(async (root) => {
    for (const testCase of cases) {
      await Deno.writeTextFile(join(root, "page.md"), testCase.body);

      const read = await readVaultFile(root, "page.md");
      assertEqual(
        read.newline,
        testCase.newline,
        `${testCase.name}: the file's own line ending is reported`,
      );
      assertEqual(
        read.content.includes("\r"),
        false,
        `${testCase.name}: the editor is handed LF only`,
      );

      // Saving without editing must reproduce the original bytes exactly.
      const saved = await writeVaultFile(root, "page.md", read.content);
      assertEqual(
        await Deno.readTextFile(join(root, "page.md")),
        testCase.body,
        `${testCase.name}: an untouched save is byte-identical`,
      );
      // The page marks its buffer clean against what a save returns, so that
      // has to stay the document text: handing back the disk bytes instead
      // would leave a CRLF file reading as dirty the moment it was typed in.
      assertEqual(
        saved.content,
        read.content,
        `${testCase.name}: a save echoes the document, not the disk bytes`,
      );
      assertEqual(
        saved.newline,
        testCase.newline,
        `${testCase.name}: a save reports the ending it wrote`,
      );

      // An edit changes the edited line and nothing else — in particular it
      // does not convert the whole file's line endings.
      const edited = read.content.replace("Body line.", "Edited body line.");
      await writeVaultFile(root, "page.md", edited);
      assertEqual(
        await Deno.readTextFile(join(root, "page.md")),
        testCase.body.replace("Body line.", "Edited body line."),
        `${testCase.name}: an edit keeps the file's line endings`,
      );
    }
  });
});

Deno.test("a new file takes the app's own line ending", async () => {
  await withTempVault(async (root) => {
    const created = await createVaultFile(root, "fresh.md", "one\ntwo\n");
    assertEqual(created.newline, "\n", "a created file reports LF");
    assertEqual(
      await Deno.readTextFile(join(root, "fresh.md")),
      "one\ntwo\n",
      "a created file is written with LF",
    );
  });
});

Deno.test("detectNewlineStyle picks the ending a file actually uses", () => {
  assertEqual(detectNewlineStyle("a\nb\n"), "\n", "LF");
  assertEqual(detectNewlineStyle("a\r\nb\r\n"), "\r\n", "CRLF");
  assertEqual(detectNewlineStyle("a\rb\r"), "\r", "classic CR");
  assertEqual(detectNewlineStyle("single line"), "\n", "no breaks at all");
  assertEqual(
    detectNewlineStyle("a\r\nb\nc\nd\r\n"),
    "\r\n",
    "a mixed file follows its dominant ending",
  );
  assertEqual(
    toEditorText("a\r\nb\rc\nd"),
    "a\nb\nc\nd",
    "every convention normalizes to LF for the editor",
  );
});

Deno.test("normalizeVaultPath accepts nested vault-relative paths", () => {
  assertEqual(normalizeVaultPath("notes/today.md"), "notes/today.md", "plain");
  assertEqual(normalizeVaultPath("./notes/a.md"), "notes/a.md", "dot segment");
  assertEqual(
    normalizeVaultPath("notes\\a.md"),
    "notes/a.md",
    "windows separators",
  );
  assertEqual(normalizeVaultPath("  a.md  "), "a.md", "surrounding space");
});

Deno.test("normalizeVaultPath rejects anything that could escape", () => {
  for (
    const input of ["../secret.md", "notes/../../secret.md", "/etc/passwd"]
  ) {
    const error = assertThrows(
      () => normalizeVaultPath(input),
      `expected ${input} to be rejected`,
    );
    assert(error instanceof VaultError, `${input} should raise a VaultError`);
  }
  assertThrows(() => normalizeVaultPath("C:/Windows/system.ini"), "drive path");
  assertThrows(() => normalizeVaultPath(""), "empty path");
  assertThrows(() => normalizeVaultPath("a\u0000b"), "null byte");
  assertThrows(() => normalizeVaultPath("   "), "whitespace only");
});

Deno.test("isInsideRoot compares path segments, not just prefixes", () => {
  const root = Deno.build.os === "windows" ? "C:\\wiki" : "/wiki";
  const separator = Deno.build.os === "windows" ? "\\" : "/";
  assert(isInsideRoot(root, root), "root counts as inside");
  assert(isInsideRoot(root, `${root}${separator}notes.md`), "child is inside");
  assert(!isInsideRoot(root, `${root}-backup`), "sibling prefix is outside");
  assert(!isInsideRoot(root, `${root}${separator}..`), "parent is outside");
});

Deno.test("vault file operations round-trip inside the vault", async () => {
  await withTempVault(async (root) => {
    await Deno.mkdir(join(root, "notes"));
    await writeVaultFile(root, "notes/today.md", "# Today\n");
    const read = await readVaultFile(root, "notes/today.md");
    assertEqual(read.content, "# Today\n", "content round-trips");
    assertEqual(read.path, "notes/today.md", "path is vault-relative");

    await createVaultFile(root, "scratch.md", "scratch");
    const created = await readVaultFile(root, "scratch.md");
    assertEqual(created.content, "scratch", "created file is readable");

    let rejected = false;
    try {
      await createVaultFile(root, "scratch.md");
    } catch (error) {
      rejected = error instanceof VaultError;
    }
    assert(rejected, "creating an existing file raises a VaultError");
  });
});

Deno.test("vault file operations refuse to touch files outside the vault", async () => {
  await withTempVault(async (root) => {
    const outside = join(root, "..", "wazoo-wiki-outside.md");
    let rejected = false;
    try {
      await writeVaultFile(root, "../wazoo-wiki-outside.md", "nope");
    } catch (error) {
      rejected = error instanceof VaultError;
    }
    assert(rejected, "writing outside the vault is rejected");
    assertEqual(
      await Deno.stat(outside).then(() => "exists").catch(() => "missing"),
      "missing",
      "no file was written outside the vault",
    );
  });
});

Deno.test("listVaultFiles sorts Markdown first and skips ignored folders", async () => {
  await withTempVault(async (root) => {
    await Deno.mkdir(join(root, "notes"));
    await Deno.mkdir(join(root, ".git"));
    await Deno.writeTextFile(join(root, "zeta.md"), "z");
    await Deno.writeTextFile(join(root, "alpha.txt"), "a");
    await Deno.writeTextFile(join(root, "notes", "beta.md"), "b");
    await Deno.writeTextFile(join(root, ".git", "config"), "ignored");
    await Deno.writeTextFile(join(root, ".hidden.md"), "ignored");

    const paths = (await listVaultFiles(root)).map((file) => file.path);
    assertEqual(
      paths.join(", "),
      "notes/beta.md, zeta.md, alpha.txt",
      "markdown first, then the rest",
    );
  });
});

Deno.test("the listing follows the vault's config instead of walking alike", async () => {
  await withTempVault(async (root) => {
    await Deno.writeTextFile(
      join(root, "wiki.yml"),
      "wiki:\n  input:\n    - wiki\n  assets:\n    - assets\n  exclude:\n    - drafts/**\n",
    );
    for (const folder of ["wiki", "assets/_images", "drafts"]) {
      await Deno.mkdir(join(root, folder), { recursive: true });
    }
    await Deno.writeTextFile(join(root, "wiki", "CSS.md"), "# CSS\n");
    await Deno.writeTextFile(join(root, "wiki", "notes.txt"), "n");
    await Deno.writeTextFile(join(root, "assets", "style.css"), "c");
    await Deno.writeTextFile(join(root, "assets", "_images", "logo.png"), "p");
    await Deno.writeTextFile(join(root, "drafts", "wip.md"), "w");
    await Deno.writeTextFile(join(root, "README.md"), "r");

    const files = await listVaultFiles(root);
    assertEqual(
      files.map((file) => file.path).join(", "),
      "wiki/CSS.md, wiki/notes.txt, README.md, wiki.yml, " +
        "assets/_images/logo.png, assets/style.css",
      "the wiki's pages, then the vault's other files, then its static files",
    );
    assertEqual(
      files.map((file) => file.scope).join(", "),
      "input, input, other, other, asset, asset",
      "each file carries what the vault calls it",
    );
    assert(
      !files.some((file) => file.path.startsWith("drafts/")),
      "an excluded folder is not listed",
    );
    assert(
      files.some((file) => file.path === "wiki.yml"),
      "the config is a file in the vault like any other",
    );
  });
});

Deno.test("a vault whose config cannot be read lists everything, as before", async () => {
  await withTempVault(async (root) => {
    await Deno.writeTextFile(join(root, "wiki.yml"), "wiki: [unclosed\n");
    await Deno.mkdir(join(root, "wiki"));
    await Deno.mkdir(join(root, "assets"));
    await Deno.writeTextFile(join(root, "wiki", "CSS.md"), "# CSS\n");
    await Deno.writeTextFile(join(root, "assets", "style.css"), "c");

    const files = await listVaultFiles(root);
    assertEqual(
      files.map((file) => file.path).join(", "),
      "wiki/CSS.md, assets/style.css, wiki.yml",
      "Markdown first, then by path: no config means no reordering either",
    );
    assertEqual(
      files.map((file) => file.scope).join(", "),
      "other, other, other",
      "and no file is called a page",
    );
  });
});

Deno.test("browseDirectory lists folders and spots a wiki", async () => {
  await withTempVault(async (root) => {
    const parent = join(root, "..");
    await Deno.mkdir(join(root, "notes"));
    await Deno.mkdir(join(root, ".hidden"));
    await Deno.writeTextFile(join(root, "wiki.yaml"), "wiki: {}\n");

    const listing = await browseDirectory(root);
    assertEqual(
      listing.entries.map((entry) => entry.name).join(", "),
      "notes",
      "folders only",
    );
    assert(listing.looksLikeWiki, "a wiki.yaml marks the folder as a wiki");
    assertEqual(listing.parent, parent, "parent is the containing folder");

    const withoutWiki = await browseDirectory(join(root, "notes"));
    assert(!withoutWiki.looksLikeWiki, "an empty folder is not a wiki");
    assert(withoutWiki.shortcuts.length > 0, "shortcuts are offered");
  });
});

Deno.test("the listing says when each file was written", async () => {
  // Recently changed is a sort of the listing, and the only reason it can be
  // is that the walk records the time. A vault where every entry reads the same
  // instant would put the view's own files in an arbitrary order, so the check
  // is that the two files really do come back in the order they were written.
  await withTempVault(async (root) => {
    await Deno.writeTextFile(join(root, "old.md"), "old\n");
    // A filesystem clock is coarse and can report a tick the wall clock has not
    // reached, so the band is generous and the ordering is what is being
    // checked. Two writes in the same millisecond would be indistinguishable,
    // so a gap makes the order a fact rather than a hope.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await Deno.writeTextFile(join(root, "new.md"), "new\n");
    const now = Date.now();

    const files = await listVaultFiles(root);
    const times = files.map((file) => file.modified);
    assert(
      times.every((stamp) => stamp > 0 && Math.abs(stamp - now) < 60_000),
      `every modification time is a real, recent one: ${times.join(", ")}`,
    );
    const byAge = files.slice().sort((left, right) =>
      right.modified - left.modified
    );
    assertEqual(
      byAge.map((file) => file.name).join(", "),
      "new.md, old.md",
      "newest first",
    );
  });
});

Deno.test("searchVaultFiles finds a word in a page and says which line", async () => {
  await withTempVault(async (root) => {
    await Deno.writeTextFile(
      join(root, "RDF.md"),
      "# RDF\n\nA graph is a set of triples.\n\nNothing here mentions a turtle.\n",
    );
    await Deno.writeTextFile(join(root, "Turtle.md"), "Turtle is shorter.\n");

    const hits = await searchVaultFiles(root, "turtle");
    assertEqual(
      hits.map((hit) => hit.path).join(", "),
      "RDF.md, Turtle.md",
      "every file with a match, in the listing's own order",
    );
    assertEqual(
      hits[0].matches.map((match) => match.line).join(", "),
      "5",
      "a 1-based line, the one the editor counts",
    );
    assertEqual(
      hits[0].matches[0].text,
      "Nothing here mentions a turtle.",
      "the line itself comes back, trimmed",
    );
    assert(!hits[0].truncated, "and nothing is claimed to be missing");

    assertEqual(
      hits[1].matches.length,
      1,
      "the second file has one match",
    );
    assertEqual(
      (await searchVaultFiles(root, "  turtle  "))[0].path,
      "RDF.md",
      "a query's surrounding spaces are not part of the search",
    );
    assertEqual(
      (await searchVaultFiles(root, "TURTLE"))[0].path,
      "RDF.md",
      "matching ignores case, like the file list's own filter",
    );
  });
});

Deno.test("searchVaultFiles reports the line numbers the editor will show", async () => {
  // The result is a line number and a click puts the caret on it, so a CRLF
  // file that counted its own \r would be off by one line for the second line
  // onward — the exact failure a page saved on Windows would hit.
  await withTempVault(async (root) => {
    await Deno.writeTextFile(
      join(root, "windows.md"),
      "# Title\r\n\r\nThe needle is here.\r\n",
    );
    const [hit] = await searchVaultFiles(root, "needle");
    assertEqual(
      hit.matches.map((match) => match.line).join(", "),
      "3",
      "the line is the one the editor counts",
    );
  });
});

Deno.test("searchVaultFiles searches text and skips what is not", async () => {
  await withTempVault(async (root) => {
    // A NUL byte in the opening bytes is what every other tool reads as binary,
    // and a picture in a wiki is the case that would otherwise fill the results
    // with lines of mojibake.
    await Deno.writeFile(
      join(root, "logo.png"),
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    await Deno.writeTextFile(join(root, "config.yml"), "needle: true\n");
    // Bigger than the editor will open, so there is no way to show a match in
    // it either.
    await Deno.writeTextFile(
      join(root, "huge.txt"),
      "needle\n".repeat(2 * 1024 * 1024 / 7 + 1),
    );
    await Deno.writeTextFile(join(root, "page.md"), "nothing to see\n");

    const hits = await searchVaultFiles(root, "needle");
    assertEqual(
      hits.map((hit) => hit.path).join(", "),
      "config.yml",
      "a vault's own config is text and is searched; its pictures are not",
    );
  });
});

Deno.test("searchVaultFiles says when it stopped short", async () => {
  await withTempVault(async (root) => {
    const body = "needle\n".repeat(MAX_SEARCH_MATCHES + 5);
    await Deno.writeTextFile(join(root, "many.md"), body);
    await Deno.writeTextFile(join(root, "two.md"), "needle\n");
    await Deno.writeTextFile(join(root, "one.md"), "needle\n");

    const [many] = await searchVaultFiles(root, "needle");
    assertEqual(
      many.matches.length,
      MAX_SEARCH_MATCHES,
      "a file reports at most the cap",
    );
    assert(
      many.truncated,
      "and says so, so the view can say 'more' rather than imply otherwise",
    );

    // A file whose matches exactly fill the cap is not truncated: the flag
    // would otherwise be a lie for every file but the one that overflowed.
    const exactly = await searchVaultFiles(root, "needle", {
      maxMatchesPerFile: 1,
    });
    assertEqual(
      exactly.filter((hit) => hit.truncated).map((hit) => hit.path).join(", "),
      "many.md",
      "only the file that actually has more matches says so",
    );

    const capped = await searchVaultFiles(root, "needle", { maxFiles: 1 });
    assertEqual(
      capped.length,
      1,
      "the file cap is a cap, not a suggestion",
    );
  });
});

Deno.test("a search over a vault that is not there is the caller's problem", async () => {
  // The binding guards the root, so this is the shape of a vault that was
  // closed between the listing and the scan rather than a page's mistake.
  await withTempVault(async (root) => {
    let thrown: unknown = null;
    try {
      await searchVaultFiles(join(root, "gone"), "needle");
    } catch (error) {
      thrown = error;
    }
    assert(
      thrown instanceof VaultError,
      "a missing vault fails as a vault error",
    );
  });
});

Deno.test("activityByDay files the listing under the day each file was written", () => {
  // The panel's second pane is a history, and the only history a wiki reader
  // has is when each file was last written: a day is a bucket, not a commit.
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 8, day, hour, minute).getTime();
  const days = activityByDay([
    file("oldest.md", at(10, 9)),
    file("today-second.md", at(12, 16)),
    file("yesterday-night.md", at(11, 23, 59)),
    file("today-first.md", at(12, 8)),
  ]);

  assertEqual(
    days.map((day) => day.files.map((entry) => entry.path)).flat().join(", "),
    "today-second.md, today-first.md, yesterday-night.md, oldest.md",
    "the newest write leads, days and files within them alike",
  );
  assertEqual(
    days.length,
    3,
    "three writes on three days are three days of history",
  );
  assertEqual(
    new Date(days[0].day).getHours(),
    0,
    "a day is bucketed at its local midnight, so Today is a whole day",
  );
});

Deno.test("activityByDay keeps a file with no date out of the history", () => {
  // A filesystem that will not say when is still a file in the listing, but it
  // has no day to file it under, and inventing one would put it on a day it
  // was never written.
  const days = activityByDay([
    { ...file("undated.md", 0), modified: 0 },
    file("dated.md", new Date(2026, 8, 12, 10).getTime()),
  ]);

  assertEqual(
    days.flatMap((day) => day.files.map((entry) => entry.path)).join(", "),
    "dated.md",
    "only the file that knows its own day is in the history",
  );
});

Deno.test("activityByDay over an empty listing is an empty history", () => {
  assertEqual(activityByDay([]).length, 0, "no files, no days");
});

Deno.test("activityByDay splits a day at local midnight, not at 24 hours", () => {
  // The bug this rules out: bucketing on the raw timestamp, or dividing by
  // 86400000, which files 23:59 and the next 00:01 under the same day whenever
  // the clocks are not UTC -- a history that claims two nights were one.
  const lateNight = new Date(2026, 8, 12, 23, 59, 30).getTime();
  const smallHours = new Date(2026, 8, 13, 0, 1, 30).getTime();
  const days = activityByDay([
    file("late.md", lateNight),
    file("early.md", smallHours),
  ]);

  assertEqual(days.length, 2, "two minutes apart is still two days apart");
  assertEqual(
    days[1].files[0].path,
    "late.md",
    "and the earlier write is the earlier day",
  );
});

/** A listed file, with only the fields the history reads. */
function file(path: string, modified: number): VaultFile {
  return {
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    isMarkdown: true,
    scope: "input",
    modified,
  };
}
