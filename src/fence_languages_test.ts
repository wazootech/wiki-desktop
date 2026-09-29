/**
 * Which grammar a fenced code block gets, and what happens when there is none.
 *
 * The mapping is tested directly, because `fenceLanguage` returns a `Language`
 * and that is the whole decision. What is *not* tested here is the resulting
 * highlight, and the reason is worth recording rather than working around: a
 * nested language only appears in the tree once the parse-context work units
 * run, and nothing but a view drives those. Probed directly —
 * `ensureSyntaxTree` and `syntaxTree(doc.length, 5000)` both return the flat
 * `FencedCode > CodeText` for a fence whose language is definitely resolved and
 * definitely returned. So a tree-shape assertion here would be asserting the
 * absence of the thing it cannot see.
 *
 * What replaces it: the wiring is asserted against the source, the way the
 * other editor tests in this repo do for the same reason, and the rendering is
 * checked in the real webview by `deno task check:appearance` and by opening
 * the app.
 */
import { join } from "node:path";

import { FENCE_LANGUAGE_NAMES, fenceLanguage } from "./fence_languages.ts";

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

Deno.test("an info string with no grammar yields none, and nothing throws", () => {
  // The half of the contract that keeps a typo safe. An unlabelled fence, a
  // misspelled one, a language with no grammar here, and a half-typed word are
  // all the same case, and all of them must leave the block as it rendered
  // before this existed: a plain --syntax-code span. Nothing may throw, because
  // a user typing a language mid-word is doing an ordinary text edit.
  for (
    const info of [
      "",
      "   ",
      "nosuchlanguage",
      "bashh",
      "python2",
      // The pair this module used to return null for, and no longer does —
      // see the reversal note below. A near-miss must still come back empty.
      "sparql1.1",
      "ttl2",
      "\t",
      // The one name that reaches past the record: an object literal inherits
      // `constructor` from Object.prototype, and it is already lower-case, so
      // it is the single string in the alphabet a plain lookup resolves to
      // something. The others -- toString, valueOf, hasOwnProperty -- are
      // camelCase and cannot survive the case-insensitive read, which is why
      // this is one test case rather than a family of them.
      "constructor",
      "Object",
      "CONSTRUCTOR",
    ]
  ) {
    assertEqual(
      fenceLanguage(info),
      null,
      `${JSON.stringify(info)} yields no grammar`,
    );
  }
});

Deno.test("every language the vault uses resolves to a grammar", () => {
  // The census in #7: bash 47, yaml 29, sparql 19, python 8, json 4, toml 3,
  // powershell 3, then the singletons. These are the fences that stop being
  // monochrome when this lands.
  for (
    const name of [
      "bash",
      "yaml",
      "sparql",
      "python",
      "json",
      "toml",
      "powershell",
      "javascript",
      "jsx",
      "typescript",
      "tsx",
      "html",
      "xml",
      "turtle",
    ]
  ) {
    assert(
      fenceLanguage(name) !== null,
      `\`\`\`${name} reaches a grammar`,
    );
  }
});

Deno.test("the info string is its first token, read case-insensitively", () => {
  // A real page in this app's own fixtures is ```ts twoslash title=example,
  // where the language is the first word and the rest belong to a tool.
  assert(
    fenceLanguage("ts twoslash title=example") !== null,
    "a fence with a language and trailing options is still highlighted",
  );
  assertEqual(
    fenceLanguage("BASH"),
    fenceLanguage("bash"),
    "the name is read case-insensitively",
  );
  assertEqual(
    fenceLanguage("bash, title=x"),
    fenceLanguage("bash"),
    "a comma-separated option list does not hide the language",
  );
});

Deno.test("ts is its own grammar, not a fallback to javascript", () => {
  // Worth pinning: mapping `ts` to javascript would highlight, so a regression
  // here would be invisible in the app until someone noticed annotations were
  // being coloured as something else.
  assert(
    fenceLanguage("ts") !== fenceLanguage("javascript"),
    "typescript is a distinct language from javascript",
  );
  assertEqual(
    fenceLanguage("ts"),
    fenceLanguage("typescript"),
    "ts is the alias of typescript",
  );
});

Deno.test("the aliases a wiki actually writes resolve", () => {
  for (
    const [alias, canonical] of [
      ["sh", "bash"],
      ["shell", "bash"],
      ["zsh", "bash"],
      ["py", "python"],
      ["yml", "yaml"],
      ["js", "javascript"],
      ["ps1", "powershell"],
      ["pwsh", "powershell"],
      ["rq", "sparql"],
      ["ttl", "turtle"],
    ] as const
  ) {
    assertEqual(
      fenceLanguage(alias),
      fenceLanguage(canonical),
      `${alias} is the same grammar as ${canonical}`,
    );
  }
});

Deno.test("sparql and turtle are present, and the reversal is the record", () => {
  // These two were absent by decision once: "neither has a maintained
  // CodeMirror 6 grammar, and a third-party one is not a dependency this app
  // takes on for 15% of its fences". Both halves were wrong, and the mistake
  // was in the search rather than the taste — it looked for a *lezer* grammar,
  // while `@codemirror/legacy-modes` (already a dependency, for `shell`,
  // `powershell` and `toml`) carries `mode/sparql` and `mode/turtle`, and
  // `@codemirror/language-data` is itself a registry that loads those two out
  // of that package. So the assertion is inverted here rather than deleted:
  // 20 of the vault's 124 named fences now take a colour, and a future change
  // that drops them has to say why in this test.
  assert(
    FENCE_LANGUAGE_NAMES.includes("sparql"),
    "sparql is highlighted by the ported mode in @codemirror/legacy-modes",
  );
  assert(
    FENCE_LANGUAGE_NAMES.includes("turtle"),
    "turtle is highlighted by the ported mode in @codemirror/legacy-modes",
  );
});

Deno.test("the editor hands this lookup to the Markdown parser", async () => {
  // The wiring, asserted against the source because the rendering cannot be
  // asserted without a view. If this stops matching, every fence is monochrome
  // again and nothing else in this file would notice.
  const source = await Deno.readTextFile(
    join(import.meta.dirname!, "editor.ts"),
  );
  assert(
    /markdown\(\{ codeLanguages: fenceLanguage \}\)/.test(source),
    "the markdown parser is given this lookup as its code languages",
  );
  assert(
    /import \{ fenceLanguage \} from "\.\/fence_languages\.ts"/.test(source),
    "and the editor uses the one implementation, not a second copy",
  );
});
