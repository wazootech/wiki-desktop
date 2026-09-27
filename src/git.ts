/**
 * The one place the app talks to git.
 *
 * Everything here shells out to the git binary rather than reimplementing git,
 * and that is the whole argument for the arrangement: the alternative is a
 * second implementation of the index format, the pack format and the merge
 * machinery, which is not a thing a wiki editor should carry. What git already
 * does, git does, including the parts nobody remembers, like what happens to a
 * file that was renamed out from under a pathspec.
 *
 * The boundary is narrow on purpose. Git gets a working directory and an
 * argument list, never a shell string, so a file name in a wiki — which is to
 * say an arbitrary string that came out of a folder on disk — cannot become an
 * option or a second command. Every path that crosses into here is checked by
 * {@link normalizeVaultPath} first, and every one of them lands after a `--`.
 *
 * This is also the app's first dependency on a program being installed. The
 * rest of it is the filesystem, which cannot be installed or not; git can, and
 * a vault outside a repository is a normal state rather than an error. So
 * "git is not here" and "this folder is not a repository" are two different
 * sentences, and neither of them stops the rest of the app.
 */
import { relative, resolve, sep } from "node:path";

import { normalizeVaultPath } from "./vault.ts";

/**
 * How many changed files one answer carries.
 *
 * A bound rather than a shrug: an untracked `node_modules` can put a hundred
 * thousand paths in a status, and a pane that tries to draw all of them is a
 * pane that stops answering. The real count comes back beside the list so the
 * pane can say what it is not showing, because a list that silently stops at
 * 500 is a lie about what is staged.
 */
export const MAX_GIT_CHANGES = 500;

/** One path git has something to say about, relative to the vault root. */
export interface GitChange {
  /** Vault-relative path with forward slashes, the shape the listing uses. */
  path: string;
  /**
   * Git's own two-letter code, verbatim: ` M` for a write on disk, `??` for a
   * file git has never seen, `A ` for a file added to the index, `D ` for a
   * deletion, `R ` for a rename. Shown as it is rather than translated here,
   * because git's codes are what a reader who has used git anywhere else
   * already reads, and a second vocabulary in the corner of a window helps
   * nobody.
   */
  status: string;
  /** Whether the change is already in the index rather than only on disk. */
  staged: boolean;
}

/** What the vault's repository currently has pending, or null if it has none. */
export interface GitStatus {
  /**
   * Absolute path of the repository root.
   *
   * Usually above the vault — a wiki is often a `docs/` folder in somebody
   * else's repository — which is why every path in here is converted back to
   * vault-relative before it leaves this module. A status that reported
   * repository-root paths would name files the app cannot open.
   */
  root: string;
  changes: GitChange[];
  /** How many paths git reported, which is more than `changes` when capped. */
  total: number;
}

/** What a commit did, so the pane can say it rather than go quiet. */
export interface CommitResult {
  /** The files the commit took, vault-relative, in the order they were given. */
  committed: string[];
  /** The new commit's short hash, for the line the pane prints. */
  hash: string;
}

/**
 * A failure worth showing a reader.
 *
 * Carries git's own stderr where there is one, because the messages worth
 * acting on — an unconfigured author, a hook that failed, nothing staged — are
 * git's, and rewriting them would throw away the part that says what to do.
 */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

/**
 * What the vault's repository currently has pending, or null when the vault is
 * not inside one.
 *
 * Null rather than an empty status: "not a repository" and "a repository with
 * nothing pending" are different answers to a different question, and the pane
 * has to be able to say which one it is rather than showing an empty list for
 * a folder that has no `.git` above it at all.
 */
export async function gitStatus(vaultRoot: string): Promise<GitStatus | null> {
  const root = await repositoryRoot(vaultRoot);
  if (root === null) return null;
  // `--no-optional-locks` because this runs on the hot path of opening a pane:
  // without it, a status beside a real commit in another window fails to take
  // the index lock and reports the working tree as busy.
  // `--untracked-files=all` because a vault's new pages are the reason anyone
  // opens this pane, and the default would collapse a whole new directory into
  // one unnameable entry.
  // `-- .` because the repository usually reaches above the vault, and a change
  // to a file the app cannot even open is not something this pane can offer to
  // commit.
  const result = await git(vaultRoot, [
    "--no-optional-locks",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ".",
  ]);
  if (result.code !== 0) throw new GitError(failure("read the status", result));
  const changes = parseStatus(result.stdout, root, vaultRoot);
  return {
    root,
    changes: changes.slice(0, MAX_GIT_CHANGES),
    total: changes.length,
  };
}

/**
 * Commit the given vault-relative files with the given message.
 *
 * The pathspec form of `git commit`, not `git add` followed by a bare commit.
 * That is a deliberate difference and not a stylistic one: the pathspec form
 * builds the commit from HEAD plus the named files and leaves the index alone,
 * so a commit from this pane cannot sweep up something another window staged,
 * and cannot be surprised by the order the two operations happened in. It also
 * means an uncommitted edit the user did not tick is not committed just because
 * it happened to be in the index.
 */
export async function commitFiles(
  vaultRoot: string,
  message: string,
  paths: string[],
): Promise<CommitResult> {
  const text = typeof message === "string" ? message.trim() : "";
  if (text === "") {
    throw new GitError("Write what the commit says before committing it.");
  }
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new GitError("Tick at least one file to commit.");
  }
  // Validated here rather than trusted from the page: this is the one argument
  // that reaches a program, and normalizeVaultPath is the rule that says a
  // vault path is relative, has no `..` in it, and has no NUL. The set dedupes
  // because a pathspec repeated is harmless but a commit listing a file twice
  // is a thing to be embarrassed about in the log.
  const selected = [
    ...new Set(paths.map((path) => normalizeVaultPath(path))),
  ];
  const root = await repositoryRoot(vaultRoot);
  if (root === null) {
    throw new GitError(
      "This vault is not inside a git repository, so there is nothing to commit to.",
    );
  }
  const result = await git(vaultRoot, [
    "commit",
    "--quiet",
    "--message",
    text,
    "--",
    ...selected,
  ]);
  if (result.code !== 0) throw new GitError(failure("commit", result));
  const head = await git(vaultRoot, ["rev-parse", "--short", "HEAD"]);
  return {
    committed: selected,
    hash: head.code === 0 ? head.stdout.trim() : "",
  };
}

/**
 * The repository containing the vault, or null when there is not one.
 *
 * `rev-parse --show-toplevel` rather than looking for a `.git` directory
 * because the two disagree in a way that matters here: a vault can be a
 * worktree, a submodule, or a bare-repo-relative checkout, and only git knows
 * which. It also answers correctly for a vault nested deep inside someone
 * else's repository, which is the normal case here.
 */
async function repositoryRoot(vaultRoot: string): Promise<string | null> {
  const result = await git(vaultRoot, ["rev-parse", "--show-toplevel"]);
  // Exit 128 with "not a git repository" on stderr is the answer, not a
  // failure: most vaults are not repositories and the app has to carry on.
  if (result.code !== 0) return null;
  const root = result.stdout.trim();
  return root === "" ? null : root;
}

/**
 * Run git and hand back everything about how it went.
 *
 * No shell, and no way to reach one: `Deno.Command` takes an argv, so a path
 * containing a space, a quote, a semicolon or a newline is one argument that
 * git sees as one argument. `--` before every pathspec does the rest.
 */
async function git(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  let output: Deno.CommandOutput;
  try {
    output = await new Deno.Command("git", {
      args,
      cwd,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (error) {
    // The binary is not installed, or is not on the PATH the app was given.
    // That is a different sentence from "this is not a repository", and a
    // reader who does not have git needs to be told that rather than told
    // their vault is broken.
    if (error instanceof Deno.errors.NotFound) {
      throw new GitError(
        "git was not found on the PATH this app was given, so there is nothing to ask it.",
      );
    }
    throw new GitError(`git could not be run: ${messageOf(error)}`);
  }
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr).trim(),
  };
}

/**
 * Read git's machine-readable status, in the one format meant to be parsed.
 *
 * `-z` matters twice over. It drops the quoting git otherwise applies to a
 * path with a space, a quote or a non-ASCII character in it — and in a wiki,
 * those are ordinary file names, not an attack — and it separates records with
 * NUL, so a file name containing a newline cannot forge a second record. The
 * two-letter code and one space, then the path, is the whole of each record.
 */
function parseStatus(
  output: string,
  root: string,
  vaultRoot: string,
): GitChange[] {
  const records = output.split("\0");
  const changes: GitChange[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    // The split leaves a trailing empty field, and an empty output is one too.
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    // A rename or a copy is two paths: this record holds the new one and the
    // next holds the old one. The old path is history — there is no file at
    // that name any more, so there is nothing in the vault to point a checkbox
    // at — so it is consumed here and dropped.
    if (status.includes("R") || status.includes("C")) index += 1;
    const path = vaultRelative(record.slice(3), root, vaultRoot);
    if (path === null) continue;
    changes.push({
      path,
      status,
      // The first column is the index, the second is the working tree. An
      // untracked file is `??`, and neither column of that is a staged change.
      staged: status[0] !== " " && status[0] !== "?",
    });
  }
  return changes;
}

/**
 * A repository-root path as a vault-relative one, or null when it is not one.
 *
 * Porcelain paths are always relative to the repository root, and the root is
 * usually above the vault, so this conversion is what stops the pane listing
 * files the app cannot open — and what stops it listing a vault page under a
 * name the app has no file at, which is what joining the path onto the vault
 * root instead of the repository root would do.
 *
 * The `--` pathspec already limits the set to the vault, so the null branch is
 * the belt to that braces: a symlinked or differently-cased root can still put
 * a path outside, and a path that escapes the vault is not one to hand to a
 * checkbox.
 */
function vaultRelative(
  path: string,
  root: string,
  vaultRoot: string,
): string | null {
  const full = resolve(root, path);
  const rel = relative(vaultRoot, full);
  if (rel === "" || rel === ".." || rel.startsWith(".." + sep)) return null;
  return rel.split(sep).join("/");
}

/** git's own words about a failure, with a note of what we were asking it. */
function failure(what: string, result: { stderr: string }): string {
  const detail = result.stderr.split("\n").find((line) => line.trim() !== "");
  return detail === undefined
    ? `git would not ${what}.`
    : `git would not ${what}: ${detail}`;
}

/** The message on an unknown throw, which is not always a string. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
