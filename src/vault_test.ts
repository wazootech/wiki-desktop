import { join } from "node:path";

import {
  browseDirectory,
  createVaultFile,
  isInsideRoot,
  listVaultFiles,
  normalizeVaultPath,
  readVaultFile,
  VaultError,
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
