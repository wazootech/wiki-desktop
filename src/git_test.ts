/**
 * Tests for the one module that shells out to git.
 *
 * These run against real repositories in temporary directories rather than
 * against a recording of git's output, because the whole risk in this module
 * is in the formats: which of git's status codes mean what, which of its paths
 * come back relative to the repository rather than the vault, and what a
 * pathspec commit does to the index. A hand-written fixture of git's output
 * would only be a guess about those, and a guess that happens to match is the
 * failure mode this file exists to prevent.
 *
 * Every repository is created with an author and a committer configured
 * locally, because a commit needs both and a machine without them would fail
 * every test here for a reason that has nothing to do with the code.
 */
import {
  amendFiles,
  commitFiles,
  GitError,
  gitStatus,
  MAX_GIT_CHANGES,
  pushBranch,
} from "./git.ts";

const DECODER = new TextDecoder();

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

/** A temporary directory that cleans itself up, and the git identity to use. */
async function scratch(): Promise<{
  path: string;
  git: (args: string[], cwd?: string) => string;
}> {
  const path = await Deno.makeTempDir({ prefix: "wazoo-wiki-git-" });
  // Set on every invocation rather than once per repository: a repository
  // created by an inner call has to be told too, and `git -c` is the only way
  // to do that without a global config write.
  const run = (args: string[], cwd = path) => {
    const result = new Deno.Command("git", {
      args: [
        "-c",
        "user.name=Wiki Test",
        "-c",
        "user.email=test@wazoo.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      cwd,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    if (result.code !== 0) {
      throw new Error(
        `git ${args.join(" ")} failed: ${DECODER.decode(result.stderr)}`,
      );
    }
    return DECODER.decode(result.stdout);
  };
  run(["init", "--quiet"]);
  run(["config", "user.name", "Wiki Test"]);
  run(["config", "user.email", "test@wazoo.invalid"]);
  return { path, git: run };
}

/**
 * A bare repository to push at, wired up as `origin` and no further.
 *
 * Bare because that is what a remote is, and because a working tree would let
 * a test pass for the wrong reason: a push into a non-bare repository can be
 * rejected by a checked-out branch, which is a different failure from the one
 * these tests are about. The upstream is deliberately *not* set, so a test has
 * to ask for one — which is the difference between "the branch has nowhere to
 * go" and "the branch knows where to go".
 */
async function withOrigin(
  git: (args: string[], cwd?: string) => string,
  cwd: string,
): Promise<string> {
  const remote = await Deno.makeTempDir({ prefix: "wazoo-wiki-remote-" });
  const result = await new Deno.Command("git", {
    args: ["init", "--quiet", "--bare", remote],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (result.code !== 0) {
    throw new Error(`git init --bare failed: ${DECODER.decode(result.stderr)}`);
  }
  git(["remote", "add", "origin", remote], cwd);
  return remote;
}

/**
 * A second machine, cloned from the bare remote, with its own identity.
 *
 * A clone rather than a second `git init` because what these tests need is a
 * repository that has the remote's commits and its own on top — the exact state
 * a pull is what fixes, and the state in which a push is refused.
 */
async function clonedFrom(remote: string): Promise<{
  path: string;
  git: (args: string[]) => string;
}> {
  const path = await Deno.makeTempDir({ prefix: "wazoo-wiki-clone-" });
  const run = (args: string[]) => {
    const result = new Deno.Command("git", {
      args,
      cwd: path,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    if (result.code !== 0) {
      throw new Error(
        `git ${args.join(" ")} failed: ${DECODER.decode(result.stderr)}`,
      );
    }
    return DECODER.decode(result.stdout);
  };
  run(["clone", "--quiet", remote, "."]);
  run(["config", "user.name", "Someone Else"]);
  run(["config", "user.email", "else@wazoo.invalid"]);
  return { path, git: run };
}

/** A file the app would be able to read, written with LF and nothing else. */
async function write(root: string, path: string, text: string) {
  const full = `${root}/${path}`;
  await Deno.mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(full, text);
}

Deno.test("a folder that is not a repository has no status, and says so", async () => {
  const plain = await Deno.makeTempDir({ prefix: "wazoo-wiki-plain-" });
  try {
    assertEqual(
      await gitStatus(plain),
      null,
      "a vault outside any repository is null, not an empty list",
    );
  } finally {
    await Deno.remove(plain, { recursive: true });
  }
});

Deno.test("status reads the codes git wrote, as vault-relative paths", async () => {
  const { path, git } = await scratch();
  try {
    // The vault is a subfolder of the repository, which is the normal case for
    // a wiki: the repository reaches above it and the paths git reports have to
    // come back relative to the vault, not to the root.
    await write(path, "docs/wiki/one.md", "one\n");
    await write(path, "docs/wiki/two.md", "two\n");
    await write(path, "README.md", "outside the vault\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "first"]);
    await write(path, "docs/wiki/one.md", "one, edited\n");
    await write(path, "docs/wiki/three.md", "three\n");

    const status = await gitStatus(`${path}/docs`);
    assert(status !== null, "the vault is inside the repository");
    assertEqual(status.root, path.replace(/\\/g, "/"), "the root is found");
    const byPath = new Map(status.changes.map((c) => [c.path, c]));
    assertEqual(byPath.get("wiki/one.md")?.status, " M", "an edit is unstaged");
    assertEqual(
      byPath.get("wiki/three.md")?.status,
      "??",
      "a file git has never seen is untracked",
    );
    assert(
      !byPath.has("README.md"),
      "a change above the vault is not this pane's business",
    );
    assertEqual(
      byPath.get("wiki/one.md")?.staged,
      false,
      "an edit on disk is not staged",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("a staged change is reported as staged", async () => {
  const { path, git } = await scratch();
  try {
    await write(path, "docs/one.md", "one\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "first"]);
    await write(path, "docs/one.md", "edited\n");
    await write(path, "docs/two.md", "two\n");
    git(["add", "docs/two.md"]);

    const status = await gitStatus(`${path}/docs`);
    const byPath = new Map(status!.changes.map((c) => [c.path, c]));
    assertEqual(byPath.get("two.md")?.status, "A ", "an added file is A");
    assertEqual(byPath.get("two.md")?.staged, true, "and it is staged");
    assertEqual(byPath.get("one.md")?.staged, false, "the edit is not");
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("a file name a shell would read as a command survives the round trip", async () => {
  // In a wiki these are ordinary names, not an attack, and they are exactly
  // what git's own quoting is there to protect. Parsing the unquoted `-z` form
  // is the only way they arrive intact. A quote or a newline in the name would
  // be the strongest cases of all, but Windows will not create a file with
  // either in its name, so these are the sharpest this filesystem allows —
  // and they mean the same thing: a name that would be a second command to
  // anything that handed it to a shell.
  const { path } = await scratch();
  try {
    const names = [
      "two words.md",
      "a ; rm -rf .md",
      "unicode éè.md",
      "a $HOME & `whoami`.md",
    ];
    for (const name of names) await write(path, `docs/${name}`, "x\n");
    const status = await gitStatus(`${path}/docs`);
    const found = new Set(status!.changes.map((c) => c.path));
    for (const name of names) {
      assert(found.has(name), `"${name}" came back whole and in one piece`);
    }
    assertEqual(
      status!.total,
      names.length,
      "and none of them was split into two records",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("a rename is one change, not two files to tick", async () => {
  const { path, git } = await scratch();
  try {
    await write(path, "docs/old name.md", "x\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "first"]);
    git(["mv", "docs/old name.md", "docs/new name.md"]);

    const status = await gitStatus(`${path}/docs`);
    assertEqual(status!.total, 1, "a rename is one change");
    assertEqual(
      status!.changes[0].path,
      "new name.md",
      "and it is filed under the name the vault now has",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("a status longer than the cap says how much it is not showing", async () => {
  const { path } = await scratch();
  try {
    const many = MAX_GIT_CHANGES + 5;
    const batch: string[] = [];
    for (let index = 0; index < many; index += 1) {
      batch.push(`docs/page-${index}.md`);
    }
    await Promise.all(batch.map((name) => write(path, name, "x\n")));

    const status = await gitStatus(`${path}/docs`);
    assertEqual(
      status!.changes.length,
      MAX_GIT_CHANGES,
      "the list is capped so the pane still draws",
    );
    assertEqual(
      status!.total,
      many,
      "and the real count comes with it, because a short list that says 500 of 500 is a lie",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("committing takes the files that were named, and only those", async () => {
  const { path, git } = await scratch();
  try {
    await write(path, "docs/one.md", "one\n");
    await write(path, "docs/two.md", "two\n");
    await write(path, "docs/three.md", "three\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "first"]);

    await write(path, "docs/one.md", "one, edited\n");
    await write(path, "docs/two.md", "two, edited\n");
    await write(path, "docs/three.md", "three, edited\n");
    // Something else is staged on purpose: a commit from this pane must not be
    // able to sweep it up, because the reader did not tick it.
    git(["add", "docs/three.md"]);

    const result = await commitFiles(`${path}/docs`, "the first two", [
      "one.md",
      "two.md",
    ]);
    assertEqual(result.committed.length, 2, "two files were committed");

    const shown = git(["show", "--name-only", "--format=", "HEAD"]);
    assert(
      shown.includes("docs/one.md") && shown.includes("docs/two.md"),
      "and they are the two that were named",
    );
    assert(
      !shown.includes("docs/three.md"),
      "the staged file nobody ticked is not in the commit",
    );
    assertEqual(
      git(["status", "--porcelain"]).trim(),
      "M  docs/three.md",
      "and it is still staged afterwards, where it was left",
    );
    assert(
      result.hash.length > 0 && result.hash.length <= 12,
      "the result names the commit it made, short enough to read",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("a commit with nothing to say, or nothing ticked, is refused before git runs", async () => {
  const { path } = await scratch();
  try {
    await write(path, "docs/one.md", "one\n");
    for (
      const [message, paths, why] of [
        ["", ["one.md"], "a blank message"],
        ["   ", ["one.md"], "a message that is only spaces"],
        ["a message", [], "nothing ticked"],
      ] as const
    ) {
      let thrown: unknown;
      try {
        await commitFiles(`${path}/docs`, message, [...paths]);
      } catch (error) {
        thrown = error;
      }
      assert(thrown instanceof GitError, `${why} is refused`);
      assert(
        !/^git /i.test((thrown as GitError).message),
        `${why} is refused here rather than by git`,
      );
    }
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("a path that tries to leave the vault never reaches git", async () => {
  const { path } = await scratch();
  try {
    await write(path, "docs/one.md", "one\n");
    await write(path, "secrets.txt", "not yours\n");
    for (
      const escape of [
        "../secrets.txt",
        "/etc/passwd",
        "C:/Windows",
        "a/../../b",
      ]
    ) {
      let thrown: unknown;
      try {
        await commitFiles(`${path}/docs`, "a message", [escape]);
      } catch (error) {
        thrown = error;
      }
      assert(thrown !== undefined, `${escape} is refused`);
      assert(
        !(thrown instanceof GitError),
        `${escape} is refused by the path rule, not asked of git`,
      );
    }
    assertEqual(
      new TextDecoder().decode(
        (await new Deno.Command("git", {
          args: ["log", "--format=%s"],
          cwd: path,
          stdout: "piped",
          stderr: "piped",
        }).output()).stdout,
      ).trim(),
      "",
      "and no commit happened at all",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("a file name that would read as an option is still a file name", async () => {
  // The `--` before the pathspec is the whole of this defence, so it is
  // tested by a name that means something to git if it is ever left off.
  const { path, git } = await scratch();
  try {
    await write(path, "docs/-n.md", "x\n");
    await write(path, "docs/--amend.md", "y\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "first"]);
    await write(path, "docs/-n.md", "edited\n");
    await write(path, "docs/--amend.md", "edited\n");

    const result = await commitFiles(`${path}/docs`, "the dash files", [
      "-n.md",
      "--amend.md",
    ]);
    assertEqual(result.committed.length, 2, "both were committed");
    assertEqual(
      git(["log", "--format=%s", "-1"]).trim(),
      "the dash files",
      "and the commit is the one that was asked for, not an amended one",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("the status says where the branch stands against its remote", async () => {
  const { path, git } = await scratch();
  try {
    await write(path, "docs/one.md", "one\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "first"]);
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const remote = await withOrigin(git, path);
    try {
      git(["push", "--quiet", "--set-upstream", "origin", "HEAD"]);

      let status = (await gitStatus(`${path}/docs`))!;
      assertEqual(status.remote.branch, branch, "the branch is named");
      assertEqual(
        status.remote.upstream,
        `origin/${branch}`,
        "and the upstream it pushes to is named",
      );
      assertEqual(status.remote.ahead, 0, "a pushed branch is not ahead");
      assertEqual(status.remote.behind, 0, "nor behind");
      assertEqual(
        status.remote.published,
        true,
        "which is the same as saying the last commit is already out there",
      );

      await write(path, "docs/one.md", "one, edited\n");
      git(["commit", "--quiet", "--all", "-m", "second"]);
      status = (await gitStatus(`${path}/docs`))!;
      assertEqual(status.remote.ahead, 1, "one commit is waiting to go");
      assertEqual(
        status.remote.published,
        false,
        "and the last commit is still only ours, which is what makes an amend safe",
      );
    } finally {
      await Deno.remove(remote, { recursive: true });
    }
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("a branch with nowhere to push, and a detached HEAD, are told apart from an idle one", async () => {
  const { path, git } = await scratch();
  try {
    await write(path, "docs/one.md", "one\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "first"]);

    let status = (await gitStatus(`${path}/docs`))!;
    assert(
      status.remote.branch !== null,
      "an ordinary commit names a branch",
    );
    assertEqual(
      status.remote.upstream,
      null,
      "a branch that has never been pushed has no upstream",
    );
    assertEqual(
      status.remote.ahead,
      null,
      "and no count either, because without an upstream there is nothing to count against",
    );

    git(["checkout", "--quiet", "--detach"]);
    status = (await gitStatus(`${path}/docs`))!;
    assertEqual(
      status.remote.branch,
      null,
      "a detached HEAD has no branch, which is not the same as a branch with nothing pending",
    );
    assertEqual(
      status.remote.published,
      false,
      "and there is nothing to amend over",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("amending folds the ticked files into the last commit", async () => {
  const { path, git } = await scratch();
  try {
    await write(path, "docs/one.md", "one\n");
    await write(path, "docs/two.md", "two\n");
    await write(path, "docs/three.md", "three\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "first"]);

    await write(path, "docs/one.md", "one, edited\n");
    await write(path, "docs/two.md", "two, edited\n");
    await write(path, "docs/three.md", "three, edited\n");
    const before = git(["rev-list", "--count", "HEAD"]).trim();

    const result = await amendFiles(
      `${path}/docs`,
      "first, and the reason for it",
      [
        "one.md",
        "two.md",
      ],
    );
    assertEqual(result.committed.length, 2, "two files went into it");

    assertEqual(
      git(["log", "--format=%s", "-1"]).trim(),
      "first, and the reason for it",
      "the message is the amended one",
    );
    assertEqual(
      git(["rev-list", "--count", "HEAD"]).trim(),
      before,
      "an amend replaces a commit rather than adding one",
    );
    // The commit is checked by what is in its tree, not by what its diff names:
    // an amend's parent is the commit before it, so the diff says everything
    // the first commit added, including files this amend never touched.
    assertEqual(
      git(["show", "HEAD:docs/one.md"]),
      "one, edited\n",
      "the ticked file's edit is in it",
    );
    assertEqual(
      git(["show", "HEAD:docs/two.md"]),
      "two, edited\n",
      "and the other one",
    );
    assertEqual(
      git(["show", "HEAD:docs/three.md"]),
      "three\n",
      "while the file nobody ticked is still exactly as the last commit left it",
    );
    // trimEnd rather than trim, because git's first column is the index and a
    // leading space is the answer: an unstaged change is " M" and trimming it
    // away would turn a tidy assertion into a wrong one.
    assertEqual(
      git(["status", "--porcelain"]).trimEnd(),
      " M docs/three.md",
      "and still the only thing pending",
    );
    assert(
      result.hash.length > 0 && result.hash.length <= 12,
      "the result names the commit it left behind",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("amending a commit the remote already has is refused", async () => {
  const { path, git } = await scratch();
  try {
    await write(path, "docs/one.md", "one\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "published"]);
    const remote = await withOrigin(git, path);
    try {
      git(["push", "--quiet", "--set-upstream", "origin", "HEAD"]);
      const pushed = git(["rev-parse", "HEAD"]).trim();
      await write(path, "docs/one.md", "one, edited\n");

      let thrown: unknown;
      try {
        await amendFiles(`${path}/docs`, "a better subject", ["one.md"]);
      } catch (error) {
        thrown = error;
      }
      assert(thrown instanceof GitError, "replacing a published commit fails");
      assert(
        /already on origin\//.test((thrown as GitError).message),
        "and the sentence says what is in the way, rather than that git refused",
      );
      assertEqual(
        git(["log", "--format=%s", "-1"]).trim(),
        "published",
        "the commit is left exactly as it was, message and all",
      );
      assertEqual(
        git(["rev-parse", "HEAD"]).trim(),
        pushed,
        "and still the commit the remote has, so the two histories agree",
      );
    } finally {
      await Deno.remove(remote, { recursive: true });
    }
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("amending a commit that is not pushed yet is allowed", async () => {
  const { path, git } = await scratch();
  try {
    await write(path, "docs/one.md", "one\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "published"]);
    const remote = await withOrigin(git, path);
    try {
      git(["push", "--quiet", "--set-upstream", "origin", "HEAD"]);
      await write(path, "docs/one.md", "one, edited\n");
      git(["commit", "--quiet", "--all", "-m", "not out yet"]);

      const result = await amendFiles(
        `${path}/docs`,
        "not out yet, and here is why",
        [
          "one.md",
        ],
      );
      assert(
        result.hash !== "",
        "a commit only this machine has is ours to replace",
      );
      assertEqual(
        git(["log", "--format=%s", "-1"]).trim(),
        "not out yet, and here is why",
        "which is the point of it",
      );
    } finally {
      await Deno.remove(remote, { recursive: true });
    }
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("amending with no commit to amend says so, and so does amending outside a repository", async () => {
  const { path } = await scratch();
  const plain = await Deno.makeTempDir({ prefix: "wazoo-wiki-plain-" });
  try {
    await write(path, "docs/one.md", "one\n");
    let thrown: unknown;
    try {
      await amendFiles(`${path}/docs`, "a message", ["one.md"]);
    } catch (error) {
      thrown = error;
    }
    assert(
      thrown instanceof GitError,
      "an empty repository has nothing to amend",
    );
    assert(
      /no commit to amend/.test((thrown as GitError).message),
      "and the sentence says that, rather than letting git's own words about it through",
    );

    await write(plain, "one.md", "x\n");
    thrown = undefined;
    try {
      await amendFiles(plain, "a message", ["one.md"]);
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof GitError, "a folder outside a repository fails");
    assert(
      /not inside a git repository/.test((thrown as GitError).message),
      "by saying the folder is not in one",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
    await Deno.remove(plain, { recursive: true });
  }
});

Deno.test("pushing sends the branch where its own configuration already points", async () => {
  const { path, git } = await scratch();
  try {
    await write(path, "docs/one.md", "one\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "first"]);
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const remote = await withOrigin(git, path);
    try {
      git(["push", "--quiet", "--set-upstream", "origin", "HEAD"]);
      await write(path, "docs/one.md", "one, edited\n");
      git(["commit", "--quiet", "--all", "-m", "second"]);

      const result = await pushBranch(`${path}/docs`);
      assertEqual(
        result.branch,
        branch,
        "the branch that went is the checked-out one",
      );
      assertEqual(result.remote, "origin", "to the remote its config named");
      assertEqual(
        result.ref,
        `refs/heads/${branch}`,
        "onto the ref its config named, rather than a branch name typed in here",
      );
      assertEqual(
        result.commits,
        1,
        "and it carried the one commit that was waiting",
      );

      const at = await new Deno.Command("git", {
        args: ["log", "--format=%s", "-1", branch],
        cwd: remote,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEqual(
        DECODER.decode(at.stdout).trim(),
        "second",
        "so the remote has the commit, checked from the remote rather than the local claim",
      );
      assertEqual(
        (await gitStatus(`${path}/docs`))!.remote.ahead,
        0,
        "and the pane's next status has nothing left to send",
      );
    } finally {
      await Deno.remove(remote, { recursive: true });
    }
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("a push with nothing to send, nowhere to send it, or no branch is refused before git runs", async () => {
  const { path, git } = await scratch();
  const plain = await Deno.makeTempDir({ prefix: "wazoo-wiki-plain-" });
  try {
    await write(path, "docs/one.md", "one\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "first"]);
    const remote = await withOrigin(git, path);
    try {
      let thrown: unknown;
      try {
        await pushBranch(`${path}/docs`);
      } catch (error) {
        thrown = error;
      }
      assert(
        thrown instanceof GitError,
        "a branch with no upstream is not pushed anywhere",
      );
      assert(
        /no upstream/.test((thrown as GitError).message),
        "because there is nowhere this app should decide to put it",
      );
      const heads = await new Deno.Command("git", {
        args: ["branch", "--list"],
        cwd: remote,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEqual(
        DECODER.decode(heads.stdout).trim(),
        "",
        "and the remote still has no branches at all",
      );

      git(["push", "--quiet", "--set-upstream", "origin", "HEAD"]);
      thrown = undefined;
      try {
        await pushBranch(`${path}/docs`);
      } catch (error) {
        thrown = error;
      }
      assert(thrown instanceof GitError, "pushing nothing is refused too");
      assert(
        /already on origin\//.test((thrown as GitError).message),
        "by saying the two are the same, not by pretending to have pushed",
      );

      git(["checkout", "--quiet", "--detach"]);
      thrown = undefined;
      try {
        await pushBranch(`${path}/docs`);
      } catch (error) {
        thrown = error;
      }
      assert(
        thrown instanceof GitError,
        "a detached HEAD is not a branch to push",
      );
      assert(
        /detached HEAD/.test((thrown as GitError).message),
        "and says so in git's own words for it",
      );
    } finally {
      await Deno.remove(remote, { recursive: true });
    }

    await write(plain, "one.md", "x\n");
    let thrown: unknown;
    try {
      await pushBranch(plain);
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof GitError, "a folder outside a repository fails");
    assert(
      /not inside a git repository/.test((thrown as GitError).message),
      "by saying the folder is not in one",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
    await Deno.remove(plain, { recursive: true });
  }
});

Deno.test("a push the remote refuses is reported, and nothing is forced", async () => {
  const { path, git } = await scratch();
  try {
    await write(path, "docs/one.md", "one\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "first"]);
    const remote = await withOrigin(git, path);
    try {
      git(["push", "--quiet", "--set-upstream", "origin", "HEAD"]);

      // A second machine pushes a commit of its own, so this branch is now
      // behind as well as ahead: the case where a forced push would throw
      // somebody else's work away, and the reason there is no force flag here
      // to reach for.
      const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
      const other = await clonedFrom(remote);
      try {
        await write(other.path, "from-elsewhere.md", "somebody else's work\n");
        other.git(["add", "."]);
        other.git(["commit", "--quiet", "-m", "theirs"]);
        other.git(["push", "--quiet", "origin", `HEAD:refs/heads/${branch}`]);
      } finally {
        await Deno.remove(other.path, { recursive: true });
      }

      await write(path, "docs/one.md", "one, edited\n");
      git(["commit", "--quiet", "--all", "-m", "mine"]);

      let thrown: unknown;
      try {
        await pushBranch(`${path}/docs`);
      } catch (error) {
        thrown = error;
      }
      assert(thrown instanceof GitError, "the push fails");
      const message = (thrown as GitError).message;
      assert(
        message.startsWith("git would not push "),
        "and the sentence names what we were asking git to do",
      );
      assert(
        /rejected|fetch first|non-fast-forward/i.test(message),
        `carrying git's own reason rather than its "To <url>" preamble, which is what the reader would otherwise be shown: ${message}`,
      );
      assertEqual(
        git(["log", "--format=%s", "-1"]).trim(),
        "mine",
        "and the local commit is still there: a refusal is not a rewrite",
      );
    } finally {
      await Deno.remove(remote, { recursive: true });
    }
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("a branch name with a semicolon in it is a branch, not two commands", async () => {
  const { path, git } = await scratch();
  try {
    await write(path, "docs/one.md", "one\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "first"]);
    // Git allows a semicolon in a ref name, which is the whole reason the
    // destination is read out of configuration and handed over as one argv
    // entry: a shell would treat this as the end of a command.
    git(["checkout", "--quiet", "-b", "notes;id"]);
    const remote = await withOrigin(git, path);
    try {
      git(["push", "--quiet", "--set-upstream", "origin", "HEAD"]);
      await write(path, "docs/one.md", "one, edited\n");
      git(["commit", "--quiet", "--all", "-m", "second"]);

      const result = await pushBranch(`${path}/docs`);
      assertEqual(
        result.ref,
        "refs/heads/notes;id",
        "the whole name is the branch",
      );
      const heads = await new Deno.Command("git", {
        args: ["branch", "--list", "notes;id"],
        cwd: remote,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(
        DECODER.decode(heads.stdout).includes("notes;id"),
        "and the remote really has a branch with that name on it",
      );
    } finally {
      await Deno.remove(remote, { recursive: true });
    }
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("committing outside a repository says the vault is not in one", async () => {
  const plain = await Deno.makeTempDir({ prefix: "wazoo-wiki-plain-" });
  try {
    await write(plain, "one.md", "x\n");
    let thrown: unknown;
    try {
      await commitFiles(plain, "a message", ["one.md"]);
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof GitError, "it fails");
    assert(
      /not inside a git repository/.test((thrown as GitError).message),
      "and the message says the folder is not in a repository, not that the commit failed",
    );
  } finally {
    await Deno.remove(plain, { recursive: true });
  }
});

Deno.test("git's own words about a commit that failed are the ones shown", async () => {
  // A commit with nothing in it is the failure a reader will actually hit, and
  // git already says exactly what happened. Rewriting that would throw away
  // the only useful part of the message, so this asserts the wording is git's.
  const { path, git } = await scratch();
  try {
    await write(path, "docs/one.md", "one\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "first"]);

    let thrown: unknown;
    try {
      await commitFiles(`${path}/docs`, "a message about nothing", ["one.md"]);
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof GitError, "a commit with nothing in it fails");
    const message = (thrown as GitError).message;
    assert(
      message.startsWith("git would not commit: "),
      "and the sentence says what we were asking git to do",
    );
    assert(
      !/^git would not commit\.$/.test(message),
      "and carries git's own explanation rather than the empty fallback",
    );
    assertEqual(
      git(["log", "--format=%s", "-1"]).trim(),
      "first",
      "and no commit was made",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});
