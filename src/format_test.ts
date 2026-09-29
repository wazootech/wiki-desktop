/**
 * What formatting does to a page, and — mostly — what it refuses to do.
 *
 * The refusals are the tests that matter. A formatter is a program that edits
 * somebody's writing, and the only interesting failures are the ones where it
 * edits something it should not have: a line of code inside a fence, the
 * trailing two spaces that hold a hard line break together, a page's
 * frontmatter. Each of those has a test below that fails if a pass ever grows
 * to reach it.
 *
 * Idempotence is asserted as its own property rather than implied by the cases.
 * The editor skips the transaction entirely when the text comes back
 * unchanged, and a formatter that changed something on a second pass would
 * leave a dirty dot on a page that was already tidy, every single time.
 */
import { formatMarkdown } from "./format.ts";

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

/** Format, and insist the result is a fixed point. */
function tidy(source: string, expected: string, message: string) {
  const once = formatMarkdown(source);
  assertEqual(once, expected, message);
  assertEqual(
    formatMarkdown(once),
    once,
    `${message} — formatting the result again changed it, so the pass is not idempotent`,
  );
}

Deno.test("fenced code is never touched, and the fence decides the boundary", () => {
  // The single most important property here. Everything inside a fence is
  // verbatim by definition, and a wiki page carries a fence containing a
  // Markdown example often enough that a pass reaching inside one would
  // corrupt a real page rather than an artificial one.
  tidy(
    "```md\n##   not  a heading\n*  not  a bullet\n```\n",
    "```md\n##   not  a heading\n*  not  a bullet\n```\n",
    "a fence's contents are left exactly as they were",
  );

  // The fence ends at the run that closes it, and the page resumes after it.
  tidy(
    "```\n##  inside\n```\n##   after\n",
    "```\n##  inside\n```\n## after\n",
    "only the lines outside the fence are formatted",
  );

  // A longer fence is not closed by a shorter run, which is the whole reason
  // CommonMark counts the characters rather than looking for three backticks.
  tidy(
    "````\n```\n##  still inside\n```\n````\n##  after\n",
    "````\n```\n##  still inside\n```\n````\n## after\n",
    "a shorter run inside a longer fence does not close it",
  );

  // Tildes are the other fence character and have their own closing rule.
  tidy(
    "~~~\n##  not a heading\n~~~\n",
    "~~~\n##  not a heading\n~~~\n",
    "a tilde fence is a fence",
  );

  // An unterminated fence is still a fence for the rest of the file. And the
  // trailing newline must not be turned into a blank line *inside* it, which
  // would be a change to the code from a function that promised to make none.
  tidy(
    "```\n##  not a heading\n",
    "```\n##  not a heading\n",
    "an unterminated fence does not gain a blank line before its end",
  );

  // A fence in a blockquote is a fence. Missing this one reformats code that a
  // wiki page quotes from somewhere else, which is common.
  tidy(
    "> ```\n> ##  not a heading\n> ```\n",
    "> ```\n> ##  not a heading\n> ```\n",
    "a fence inside a blockquote is left alone",
  );

  // A table inside a fence is a table-shaped piece of code, and aligning it
  // would change the example the page is showing.
  tidy(
    "```\n| a | b |\n|---|---|\n```\n",
    "```\n| a | b |\n|---|---|\n```\n",
    "a table inside a fence is not realigned",
  );
});

Deno.test("a backtick in the info string means the line is not a fence", () => {
  // CommonMark forbids a backtick in a backtick fence's info string, precisely
  // so that two fences on one line cannot swallow the page between them. Read
  // as a fence, everything after would be marked verbatim and left alone;
  // read correctly, the heading below is a heading and gets formatted.
  const formatted = formatMarkdown("```js `x`\n##  a heading\n");
  assert(
    formatted.includes("## a heading"),
    "a line whose info string carries a backtick is a paragraph, not a fence",
  );
});

Deno.test("frontmatter is untouched, and only frontmatter at the very top", () => {
  // YAML is its own language with its own formatter. Rewriting its indentation
  // here would change a page's meaning, since indentation is how YAML nests.
  tidy(
    "---\ntitle:   a page\ntags:   [  one,two ]\n---\n##  H\n",
    "---\ntitle:   a page\ntags:   [  one,two ]\n---\n## H\n",
    "frontmatter keeps its own spacing and the body after it is still formatted",
  );

  // `...` closes frontmatter as well as `---`.
  tidy(
    "---\na:   1\n...\n##  H\n",
    "---\na:   1\n...\n## H\n",
    "a document-end marker closes frontmatter too",
  );

  // The dangerous one. A `---` halfway down a page is a thematic break or a
  // setext underline; treating it as an opening delimiter would mark the rest
  // of the file as frontmatter and silently leave every heading in it alone.
  tidy(
    "a paragraph\n---\n##  H\n",
    "a paragraph\n---\n## H\n",
    "a rule halfway down a page is not frontmatter",
  );
});

Deno.test("headings are spaced, and only the things that are headings", () => {
  tidy(
    "##   Title  ##\n",
    "## Title\n",
    "one space after the hashes, no closing run",
  );
  tidy(
    "#\tTabbed\n",
    "# Tabbed\n",
    "a tab after the hashes is a separator too",
  );
  tidy("##\n", "##\n", "an empty heading stays empty");
  tidy("###### six\n", "###### six\n", "six hashes is a heading");
  tidy("####### seven\n", "####### seven\n", "seven hashes is a paragraph");

  // The two that would fire on ordinary prose. A wiki page opens with
  // `#hashtag` often enough that treating it as a heading would be a
  // data-loss bug, and seven hashes is a paragraph by CommonMark's own count.
  tidy(
    "#hashtag\n",
    "#hashtag\n",
    "a hash with no space after it is not a heading",
  );

  // A title may end in a hash. The closing run is only a closing run when it
  // is preceded by a space, which is the rule that keeps `## C#` intact.
  tidy("## C#\n", "## C#\n", "a title ending in a hash keeps it");
  tidy(
    "## Title #\n",
    "## Title\n",
    "a space and a hash at the end is a closing run",
  );
});

Deno.test("a thematic break is not a list, which is the order that matters", () => {
  // `* * *` satisfies the bullet pattern — a marker, a space, then content. If
  // the list rule ran first it would become `- * *`, which is the first item
  // of a list and no longer a rule at all. The check has to come first.
  tidy("* * *\n", "* * *\n", "a spaced rule of asterisks stays a rule");
  tidy("- - -\n", "- - -\n", "a spaced rule of dashes stays a rule");
  tidy(
    "***\n",
    "***\n",
    "a run of markers with no space has no marker to normalize",
  );
  tidy("---\n", "---\n", "a setext underline is not a bullet");
});

Deno.test("list markers are normalized without touching the list", () => {
  tidy(
    "*  a\n+  b\n-   c\n",
    "- a\n- b\n- c\n",
    "every bullet marker becomes a dash",
  );
  tidy(
    "\t*  a\n",
    "\t- a\n",
    "indentation is preserved and the marker still changes",
  );

  // Only the delimiter. `1)` and `1.` render the same, so this is inert whether
  // the line turns out to be a list item or ordinary text — which is the test
  // a rule has to pass to live here.
  tidy(
    "1)  a\n2)  b\n",
    "1. a\n2. b\n",
    "an ordered list's delimiter is normalized",
  );

  // Renumbering is not, because a list that deliberately skips a number is
  // often doing so on purpose and only a diff would show it.
  tidy("1. a\n3. c\n", "1. a\n3. c\n", "ordered lists are not renumbered");
  tidy(
    "2024. a year\n",
    "2024. a year\n",
    "a number that is not a list is not renumbered either",
  );
});

Deno.test("task boxes keep their state and their spelling", () => {
  tidy(
    "- [ ] todo\n- [x] done\n",
    "- [ ] todo\n- [x] done\n",
    "a task list is left alone",
  );
  tidy(
    "-   [X]  done\n",
    "- [x] done\n",
    "the box is spaced to one and the state lowercased",
  );
  tidy(
    "1.  [x]  done\n",
    "1. [x] done\n",
    "an ordered task box is normalized the same way",
  );
  // `[X]` is only a task box when something follows it; alone it is text.
  tidy("- [x]\n", "- [x]\n", "a bare box with no text after it is left alone");
});

Deno.test("trailing whitespace goes only where it cannot be a hard break", () => {
  // Two trailing spaces are a hard line break in CommonMark. Stripping them
  // joins two lines the author deliberately kept apart, and no amount of
  // tidying elsewhere makes that an acceptable trade.
  tidy(
    "line one  \nline two\n",
    "line one  \nline two\n",
    "a hard line break survives",
  );

  // A blank line's whitespace is nothing at all — it is what an editor leaves
  // after an indented blank line between two paragraphs — so it goes.
  tidy(
    "a   \n   \nb\n",
    "a   \n\nb\n",
    "whitespace on a blank line is removed",
  );
});

Deno.test("blank lines are left alone", () => {
  // Collapsing a run of them to one is a matter of taste, and it produces a
  // large diff and no readability. A page that separates its sections with two
  // blank lines meant to.
  tidy("a\n\n\n\nb\n", "a\n\n\n\nb\n", "a run of blank lines is not collapsed");
});

Deno.test("tables are aligned, and only real tables are", () => {
  tidy(
    "| a | bbbb |\n|---|---|\n| ccc | d |\n",
    "| a   | bbbb |\n| --- | ---- |\n| ccc | d    |\n",
    "every column is as wide as its widest cell",
  );

  // A rule under a one-dash cell is too thin to read as a rule, so the
  // delimiter has a floor of its own.
  tidy(
    "| a | b |\n| - | - |\n",
    "| a   | b   |\n| --- | --- |\n",
    "a thin delimiter is widened to a readable rule",
  );

  // The colons are alignment, not decoration, so they survive and move to the
  // edge of the widened cell.
  tidy(
    "| a | b |\n|:--|--:|\n| c | d |\n",
    "| a   |   b |\n| :-- | --: |\n| c   |   d |\n",
    "a right-aligned column sets its cells to the right",
  );
  // Centering is centering: the cell is set in the middle of the column the
  // delimiter widened to, not left alone as though the column were its own
  // width.
  tidy(
    "| a | b |\n|:-:|--:|\n",
    "|  a  |   b |\n| :-: | --: |\n",
    "a centered column sets its cell to the middle of the column",
  );

  // A pipe inside a cell is content, and a cell holding a regex or a shell
  // pipeline is exactly why it can be escaped. Counting it as a column would
  // change the cell.
  tidy(
    "| a | b |\n|---|---|\n| x \\| y | z |\n",
    "| a      | b   |\n| ------ | --- |\n| x \\| y | z   |\n",
    "an escaped pipe stays inside its cell",
  );

  // The guard on the other side: something pipe-shaped that is not a table.
  // A `---` under a paragraph is a setext underline, and reformatting it as a
  // one-column table would invent a table the author did not write.
  tidy(
    "Title\n=====\n\nBody\n-----\n",
    "Title\n=====\n\nBody\n-----\n",
    "setext headings are left alone",
  );
  tidy(
    "| one |\n| --- |\n",
    "| one |\n| --- |\n",
    "a single column is not a table",
  );

  // A body row whose cell count disagrees with the delimiter ends the table
  // rather than being padded into shape, so the row is left exactly as typed.
  tidy(
    "| a | b |\n|---|---|\n| only one |\n",
    "| a   | b   |\n| --- | --- |\n| only one |\n",
    "a body row of the wrong width ends the table instead of being padded",
  );
});

Deno.test("blockquote markers are carried through every rule", () => {
  tidy("> ##  H\n", "> ## H\n", "a heading inside a quote is still a heading");
  tidy("> *  x\n", "> - x\n", "a list inside a quote is still a list");

  // A blank quoted line keeps its markers. Dropping them would end the
  // blockquote and merge the paragraph before it with the one after.
  tidy(
    "> a\n>\n> b\n",
    "> a\n>\n> b\n",
    "a blank quoted line keeps its marker",
  );

  // A quoted table is left alone rather than guessed at, because every cell
  // operation would have to carry the markers through.
  tidy(
    "> | a | b |\n> |---|---|\n",
    "> | a | b |\n> |---|---|\n",
    "a quoted table is left alone",
  );
});

Deno.test("a document ends on exactly one newline", () => {
  tidy("a\n\n\n", "a\n", "trailing blank lines go and one newline is added");
  tidy("a", "a\n", "a file with no final newline gets one");
  tidy("a\n", "a\n", "a file that already ends correctly is unchanged");
  tidy("", "", "an empty document stays empty");
  tidy("\n\n", "", "a document of only blank lines becomes empty");
});

Deno.test("an already-tidy page comes back byte-identical", () => {
  // This is what lets the editor skip the transaction and leave no dirty dot.
  // A page that is already formatted is the common case, not the interesting
  // one, and it must cost nothing.
  const tidy_ = [
    "---",
    "title: A page",
    "---",
    "",
    "# A page",
    "",
    "Some text, and a [link](other.md).",
    "",
    "## A list",
    "",
    "- one",
    "- two",
    "",
    "1. first",
    "2. second",
    "",
    "## A table",
    "",
    "| name | value |",
    "| :--- | ----: |",
    "| a    |     1 |",
    "",
    "```md",
    "##   not a heading",
    "```",
    "",
  ].join("\n");
  assertEqual(
    formatMarkdown(tidy_),
    tidy_,
    "a page that is already formatted is returned unchanged",
  );
});
