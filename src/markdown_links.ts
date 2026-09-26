/**
 * What a Markdown link points at, and whether a click asked to follow it.
 *
 * Its own module, and deliberately not part of `page.ts`, for two reasons.
 * The first is testability: the href comes out of the syntax tree and the
 * resolution is arithmetic, so `EditorState` alone is enough to test all of it
 * with no DOM — the same reason `vault.ts` and `wiki_config.ts` stand apart.
 *
 * The second is the backslash. The page script is one template literal inside
 * `page.ts`, where a backslash is an escape sequence — `/\.md$/` reached the
 * browser as `/.md$/` in an earlier change, and a backtick in a comment closed
 * the string outright. None of this file is inside that literal, so the regular
 * expressions here are the ones written.
 */
import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

/** Where following a link should take the user. */
export type LinkTarget =
  /** A file in this vault, and the fragment if the href named one. */
  | { kind: "vault"; path: string; fragment: string }
  /** Another site: `https:`, `mailto:`, anything with a scheme. */
  | { kind: "external"; url: string }
  /** A heading in the file already open. */
  | { kind: "anchor"; fragment: string }
  /** Nothing sensible to open. */
  | { kind: "none" };

/**
 * The href of the Markdown link at `pos`, or null when there is not one there.
 *
 * Read from the tree rather than from the text. The parser has already done the
 * awkward parts — it knows where the URL ends when the URL contains a `)`, and
 * where the label ends when it contains a `]` — so a link like
 * `[wiki](wiki.md)` resolves without any pattern of our own, and a partially
 * typed one simply has no `URL` child yet and returns null.
 */
export function linkHrefAt(state: EditorState, pos: number): string | null {
  const inner = syntaxTree(state).resolveInner(pos, 1);
  if (inner === null) return null;

  // The click can land on the label, the brackets or the URL, so climb to the
  // enclosing Link rather than assuming where inside it the position fell.
  let link: SyntaxNode | null = null;
  for (let node: SyntaxNode | null = inner.node; node; node = node.parent) {
    if (node.name === "Link") {
      link = node;
      break;
    }
  }
  if (link === null) return null;

  const cursor = link.cursor();
  if (!cursor.firstChild()) return null;
  do {
    if (cursor.name === "URL") {
      const href = state.sliceDoc(cursor.from, cursor.to).trim();
      return href === "" ? null : href;
    }
  } while (cursor.nextSibling());
  return null;
}

/**
 * The modifier that means "follow this link" rather than "put the caret here".
 *
 * Read from the event rather than from a build-time platform check, so one
 * bundle serves both: Ctrl on Windows and Linux, Cmd on macOS, which is what
 * every other editor does. Both are accepted, so a Windows user with a Mac
 * keyboard is not left guessing.
 */
export function asksToFollowLink(event: {
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return event.ctrlKey || event.metaKey;
}

/**
 * Resolve a link href against the page it was written on.
 *
 * A target is relative to the *linking file's own folder*, which is what a
 * Markdown link means and what the vault uses: from `wiki/Declarative_Knowledge.md`,
 * `[RDF](RDF.md)` is `wiki/RDF.md`. A leading `/` is vault-root-relative.
 *
 * A path that climbs above the vault root resolves to nothing rather than to a
 * guess. That is the same rule `wiki_config.ts` applies to a config that points
 * outside the vault, and for the same reason: the listing only ever addresses
 * the one folder it was given.
 */
export function resolveLinkTarget(
  href: string,
  fromPath: string,
): LinkTarget {
  const raw = href.trim();
  if (raw === "") return { kind: "none" };

  // A scheme is a different document, not a file. This is also what keeps a
  // CURIE like `schema:TechArticle` from being read as a relative path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return { kind: "external", url: raw };

  if (raw.startsWith("#")) {
    return raw.length > 1 ? { kind: "anchor", fragment: raw.slice(1) } : {
      kind: "none",
    };
  }

  const hash = raw.indexOf("#");
  const file = hash === -1 ? raw : raw.slice(0, hash);
  const fragment = hash === -1 ? "" : raw.slice(hash + 1);
  if (file === "") return { kind: "none" };

  const folder = fromPath.includes("/")
    ? fromPath.slice(0, fromPath.lastIndexOf("/"))
    : "";
  // A leading slash means "from the vault root", so the slash is dropped and
  // the rest of the path is kept. Dropping the whole path instead would turn
  // every root-relative link into a link to nothing.
  const target = file.startsWith("/") ? file.slice(1) : `${folder}/${file}`;
  const parts = target.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (resolved.length === 0) return { kind: "none" };
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  if (resolved.length === 0) return { kind: "none" };
  return { kind: "vault", path: resolved.join("/"), fragment };
}

/** A one-line description of a target, for the hover title. */
export function describeLinkTarget(target: LinkTarget): string {
  switch (target.kind) {
    case "vault":
      return target.fragment === ""
        ? target.path
        : `${target.path}#${target.fragment}`;
    case "anchor":
      return `#${target.fragment} in this page`;
    case "external":
      return `Open ${target.url} in a new window`;
    default:
      return "This link does not point anywhere yet";
  }
}
