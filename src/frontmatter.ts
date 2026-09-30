/**
 * Frontmatter as text: where the block is, what is in it, and how to change
 * one line of it without touching another.
 *
 * This module exists because of criterion 1 of the editor decision
 * (wazootech/wiki-desktop#6): a file nobody edited is a file nobody rewrote.
 * A frontmatter editor that parsed the block into objects and serialised it
 * back would break that on every save — key order, quoting, indentation and
 * whether `headline: "x"` keeps its quotes are all choices a serialiser makes
 * and a human does not. Change #6 rejected Tiptap for exactly this shape of
 * problem, and the Tab soft-tab in `src/editor.ts` is the same discipline
 * expressed as a `replaceSelection` rather than a reformat.
 *
 * So nothing here ever produces YAML. It produces a tree of *spans* into the
 * text that was handed in, and the only thing that can change the text is a
 * `TextEdit` naming a range. An edit to one field's value is one line changed;
 * every other byte of the block is not in the edit and cannot be rewritten.
 *
 * The parser is a hand-rolled subset rather than `@std/yaml`, for the same
 * reason `src/format.ts` is: the YAML parser that exists discards source
 * positions, and a span this module cannot produce is a value it could only
 * rewrite. What it covers is what frontmatter in this vault actually is —
 * mappings, sequences, scalars, block scalars, flow collections and comments,
 * nested to whatever depth the lines allow. What it does not cover is listed on
 * {@link UNDECIDED}, and every one of those is a case that leaves the text
 * exactly as it found it.
 */

/** A half-open range `[from, to)` into the text the block was parsed from. */
export interface Span {
  from: number;
  to: number;
}

/** How a scalar was written, which is what a human's quoting is. */
export type ScalarStyle =
  /** `value` — no quotes. */
  | "plain"
  /** `'value'` */
  | "single"
  /** `"value"` */
  | "double"
  /** `|` or `>` and its chomping indicator. */
  | "block"
  /** `[a, b]` or `{a: b}`, as a token. */
  | "flow"
  /** Nothing at all: the key has no value, which is not the same as empty. */
  | "empty";

export interface YamlScalar {
  kind: "scalar";
  span: Span;
  /** The raw token, quotes included — what an edit replaces wholesale. */
  text: string;
  style: ScalarStyle;
}

export interface YamlItem {
  kind: "item";
  span: Span;
  value: YamlValue;
}

export interface YamlSequence {
  kind: "sequence";
  span: Span;
  items: YamlItem[];
}

export interface YamlEntry {
  /** The key as written, with any quotes removed. */
  key: string;
  /** The key token itself, so a rename is as minimal as a value edit. */
  keySpan: Span;
  value: YamlValue;
  /** From the first character of the key's line to the end of its value. */
  span: Span;
}

export interface YamlMapping {
  kind: "mapping";
  span: Span;
  entries: YamlEntry[];
}

export type YamlValue = YamlScalar | YamlSequence | YamlMapping;

/** The block between the two `---` lines, parsed, with absolute spans. */
export interface Frontmatter {
  /** Offset of the opening `---`. */
  from: number;
  /** Offset just past the closing `---`, not counting its newline. */
  to: number;
  /** The first character of the YAML inside the fences. */
  bodyFrom: number;
  /** The first character of the closing `---` line. */
  bodyTo: number;
  /** The block's mappings; empty when the fences enclose nothing. */
  mapping: YamlMapping;
}

/** Why a page has no frontmatter this module will work with. */
export type FrontmatterProblem =
  /** The first line is not `---`: the page has no frontmatter block. */
  | "absent"
  /** The opening `---` is there and nothing closes it. */
  | "unterminated";

export interface FrontmatterResult {
  /** The block, or null when there is not one to work with. */
  frontmatter: Frontmatter | null;
  /** Why there is not one, when there is not. */
  problem: FrontmatterProblem | null;
}

/**
 * A change to the text, as a range and its replacement.
 *
 * A `TextEdit` never spans more of the document than the thing being changed,
 * which is the property the one-line-diff criterion actually tests.
 */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  /** False when the edit would not change anything, so it can be skipped. */
  changed: boolean;
}

/** One physical line, with the column its first non-space character sits at. */
interface Line {
  /** Absolute offset of the first character of the line. */
  from: number;
  /** Absolute offset just past the last character, before any newline. */
  to: number;
  /** The full text of the line, without its newline or carriage return. */
  text: string;
  /** Column of the first non-space character. */
  indent: number;
}

/**
 * Locate and parse a page's frontmatter.
 *
 * A byte-order mark counts as nothing before the first line: it is preserved on
 * disk by `src/vault.ts` and the editor's buffer carries it, so the opening
 * fence is on the line after it rather than on it.
 *
 * A page that opens with `---` and never closes it comes back `unterminated`,
 * which is the case the editor's YAML parser also treats as open-ended. That is
 * not an error to report and never blocks a save: the page opens, shows raw,
 * and saves unchanged.
 */
export function readFrontmatter(text: string): FrontmatterResult {
  const lines = splitLines(text);
  const first = lines[0];
  // The mark is on the same line as the first fence, not on a line of its own,
  // and it is the fence the parser has to see.
  const opening = first === undefined
    ? ""
    : first.text.charCodeAt(0) === 0xfeff
    ? first.text.slice(1)
    : first.text;
  if (first === undefined || trimEnd(opening) !== "---") {
    return { frontmatter: null, problem: "absent" };
  }
  // `from` is the fence itself, so a mark in front of it is not inside it.
  const mark = first.text.length - opening.length;
  let closing = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const line = trimEnd(lines[i].text);
    if (line === "---" || line === "...") {
      closing = i;
      break;
    }
  }
  if (closing === -1) return { frontmatter: null, problem: "unterminated" };

  const body = lines.slice(1, closing);
  const { value } = parseMapping(body, 0, 0);
  return {
    frontmatter: {
      from: first.from + mark,
      to: lines[closing].to,
      bodyFrom: first.to + 1,
      bodyTo: lines[closing].from,
      mapping: value,
    },
    problem: null,
  };
}

/** The entry for `key`, or null when the mapping has none. */
export function entryFor(
  mapping: YamlMapping,
  key: string,
): YamlEntry | null {
  for (const entry of mapping.entries) {
    if (entry.key === key) return entry;
  }
  return null;
}

/** The first entry whose key resolves to `iri`, given a resolver. */
export function entryForTerm(
  mapping: YamlMapping,
  iri: string,
  resolve: (key: string) => string | null,
): YamlEntry | null {
  for (const entry of mapping.entries) {
    if (resolve(entry.key) === iri) return entry;
  }
  return null;
}

/**
 * The edit that gives `entry` a new value, touching nothing else.
 *
 * A scalar is replaced at its own span, so the space after the colon, a
 * trailing `#` comment and everything after the value all survive. A key with
 * no value is the one case a scalar span cannot express, and the edit widens
 * across the whitespace that follows the colon — still one line, and the
 * comment on it stays.
 *
 * A value the user typed as several lines is written back re-indented under the
 * key, because a list typed into a field is a list the file then has to hold.
 */
export function setValueEdit(
  text: string,
  entry: YamlEntry,
  value: string,
): TextEdit {
  const lineStart = lineStartBeforeIn(text, entry.keySpan.from);
  const keyIndent = leadingSpaces(text.slice(lineStart, entry.keySpan.from));
  if (entry.value.kind === "scalar" && entry.value.style === "empty") {
    // There is no value to replace, so what changes is the padding after the
    // colon: the value goes in with its leading space, and a trailing comment
    // keeps the space in front of it.
    const after = entry.value.span.from;
    const lineEnd = lineContentEnd(text, after);
    const comment = text.slice(after, lineEnd).indexOf("#");
    const to = comment === -1 ? lineEnd : after + comment;
    return unchanged(text, {
      from: after,
      to,
      insert: ` ${value}${comment === -1 ? "" : " "}`,
    });
  }
  const from = entry.value.span.from;
  const to = entry.value.span.to;
  const current = text.slice(from, to);
  const wasBlock = current.includes("\n");
  return unchanged(text, {
    // A value moving onto the lines under its key starts at the colon rather
    // than at the token, or the space between the two is left behind as
    // trailing whitespace on a line that now holds nothing.
    from: wasBlock || !value.includes("\n") ? from : entry.keySpan.to + 1,
    to,
    insert: indentContinuation(
      value,
      keyIndent,
      wasBlock
        // A sequence's span starts at the beginning of a line, indentation
        // included, so every line of the replacement is re-indented. A block
        // scalar's span starts at its `|`, so its first line must not be.
        ? entry.value.kind === "scalar" ? "inline" : "lines"
        : "under",
    ),
  });
}

/** An edit that replaces a range with exactly what was in it changes nothing. */
function unchanged(text: string, edit: Omit<TextEdit, "changed">): TextEdit {
  return { ...edit, changed: text.slice(edit.from, edit.to) !== edit.insert };
}

/**
 * The edit that removes `entry` entirely — the key, its value, and the lines
 * those occupy.
 *
 * Whole lines rather than the entry's span, so removing a key cannot leave an
 * empty line behind. A comment on the key's own line goes with it; a comment on
 * the line above does not, because guessing that an author meant that comment
 * to describe this key is exactly the kind of guess a rewrite should not make.
 */
export function removeEdit(text: string, entry: YamlEntry): TextEdit {
  return unchanged(text, {
    from: lineStartBeforeIn(text, entry.span.from),
    to: lineEndAfterIn(text, entry.span.to),
    insert: "",
  });
}

/**
 * The edit that adds `key: value` at `indent`, before the line at `anchor`.
 *
 * An anchor rather than a mapping, because the two cases differ and the caller
 * knows which is which: a field missing from a page that has other keys goes
 * after the last of them, and a field missing from a page that has none goes
 * on a line of its own.
 */
export function insertEdit(
  anchor: number,
  indent: number,
  key: string,
  value: string,
): TextEdit {
  const pad = " ".repeat(Math.max(0, indent));
  return {
    from: anchor,
    to: anchor,
    insert: `${pad}${key}: ${value}\n`,
    changed: true,
  };
}

/** Where a new entry at the end of `mapping` should be inserted. */
export function endOfMappingAnchor(
  text: string,
  mapping: YamlMapping,
): number {
  const last = mapping.entries[mapping.entries.length - 1];
  // An empty block hangs off a key line, and the new entry goes under it;
  // a block with entries goes after the last one.
  const from = last?.span.to ?? mapping.span.to;
  return lineEndAfterIn(text, from);
}

/** Apply one edit. An edit that changes nothing returns the same string. */
export function applyEdit(text: string, edit: TextEdit): string {
  if (!edit.changed) return text;
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

/**
 * How many lines an edit changed: what a diff would print.
 *
 * Counted as the larger of the two sides of the region between the common
 * prefix and the common suffix, so a removal of one line is one, an edit of one
 * value is one, and an insertion of one line is one. A line-by-line comparison
 * cannot do this: it reports every following line as changed after a deletion,
 * which is the arithmetic that would let a whole-block rewrite claim a one-line
 * diff.
 */
export function changedLineCount(before: string, after: string): number {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  return Math.max(endA - start, endB - start);
}

/**
 * What this parser declines to do, all of it a case the text survives.
 *
 * These are the YAML features a hand-rolled subset leaves out, listed so the
 * next reader does not have to find them by writing a page that parses wrong,
 * and so "the form never rewrites what it does not understand" is a list rather
 * than a hope. In every case below the affected lines are preserved verbatim
 * and simply do not appear in the structured view.
 *
 * - **Anchors and aliases** (`&a`, `*a`, merge keys `<<:`) are read as plain
 *   scalars and never resolved.
 * - **Explicit keys** (`? key`) and complex mapping keys (`[a, b]: v`) are not
 *   mapping lines, so the line is skipped whole.
 * - **Multi-line plain scalars.** A plain scalar is one line. A deeper-indented
 *   line under one that is not a mapping entry or a dash is skipped, preserved
 *   and unread.
 * - **Directives** (`%YAML`, `%TAG`) inside the block are preserved and unread.
 */
export const UNDECIDED = [
  "anchors and aliases are read as plain scalars and never resolved",
  "explicit keys and complex mapping keys are skipped whole",
  "a plain scalar is one line; a folded continuation is preserved but not read",
  "directives are preserved but not read",
] as const;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Split text into lines, keeping every line's absolute offsets. */
function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  while (from <= text.length) {
    const newline = text.indexOf("\n", from);
    const to = newline === -1 ? text.length : newline;
    const raw = text.slice(from, to);
    const body = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    lines.push({ from, to, text: body, indent: leadingSpaces(body) });
    if (newline === -1) break;
    from = newline + 1;
  }
  return lines;
}

/** The number of leading spaces or tabs, which is YAML's only indentation. */
function leadingSpaces(text: string): number {
  let n = 0;
  while (n < text.length && (text[n] === " " || text[n] === "\t")) n += 1;
  return n;
}

/** A blank line, or one holding nothing but a comment. */
function isIgnorable(line: Line): boolean {
  const body = line.text.slice(line.indent);
  return body === "" || body.startsWith("#");
}

/** `-` or `- ` at the line's indent: a sequence entry. */
function isDash(line: Line): boolean {
  const body = line.text.slice(line.indent);
  return body === "-" || body.startsWith("- ");
}

function trimEnd(text: string): string {
  return text.replace(/\s+$/, "");
}

/** The offset of the start of the line holding `offset`. */
function lineStartBeforeIn(text: string, offset: number): number {
  if (offset <= 0) return 0;
  const newline = text.lastIndexOf("\n", offset - 1);
  return newline === -1 ? 0 : newline + 1;
}

/**
 * The offset of the newline that ends the line holding `offset`, plus one.
 *
 * This is the "past the end of the line, newline included" offset that removing
 * a whole line wants. The end of a line's *content* is the same thing minus
 * one, and conflating the two is how an edit ends up eating a line break.
 */
function lineEndAfterIn(text: string, offset: number): number {
  const newline = text.indexOf("\n", offset);
  return newline === -1 ? text.length : newline + 1;
}

/** The offset just past the last character of the line holding `offset`. */
function lineContentEnd(text: string, offset: number): number {
  const newline = text.indexOf("\n", offset);
  return newline === -1 ? text.length : newline;
}

/**
 * The column of the `:` that ends a mapping key on this line, or -1.
 *
 * A colon ends a key only when whitespace or the end of the line follows it,
 * which is what keeps `url: https://example.org` one key and not two. A quoted
 * key is not split at a colon inside its quotes, and a `#` after whitespace
 * ends the scan because nothing after a comment can be a key.
 */
function keyColon(text: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < text.length; i += 1) {
    const char = text[i];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "#" && (i === from || /\s/.test(text[i - 1]))) return -1;
    if (char === ":" && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
      return i;
    }
  }
  return -1;
}

/** A key, with a quoted key's quotes removed. */
function readKey(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  if ((first === '"' || first === "'") && trimmed.endsWith(first)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Where a scalar on this line ends, as a column within the line.
 *
 * A `#` starts a comment only after whitespace, so `C#` and `a#b` are values.
 * A quoted scalar ends at its closing quote, and the span covers the quotes —
 * they go with the value, because a field is free to become unquoted once its
 * value no longer needs them.
 */
function scalarEnd(text: string, from: number): number {
  const head = text[from];
  if (head === "'" || head === '"') {
    for (let i = from + 1; i < text.length; i += 1) {
      if (text[i] === head) return i + 1;
    }
    return text.length; // Unterminated quote: the rest of the line is the value.
  }
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === "#" && i > from && /\s/.test(text[i - 1])) {
      // The space in front of a comment is not part of the value, so the span
      // stops before it and an edit leaves the spacing of the line alone.
      let end = i;
      while (end > from && /[ \t]/.test(text[end - 1])) end -= 1;
      return end;
    }
  }
  return text.length;
}

function quotedStyle(text: string): ScalarStyle | null {
  if (text.length < 2) return null;
  const first = text[0];
  if (!text.endsWith(first)) return null;
  if (first === '"') return "double";
  if (first === "'") return "single";
  return null;
}

function isBlockScalarHeader(text: string): boolean {
  return /^[|>][-+]?\d*\s*(#.*)?$/.test(text);
}

function isFlowStart(text: string): boolean {
  return text.startsWith("[") || text.startsWith("{");
}

/** Whether every flow collection opened in `text` is closed inside it. */
function flowBalanced(text: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (const char of text) {
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") depth -= 1;
  }
  return depth <= 0;
}

function emptyScalar(at: number): YamlScalar {
  return {
    kind: "scalar",
    span: { from: at, to: at },
    text: "",
    style: "empty",
  };
}

/** The span covering `lines[from..to)`, empty when that range is empty. */
function blockSpan(lines: Line[], from: number, to: number): Span {
  if (to <= from) {
    const only = lines[from];
    return { from: only?.from ?? 0, to: only?.to ?? only?.from ?? 0 };
  }
  return { from: lines[from].from, to: lines[to - 1].to };
}

/** Parse a mapping whose first line is `lines[start]`, at column `indent`. */
function parseMapping(
  lines: Line[],
  start: number,
  indent: number,
): { value: YamlMapping; next: number } {
  const entries: YamlEntry[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (isIgnorable(line)) {
      i += 1;
      continue;
    }
    if (line.indent !== indent || isDash(line)) break;
    const colon = keyColon(line.text, line.indent);
    if (colon < 0) {
      i += 1;
      continue;
    }
    const after = colon + 1;
    const rest = line.text.slice(after).trim();

    let value: YamlValue;
    let entryEnd: number;
    let nextLine: number;

    if (rest === "" || rest.startsWith("#")) {
      const child = scanBlock(lines, i + 1, indent + 1);
      if (child !== null) {
        value = child.value;
        entryEnd = lines[child.next - 1].to;
        nextLine = child.next;
      } else {
        value = emptyScalar(line.from + after);
        entryEnd = line.to;
        nextLine = i + 1;
      }
    } else if (isBlockScalarHeader(rest)) {
      const block = scanBlockScalar(lines, i, indent);
      value = block.value;
      entryEnd = lines[block.next - 1].to;
      nextLine = block.next;
    } else if (isFlowStart(rest) && !flowBalanced(rest)) {
      const flow = scanFlow(lines, i, after);
      value = flow.value;
      entryEnd = lines[flow.next - 1].to;
      nextLine = flow.next;
    } else {
      const lead = after + leadingSpaces(line.text.slice(after));
      const end = scalarEnd(line.text, lead);
      const raw = line.text.slice(lead, end);
      value = {
        kind: "scalar",
        span: { from: line.from + lead, to: line.from + end },
        text: raw,
        style: quotedStyle(raw) ?? (isFlowStart(raw) ? "flow" : "plain"),
      };
      entryEnd = line.to;
      nextLine = i + 1;
    }

    entries.push({
      key: readKey(line.text.slice(line.indent, colon)),
      keySpan: {
        from: line.from + line.indent,
        to: line.from + colon,
      },
      value,
      span: { from: line.from, to: entryEnd },
    });
    i = nextLine;
  }
  return {
    value: {
      kind: "mapping",
      span: blockSpan(lines, start, i),
      entries,
    },
    next: i,
  };
}

/** The block hanging under a key, or null when there is none. */
function scanBlock(
  lines: Line[],
  start: number,
  minIndent: number,
): { value: YamlValue; next: number } | null {
  let i = start;
  while (i < lines.length && isIgnorable(lines[i])) i += 1;
  if (i >= lines.length || lines[i].indent < minIndent) return null;
  return isDash(lines[i])
    ? parseSequence(lines, i, lines[i].indent)
    : parseMapping(lines, i, lines[i].indent);
}

/** A sequence whose first line is `lines[start]`, at column `indent`. */
function parseSequence(
  lines: Line[],
  start: number,
  indent: number,
): { value: YamlSequence; next: number } {
  const items: YamlItem[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (isIgnorable(line)) {
      i += 1;
      continue;
    }
    if (line.indent !== indent || !isDash(line)) break;

    const afterDash = line.indent + 1;
    const rest = line.text.slice(afterDash);

    if (rest.trim() === "" || rest.trim().startsWith("#")) {
      const child = scanBlock(lines, i + 1, indent + 1);
      if (child !== null) {
        items.push({
          kind: "item",
          span: { from: line.from, to: lines[child.next - 1].to },
          value: child.value,
        });
        i = child.next;
        continue;
      }
      items.push({
        kind: "item",
        span: { from: line.from, to: line.to },
        value: emptyScalar(line.to),
      });
      i += 1;
      continue;
    }

    /*
     * `- sh:path: schema:headline` is a mapping whose first key sits after the
     * dash, and the lines under it are indented to *its* column rather than to
     * the dash's. So the item is parsed from a view of the lines that starts at
     * that column: a first line carrying the real offsets and a synthetic
     * indent. Every span this returns is still an offset into the caller's
     * text, which is the only property that matters for a minimal edit.
     */
    const column = afterDash + leadingSpaces(rest);
    const view: Line[] = [
      { from: line.from, to: line.to, text: line.text, indent: column },
    ];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (isIgnorable(next)) {
        view.push(next);
        j += 1;
        continue;
      }
      if (next.indent < column) break;
      view.push(next);
      j += 1;
    }
    // Blank lines belong to the sequence rather than to this item, or the next
    // entry would inherit a span running past it.
    while (view.length > 1 && isIgnorable(view[view.length - 1])) {
      j -= 1;
      view.pop();
    }

    const first = view[0];
    const value = isDash(first)
      ? parseSequence(view, 0, column).value
      : keyColon(first.text, column) >= 0
      ? parseMapping(view, 0, column).value
      : scalarOnLine(first, column);

    items.push({
      kind: "item",
      span: { from: line.from, to: view[view.length - 1].to },
      value,
    });
    i = j;
  }
  return {
    value: {
      kind: "sequence",
      span: blockSpan(lines, start, i),
      items,
    },
    next: i,
  };
}

/** The scalar sitting on a line from `column` onwards, as one value. */
function scalarOnLine(line: Line, column: number): YamlScalar {
  const end = scalarEnd(line.text, column);
  const raw = line.text.slice(column, end);
  return {
    kind: "scalar",
    span: { from: line.from + column, to: line.from + end },
    text: raw,
    style: quotedStyle(raw) ?? (isFlowStart(raw) ? "flow" : "plain"),
  };
}

/** A `|` or `>` block: the header line plus every line indented under it. */
function scanBlockScalar(
  lines: Line[],
  start: number,
  indent: number,
): { value: YamlScalar; next: number } {
  const header = lines[start];
  const marker = header.text.search(/[|>]/);
  const at = marker === -1 ? header.indent : marker;
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.text.trim() === "") {
      i += 1;
      continue;
    }
    if (line.indent <= indent) break;
    i += 1;
  }
  while (i > start + 1 && lines[i - 1].text.trim() === "") i -= 1;
  const last = lines[i - 1] ?? header;
  return {
    value: {
      kind: "scalar",
      span: { from: header.from + at, to: last.to },
      text: joinLines(lines, start, i, at),
      style: "block",
    },
    next: i,
  };
}

/** A `[` or `{` that opens on this line and closes on a later one. */
function scanFlow(
  lines: Line[],
  start: number,
  from: number,
): { value: YamlScalar; next: number } {
  let i = start;
  while (i < lines.length) {
    const column = i === start ? from - lines[start].from : lines[i].indent;
    if (flowBalanced(lines[i].text.slice(column))) break;
    i += 1;
  }
  const stopped = Math.min(i, lines.length - 1);
  const last = lines[stopped] ?? lines[start];
  return {
    value: {
      kind: "scalar",
      span: { from, to: last.to },
      text: joinLines(lines, start, stopped + 1, from - lines[start].from),
      style: "flow",
    },
    next: stopped + 1,
  };
}

/** The source text of `lines[from..to)`, the first line cut at `column`. */
function joinLines(
  lines: Line[],
  from: number,
  to: number,
  column: number,
): string {
  const parts: string[] = [];
  for (let i = from; i < to; i += 1) {
    parts.push(i === from ? lines[i].text.slice(column) : lines[i].text);
  }
  return parts.join("\n");
}

/**
 * Re-indent a value the user typed as several lines.
 *
 * Three shapes, and which one applies is decided by what the value is replacing
 * rather than by what the user typed:
 *
 * - `under` — it is replacing an inline scalar. `description: - first` is not
 *   a list, it is a scalar beginning with a dash, so the value moves onto the
 *   lines under the key, which is the only spelling of this YAML accepts.
 * - `lines` — it is replacing a sequence or a mapping, whose span starts at the
 *   beginning of a line with its indentation inside it, so every line is
 *   re-indented.
 * - `inline` — it is replacing a scalar already on its own lines, such as a
 *   `|` block, whose span starts at the marker rather than at the line start, so
 *   its first line must keep its column.
 */
function indentContinuation(
  value: string,
  keyIndent: number,
  mode: "under" | "lines" | "inline",
): string {
  if (!value.includes("\n")) return value;
  const pad = " ".repeat(Math.max(0, keyIndent + 2));
  const lines = value.split("\n");
  const padLine = (line: string) => (line === "" ? line : pad + line);
  if (mode === "under") return `\n${lines.map(padLine).join("\n")}`;
  if (mode === "lines") return lines.map(padLine).join("\n");
  return lines
    .map((line, index) => (index === 0 || line === "" ? line : pad + line))
    .join("\n");
}
