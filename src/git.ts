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

/**
 * Where the vault's branch sits against the remote it is configured to reach.
 *
 * Every field is nullable, and each null is a different situation rather than a
 * failure to find out: a detached HEAD has no branch, a branch that has never
 * been pushed has no upstream, and a branch whose upstream has not been
 * fetched has no counts. The pane has to say which of those it is looking at,
 * because "there is nothing to push" and "we do not know whether there is
 * anything to push" are not the same sentence and only one of them is an
 * answer the button can act on.
 */
export interface GitRemote {
  /** Branch name, or null on a detached HEAD. */
  branch: string | null;
  /** The remote-tracking branch, e.g. `origin/main`. Null when there is none. */
  upstream: string | null;
  /** Commits here the upstream has not seen, or null when that is unknown. */
  ahead: number | null;
  /** Commits the upstream has that this branch has not seen, or null. */
  behind: number | null;
  /**
   * Whether HEAD is already part of the upstream's history.
   *
   * This is the question behind amending. An amend replaces a commit, so an
   * amend of a commit somebody else already has does not add a commit, it
   * quietly makes the two histories disagree — and the next `git pull` on
   * someone else's machine is where that surfaces. So it is asked of git
   * rather than guessed from `ahead`, and a HEAD that is *not* in the upstream
   * is safe precisely because it is new: nobody has it but us.
   */
  published: boolean;
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
  /** The branch's standing against its remote, which the box also draws. */
  remote: GitRemote;
}

/** What a commit or an amend did, so the pane can say it rather than go quiet. */
export interface CommitResult {
  /** The files the commit took, vault-relative, in the order they were given. */
  committed: string[];
  /** The new commit's short hash, for the line the pane prints. */
  hash: string;
}

/** What a push carried, for the line the pane prints afterwards. */
export interface PushResult {
  /** The local branch that was pushed. */
  branch: string;
  /** The remote it went to, from the branch's own configuration. */
  remote: string;
  /** The full ref it landed on, e.g. `refs/heads/main`. */
  ref: string;
  /** How many commits it carried, counted before the push ran. */
  commits: number;
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
    // Asked on the same trip as the status, because the status is redrawn every
    // time the pane is and the two go out of date together. Three or four more
    // `git` invocations, all of them the local ref arithmetic git does in
    // microseconds, against a process the app has to start either way.
    remote: await remoteInfo(vaultRoot),
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
  const { text, selected } = prepare(message, paths, "commit");
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
 * Replace the last commit with the given files folded into it.
 *
 * The same pathspec form as {@link commitFiles}, and for the same reason: an
 * amend from this pane can only ever contain what the reader ticked, and
 * whatever another window staged is left where it is rather than swept in.
 * What makes it worth having at all is that the message is still editable —
 * the usual reason to amend is a subject line you would rather not live with,
 * and doing that should not mean leaving the pane, or worse, `git commit
 * --amend` in a terminal over a working tree the app has open.
 *
 * One commit is refused: HEAD when the upstream already has it. Replacing a
 * commit somebody else has fetched is not a commit, it is a divergence, and
 * this is the one place in the app where a wrong click loses work that is
 * already out of somebody's hands.
 */
export async function amendFiles(
  vaultRoot: string,
  message: string,
  paths: string[],
): Promise<CommitResult> {
  const { text, selected } = prepare(message, paths, "amend");
  const root = await repositoryRoot(vaultRoot);
  if (root === null) {
    throw new GitError(
      "This vault is not inside a git repository, so there is nothing to amend.",
    );
  }
  const head = await git(vaultRoot, ["rev-parse", "--verify", "HEAD"]);
  if (head.code !== 0) {
    throw new GitError(
      "There is no commit to amend yet, because this repository has none.",
    );
  }
  const remote = await remoteInfo(vaultRoot);
  if (remote.published) {
    throw new GitError(
      "The last commit is already on " + remote.upstream +
        ", and amending it would replace history that is already published. " +
        "Commit the file as a new commit instead.",
    );
  }
  const result = await git(vaultRoot, [
    "commit",
    "--quiet",
    "--amend",
    "--message",
    text,
    "--",
    ...selected,
  ]);
  if (result.code !== 0) {
    throw new GitError(failure("amend the last commit", result));
  }
  const after = await git(vaultRoot, ["rev-parse", "--short", "HEAD"]);
  return {
    committed: selected,
    hash: after.code === 0 ? after.stdout.trim() : "",
  };
}

/**
 * Push this branch to the remote it is already configured to push to.
 *
 * Deliberately narrow, because pushing is the only thing here that reaches
 * somebody else's machine. No force, no `--all`, no `--prune`, no refspec
 * anybody typed in: the destination is read out of `branch.<name>.merge` and
 * the remote out of git's own `@{pushremote}`, so a push can only ever go
 * where the repository's configuration already says this branch goes. A push
 * that needs a flag to succeed is a push the reader should think about, and
 * this one is not in a position to ask.
 *
 * The upstream is also the gate: a branch with nothing configured to push to
 * is refused rather than guessed at. Guessing here means picking a remote
 * nobody named, and a wiki's repository is as likely to be a colleague's
 * personal one as anything else.
 */
export async function pushBranch(vaultRoot: string): Promise<PushResult> {
  const root = await repositoryRoot(vaultRoot);
  if (root === null) {
    throw new GitError(
      "This vault is not inside a git repository, so there is nothing to push.",
    );
  }
  const remote = await remoteInfo(vaultRoot);
  if (remote.branch === null) {
    throw new GitError(
      "This vault is on a detached HEAD, which is not a branch to push.",
    );
  }
  if (remote.upstream === null) {
    throw new GitError(
      "The branch " + remote.branch +
        " has no upstream, so there is nowhere this app should push it to. " +
        "Give it one with git push --set-upstream once, or from whatever you " +
        "normally use.",
    );
  }
  if (remote.ahead === null) {
    throw new GitError(
      "This app cannot tell whether " + remote.branch + " is ahead of " +
        remote.upstream + ", so it will not push it.",
    );
  }
  if (remote.ahead === 0) {
    throw new GitError(
      "Everything on " + remote.branch + " is already on " + remote.upstream +
        ".",
    );
  }
  // Read out of the branch's own configuration rather than asked for as
  // `@{pushremote}`: not every git answers that spelling, and a destination
  // this app cannot find is a destination it must not guess at. `remote` is the
  // name (or, for a branch configured against a URL, the URL) and `merge` is the
  // full ref, which is the pair git itself pushes from.
  const name = await git(vaultRoot, [
    "config",
    "--get",
    "branch." + remote.branch + ".remote",
  ]);
  const pushTo = name.code === 0 ? name.stdout.trim() : "";
  // A remote that begins with a dash would be an option, not a remote. It comes
  // from configuration rather than from the page, so this is the belt to the
  // braces that every other path in here gets.
  if (pushTo === "" || pushTo.startsWith("-")) {
    throw new GitError(
      "Git could not say which remote " + remote.branch + " pushes to.",
    );
  }
  const merge = await git(vaultRoot, [
    "config",
    "--get",
    "branch." + remote.branch + ".merge",
  ]);
  const ref = merge.code === 0 ? merge.stdout.trim() : "";
  if (!ref.startsWith("refs/heads/") || ref.length <= "refs/heads/".length) {
    throw new GitError(
      "Git could not say which branch on " + pushTo + " this one lands on.",
    );
  }
  const result = await git(vaultRoot, ["push", pushTo, "HEAD:" + ref]);
  if (result.code !== 0) {
    throw new GitError(failure("push " + remote.branch, result));
  }
  return { branch: remote.branch, remote: pushTo, ref, commits: remote.ahead };
}

/**
 * The message and the paths a commit or an amend was asked for, checked once.
 *
 * Validated here rather than trusted from the page: the paths are the one
 * argument that reaches a program, and normalizeVaultPath is the rule that says
 * a vault path is relative, has no `..` in it, and has no NUL. The set dedupes
 * because a pathspec repeated is harmless but a commit listing a file twice is
 * a thing to be embarrassed about in the log.
 *
 * `what` is the word in the two sentences a reader can act on, so the refusal
 * names the button they were reaching for.
 */
function prepare(
  message: string,
  paths: string[],
  what: string,
): { text: string; selected: string[] } {
  const text = typeof message === "string" ? message.trim() : "";
  if (text === "") {
    throw new GitError(
      "Write what the " + what + " says before making it.",
    );
  }
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new GitError(
      what === "amend"
        ? "Tick at least one file to fold into the last commit."
        : "Tick at least one file to commit.",
    );
  }
  return {
    text,
    selected: [...new Set(paths.map((path) => normalizeVaultPath(path)))],
  };
}

/**
 * The branch, its upstream, and the two counts that say whether a push or an
 * amend is even a thing that can happen right now.
 *
 * Four `git` calls at worst, and each one is asked of git rather than worked
 * out from a file: a branch name lives in `.git/HEAD`, its upstream in
 * `.git/config`, and the counts only exist in the object database. Guessing
 * any of them from a path is a guess about a format this app has no business
 * knowing.
 */
async function remoteInfo(vaultRoot: string): Promise<GitRemote> {
  const unknown: GitRemote = {
    branch: null,
    upstream: null,
    ahead: null,
    behind: null,
    published: false,
  };
  const named = await git(vaultRoot, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ]);
  // Exit 1 is a detached HEAD, which is a real state and not a failure: git
  // cannot name a branch that is not there.
  if (named.code !== 0) return unknown;
  const branch = named.stdout.trim();
  if (branch === "") return unknown;
  const tracking = await git(vaultRoot, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  // The other exit-1 case: a branch that has never been pushed, or whose
  // upstream this clone has not fetched. Both mean the same thing to a reader
  // — nothing here is waiting to go anywhere.
  if (tracking.code !== 0) return { ...unknown, branch };
  const upstream = tracking.stdout.trim();
  if (upstream === "") return { ...unknown, branch };
  // `--left-right --count` prints two numbers: the commits only the upstream
  // has, then the commits only HEAD has. Left is behind, right is ahead.
  const counts = await git(vaultRoot, [
    "rev-list",
    "--left-right",
    "--count",
    upstream + "...HEAD",
  ]);
  if (counts.code !== 0) return { ...unknown, branch, upstream };
  const parts = counts.stdout.trim().split(/\s+/);
  const behind = parts.length === 2 ? Number(parts[0]) : Number.NaN;
  const ahead = parts.length === 2 ? Number(parts[1]) : Number.NaN;
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
    return { ...unknown, branch, upstream };
  }
  // `--is-ancestor` is the question amend has to ask: HEAD being in the
  // upstream's history means it is already somebody else's. Exit 1 is a clean
  // no, and any other failure is treated as a yes — when the answer is not
  // known, refusing the amend is the mistake that costs least.
  const published = await git(vaultRoot, [
    "merge-base",
    "--is-ancestor",
    "HEAD",
    upstream,
  ]);
  return {
    branch,
    upstream,
    ahead,
    behind,
    published: published.code !== 1,
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
  const detail = reason(result.stderr);
  return detail === null
    ? `git would not ${what}.`
    : `git would not ${what}: ${detail}`;
}

/**
 * The line of git's output that says what went wrong, or null when it said
 * nothing at all.
 *
 * Not simply the first line, because git writes a preamble and then a verdict:
 * a push says "To <url>" and only then "! [rejected] main -> main (fetch
 * first)", and a reader shown a temporary directory and no verdict has been
 * told nothing. So a line that marks itself as the failure — the `!` on a
 * rejected ref, `error:`, `fatal:` — wins over the lines that are only the
 * run-up, and the first line is the fallback for the failures that arrive
 * without one.
 */
function reason(stderr: string): string | null {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return null;
  return lines.find((line) => /^(error|fatal|!)/.test(line)) ?? lines[0];
}

/** The message on an unknown throw, which is not always a string. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
