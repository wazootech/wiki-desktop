/**
 * Formatting for a wiki page: the text as it stands, made tidy.
 *
 * A pure function over a string, its own module for the same reason
 * `fence_languages.ts` is: nothing here touches a DOM, a vault, or an editor,
 * so every rule below is checked by handing it text and reading text back.
 * The page formats what the editor holds and hands the result to
 * `applyFormatted`, so neither the tab strip, the dirty state, nor `Save` ever
 * learns that formatting exists.
 *
 * This is deliberately not an AST round trip. A remark/mdast pipeline would be
 * the general answer, and it would be the wrong one here twice over: it is
 * megabytes against an editor bundle this repo measures in kilobytes (see
 * `fence_languages.ts` for the arithmetic that got `@codemirror/language-data`
 * rejected), and a full parse-and-reserialize replaces the author's text with
 * the printer's. So the passes below are the ones whose output is
 * indistinguishable from the input where they do not apply, and every one of
 * them is a whitespace or marker choice rather than a rewrite.
 *
 * ## What this will not do
 *
 * The interesting content is in the list of things deliberately left alone,
 * because each of them is a trap that a formatter is expected to fall into:
 *
 * - **Trailing whitespace on a non-blank line.** Two trailing spaces are a
 *   hard line break in CommonMark, so stripping them joins two lines the
 *   author kept apart. Deciding whether a given line *can* take a break needs
 *   paragraph context this pass does not have. Whitespace on a blank line and
 *   at the end of the file is meaningless and is removed; everywhere else it
 *   is left exactly as typed.
 * - **`*italic*` to `_italic_`.** Intraword `_` is emphasis in CommonMark and
 *   intraword `__` is not, so `snake__case__name` becoming `**case**` is not a
 *   rewrite of the author's style, it is a change of meaning. Emphasis markers
 *   are content here, and content is not this module's business.
 * - **Runs of blank lines.** Collapsing them to one is a matter of taste that
 *   produces a large diff and no readability, so blank lines are left alone.
 * - **Renumbering ordered lists.** Normalizing the delimiter (`1)` to `1.`) is
 *   inert — it renders the same whether the line is a list item or ordinary
 *   text — but renumbering changes what the list *says*, and a list that
 *   deliberately skips a number is often doing so on purpose.
 * - **Frontmatter and fenced code.** Not "mostly left alone": untouched,
 *   because YAML is its own language with its own formatter and a fence is
 *   verbatim by definition.
 *
 * ## The contract
 *
 * - **It never changes bytes outside the passes below.** A line the formatter
 *   has nothing to say about comes back identical.
 * - **It is idempotent.** Formatting a formatted document returns it unchanged,
 *   which is what lets the editor skip the transaction entirely and leaves no
 *   dirty dot on a page that was already tidy.
 * - **It returns the input unchanged if it cannot parse it.** A malformed fence
 *   is left as a fence rather than swallowed.
 */

/** Where a line sits, which decides whether any rule may touch it. */
type Region = "frontmatter" | "fence" | "text";

/**
 * Three or more of one marker, spaces allowed between, and nothing else.
 *
 * Checked before the list rules, and the order is load-bearing: `* * *` is a
 * thematic break, it also satisfies the bullet pattern, and rewriting its `*`
 * to `-` would turn a horizontal rule into the first item of a list.
 */
const THEMATIC_BREAK =
  /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/**
 * An ATX heading, and only an ATX heading.
 *
 * The space (or end of line) after the run of `#` is what separates a heading
 * from a paragraph starting with a hashtag, and the `{1,6}` bound is what
 * keeps `####### seven` a paragraph, exactly as CommonMark reads it. Neither
 * is a nicety: without the first, every page in a wiki that opens with
 * `#hashtag` would gain a heading; without the second, a seven-hash line would
 * lose four of them.
 */
const HEADING = /^(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;

/** A bullet, which needs real whitespace after the marker to be a bullet. */
const BULLET = /^([ \t]*)([*+-])([ \t]+)(.*)$/;

/**
 * An ordered list item. Nine digits, because CommonMark stops counting there
 * and a longer run is a paragraph.
 */
const ORDERED = /^([ \t]*)(\d{1,9})([.)])([ \t]+)(.*)$/;

/** A GitHub task box, whose state is a checkbox and whose spelling is not. */
const TASK_BOX = /^\[([ xX])\][ \t]+(.*)$/;

/** The `> ` markers in front of a line's own content. */
const QUOTE_PREFIX = /^( {0,3}(?:>[ \t]?)+)([\s\S]*)$/;

/** A fence opening: up to three spaces, three or more backticks or tildes. */
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/** A fence closing: the same character, at least as long, and nothing after. */
const FENCE_CLOSE = /^( {0,3})(`{3,}|~{3,})[ \t]*$/;

/** The narrowest a delimiter cell can be, so a table always reads as one. */
const MIN_DELIMITER = 3;

/** How a column's cells are set against their widest sibling. */
type Alignment = "none" | "left" | "center" | "right";

/** The smallest number of columns worth treating as a table. */
const MIN_COLUMNS = 2;

/**
 * Tidy a page.
 *
 * Returns its argument untouched when there is nothing to fix, so the caller
 * can compare and skip the edit — an unchanged result is the common case on an
 * already-formatted page and must not cost a transaction or a dirty dot.
 */
export function formatMarkdown(source: string): string {
  if (source === "") return source;
  // The editor holds LF only (`src/vault.ts` converts a CRLF file on the way in
  // and back on the way out), so splitting on \n is splitting on every line
  // break there is. A CR left on the end of a line would read as trailing
  // whitespace and be stripped, which is why this module does not accept CRLF.
  const lines = source.split("\n");
  const regions = classifyRegions(lines);
  const formatted = lines.map((line, index) =>
    regions[index] === "text" ? formatTextLine(line) : line
  );
  alignTables(formatted, regions);
  return closeDocument(formatted, regions);
}

/**
 * Mark every line as frontmatter, fence, or ordinary text.
 *
 * This runs before any rule does, and everything else reads the marks, so a
 * fence is a single decision taken once rather than a condition every pass
 * would have to re-derive — and cannot get subtly different between passes.
 */
function classifyRegions(lines: string[]): Region[] {
  const regions: Region[] = new Array(lines.length).fill("text");

  // Frontmatter only counts at the very top: a `---` in the middle of a page
  // is a thematic break or a setext underline, and treating either as a
  // delimiter would silently delete the rest of the file.
  if (lines[0]?.trim() === "---") {
    for (let index = 1; index < lines.length; index++) {
      const line = lines[index].trim();
      if (line === "---" || line === "...") {
        for (let fill = 0; fill <= index; fill++) regions[fill] = "frontmatter";
        break;
      }
    }
  }

  let fence: { marker: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index++) {
    if (regions[index] === "frontmatter") continue;
    // Fences are matched against the line's own content, so a fence inside a
    // blockquote is a fence. Getting this wrong the other way is the safe
    // direction: treating a quoted fence as prose would reformat code.
    const content = unquote(lines[index]);
    if (fence === null) {
      const open = FENCE_OPEN.exec(content);
      // A backtick fence's info string may not contain a backtick, or
      // ` ```js ` and ` ```py ` on one line would open a fence and swallow the
      // rest of the page. That is group 3 — group 2 is the run of backticks
      // itself, which is of course made of them.
      const isBacktick = open !== null && open[3].includes("`");
      if (open !== null && !isBacktick) {
        fence = { marker: open[2][0], length: open[2].length };
        regions[index] = "fence";
      }
      continue;
    }
    regions[index] = "fence";
    const close = FENCE_CLOSE.exec(content);
    if (
      close !== null && close[2][0] === fence.marker &&
      close[2].length >= fence.length
    ) {
      fence = null;
    }
  }
  return regions;
}

/** The line as its own content, with any blockquote markers taken off. */
function unquote(line: string): string {
  const match = QUOTE_PREFIX.exec(line);
  return match === null ? line : match[2];
}

/** Apply every single-line rule to a line that is ordinary text. */
function formatTextLine(line: string): string {
  // A line of nothing but whitespace is the one place trailing whitespace
  // cannot mean anything, and it is what an editor leaves behind after an
  // indented blank line between two paragraphs.
  if (isBlank(line)) return "";

  const quote = QUOTE_PREFIX.exec(line);
  const prefix = quote === null ? "" : quote[1];
  const rest = quote === null ? line : quote[2];

  // A blank line inside a blockquote still has to keep its markers, or the
  // paragraph before it and the one after it merge.
  if (isBlank(rest)) return prefix.replace(/[ \t]+$/, "");

  return prefix + (formatHeading(rest) ?? formatListMarker(rest) ?? rest);
}

/** One space after the `#`s, and no closing sequence that is not content. */
function formatHeading(line: string): string | null {
  const match = HEADING.exec(line);
  if (match === null) return null;
  let body = (match[2] ?? "").trim();
  // A closed ATX heading (`## Title ##`) is the same heading; the trailing run
  // of hashes is not part of the title. The leading space is what makes this
  // safe for a title that ends in a hash — `## C#` keeps it.
  body = body.replace(/[ \t]+#+[ \t]*$/, "").trim();
  return body === "" ? match[1] : `${match[1]} ${body}`;
}

/**
 * One marker style for every list, and the checkbox's own spelling.
 *
 * Only the *delimiter* is normalized. Choosing `-` over `*` and `.` over `)`
 * changes no rendering, which is the test a rule has to pass to belong here;
 * renumbering a list is the kind of change that can be undone by hand and not
 * noticed until someone reads the diff.
 */
function formatListMarker(line: string): string | null {
  if (THEMATIC_BREAK.test(line)) return null;

  const bullet = BULLET.exec(line);
  if (bullet !== null) {
    return `${bullet[1]}- ${formatTaskBox(bullet[4])}`;
  }
  const ordered = ORDERED.exec(line);
  if (ordered !== null) {
    return `${ordered[1]}${ordered[2]}. ${formatTaskBox(ordered[5])}`;
  }
  return null;
}

/** `- [x] `, whichever case the box was ticked in. */
function formatTaskBox(text: string): string {
  const match = TASK_BOX.exec(text);
  if (match === null) return text;
  return `[${match[1].toLowerCase()}] ${match[2]}`;
}

/**
 * Give every table the same column widths.
 *
 * Alignment is the only part of a table a reader sees, and it is pure
 * whitespace, so this is the highest-value pass in the file and the only one
 * that rewrites a line's contents. It is correspondingly strict about what
 * counts as a table: a block has to have a header row, a delimiter row under
 * it, the same number of cells in each, and real pipes to split on. Anything
 * else is left completely alone, so a stray `|` in a paragraph cannot
 * reformat the paragraph above it.
 */
function alignTables(lines: string[], regions: Region[]): void {
  let index = 0;
  while (index < lines.length) {
    const end = regions[index] === "text"
      ? tableExtent(lines, regions, index)
      : -1;
    if (end < 0) {
      index++;
      continue;
    }
    const alignments = delimiterAlignments(lines[index + 1]);
    const header = splitRow(lines[index]);
    const body: string[][] = [];
    for (let row = index + 2; row <= end; row++) {
      body.push(splitRow(lines[row]));
    }
    const widths = columnWidths(header, body);

    lines[index] = renderRow(header, widths, alignments);
    lines[index + 1] = renderDelimiterRow(widths, alignments);
    for (let row = index + 2; row <= end; row++) {
      lines[row] = renderRow(splitRow(lines[row]), widths, alignments);
    }
    index = end + 1;
  }
}

/** The last line of the table starting at `start`, or -1 if there is none. */
function tableExtent(
  lines: string[],
  regions: Region[],
  start: number,
): number {
  const header = splitRow(lines[start]);
  // A pipe table is delimited by pipes. Requiring one on the header is what
  // stops a `---` underline under a paragraph from being read as a
  // single-column table, and requiring two columns stops a lone `|` from
  // starting one.
  if (!lines[start].includes("|") || header.length < MIN_COLUMNS) return -1;
  if (start + 1 >= lines.length || regions[start + 1] !== "text") return -1;
  const delimiter = splitRow(lines[start + 1]);
  if (
    !lines[start + 1].includes("|") || delimiter.length !== header.length
  ) {
    return -1;
  }
  if (delimiter.some((cell) => !isDelimiterCell(cell))) return -1;

  let end = start + 1;
  while (end + 1 < lines.length && regions[end + 1] === "text") {
    const cells = splitRow(lines[end + 1]);
    if (!lines[end + 1].includes("|")) break;
    if (cells.length !== header.length) break;
    // A blockquote row would need its markers carried through every cell
    // operation, and a quoted table is rare enough that guessing is worse than
    // leaving it alone.
    if (QUOTE_PREFIX.exec(lines[end + 1])?.[1]) break;
    end++;
  }
  return end;
}

/** The alignment each delimiter cell asks for. */
function delimiterAlignments(line: string): Alignment[] {
  return splitRow(line).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (left) return "left";
    if (right) return "right";
    return "none";
  });
}

/** A delimiter cell: dashes, with a colon on one end, a both, or neither. */
function isDelimiterCell(cell: string): boolean {
  return /^:?-+:?$/.test(cell) && cell.replace(/:/g, "").length >= 1;
}

/**
 * The widest cell per column, over the header and every body row.
 *
 * The delimiter row is measured too, at `MIN_DELIMITER`, so a two-column table
 * of short cells does not collapse to a rule too narrow to read as a rule.
 */
function columnWidths(header: string[], body: string[][]): number[] {
  return header.map((cell, column) => {
    let width = Math.max(cell.length, MIN_DELIMITER);
    for (const row of body) {
      width = Math.max(width, (row[column] ?? "").length);
    }
    return width;
  });
}

/**
 * One table row, every cell set to its column's width.
 *
 * Widths are counted in `String.length` rather than display cells, so a table
 * with wide characters in it pads by the wrong amount and is still correct —
 * the cells are the same, only the rule underneath is uneven.
 */
function renderRow(
  cells: string[],
  widths: number[],
  alignments: Alignment[],
): string {
  const rendered = widths.map((width, column) =>
    setCell(cells[column] ?? "", width, alignments[column] ?? "none")
  );
  return `| ${rendered.join(" | ")} |`;
}

/** The dashed row, one cell per column and as wide as its column. */
function renderDelimiterRow(widths: number[], alignments: Alignment[]): string {
  const rendered = widths.map((width, column) =>
    delimiterCell(width, alignments[column] ?? "none")
  );
  return `| ${rendered.join(" | ")} |`;
}

/** The dashed cell under a column, carrying that column's colons. */
function delimiterCell(width: number, alignment: Alignment): string {
  const dashes = Math.max(width, MIN_DELIMITER);
  switch (alignment) {
    case "left":
      return `:${"-".repeat(dashes - 1)}`;
    case "right":
      return `${"-".repeat(dashes - 1)}:`;
    case "center":
      return `:${"-".repeat(Math.max(dashes - 2, 1))}:`;
    default:
      return "-".repeat(dashes);
  }
}

/** A content cell, set to the width its column was measured at. */
function setCell(text: string, width: number, alignment: Alignment): string {
  const padding = Math.max(width - text.length, 0);
  switch (alignment) {
    case "right":
      return " ".repeat(padding) + text;
    case "center": {
      const before = Math.floor(padding / 2);
      return " ".repeat(before) + text + " ".repeat(padding - before);
    }
    default:
      return text + " ".repeat(padding);
  }
}

/**
 * Split a row on its unescaped pipes.
 *
 * A `\|` is content and stays in the cell, which is what keeps a cell holding
 * a regex or a shell pipeline from being counted as two columns. A pipe inside
 * a code span is *not* seen — that needs a code-span scan this pass does not
 * do — but the cost of being wrong is a row with the wrong cell count, which
 * fails `tableExtent` and leaves the block alone. Being wrong here is loud and
 * harmless, rather than a quietly mangled table.
 */
function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (endsWithUnescapedPipe(text)) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "\\" && text[index + 1] === "|") {
      current += "\\|";
      index++;
      continue;
    }
    if (character === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current.trim());
  return cells;
}

/** Whether the final pipe is a delimiter rather than an escaped `\|`. */
function endsWithUnescapedPipe(text: string): boolean {
  if (!text.endsWith("|")) return false;
  let backslashes = 0;
  for (
    let index = text.length - 2;
    index >= 0 && text[index] === "\\";
    index--
  ) {
    backslashes++;
  }
  return backslashes % 2 === 0;
}

/**
 * End the document on exactly one newline, with no blank lines before it.
 *
 * Only blank lines in the text region are dropped. A document that ends inside
 * a fence keeps its trailing newlines, because there they are the fence's
 * content and the closing ``` is what ends the file.
 */
function closeDocument(lines: string[], regions: Region[]): string {
  const body = lines.slice();
  // A document ending in a newline splits into one final empty element, and
  // that element is the newline rather than a line. It goes whatever region it
  // was marked, because keeping it and appending another newline is how an
  // unterminated fence ends up with a blank line added inside it — a change
  // to the code, from a function that promised to make none.
  if (body.length > 0 && body[body.length - 1] === "") body.pop();
  let end = body.length;
  while (
    end > 0 && regions[end - 1] === "text" && isBlank(body[end - 1])
  ) {
    end--;
  }
  const kept = body.slice(0, end);
  return kept.length === 0 ? "" : `${kept.join("\n")}\n`;
}

/** Whether a line has no content at all. */
function isBlank(line: string): boolean {
  return line.trim() === "";
}
