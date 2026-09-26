/**
 * Which grammar highlights a fenced code block, if any.
 *
 * Its own module so the mapping can be tested without a DOM: the answer is a
 * `Language`, so `EditorState` plus `syntaxTree` is enough to check that a
 * fence really does get parsed and that an unknown one really does not — the
 * same reason `src/vault.ts` and `src/wiki_config.ts` are separate from the
 * page.
 */
import { type Language, StreamLanguage } from "@codemirror/language";
import { htmlLanguage } from "@codemirror/lang-html";
import { jsonLanguage } from "@codemirror/lang-json";
import {
  javascriptLanguage,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage,
} from "@codemirror/lang-javascript";
import { pythonLanguage } from "@codemirror/lang-python";
import { xmlLanguage } from "@codemirror/lang-xml";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";

/**
 * Fence info strings to a grammar, for the languages this vault actually uses.
 *
 * A hand-picked subset rather than `@codemirror/language-data`, which measured
 * 1,527 KB against this editor's 514 KB — 3.0x — and whose `load()` is a
 * dynamic import that `deno bundle` inlines anyway, so a grammar that never
 * runs still costs its bytes. This subset measured +83 KB minified and
 * +33 KB gzipped, and covers 101 of the vault's 123 named fences.
 *
 * `sparql` (18 fences) and `turtle` (1) are the gap. Neither has a maintained
 * CodeMirror 6 grammar, and a third-party one is not a dependency this app
 * takes on for 15% of its fences. They stay monochrome, which is what every
 * fence looked like before.
 */
const FENCE_LANGUAGES: Record<string, Language> = {
  // StreamLanguage grammars, from one package.
  bash: StreamLanguage.define(shell),
  powershell: StreamLanguage.define(powerShell),
  toml: StreamLanguage.define(toml),
  // lezer grammars, taken as the bare `Language` each package exports rather
  // than the `LanguageSupport` wrapper, so nothing pulls in an autocomplete
  // source or the language-data registry behind it.
  python: pythonLanguage,
  yaml: yamlLanguage,
  javascript: javascriptLanguage,
  jsx: jsxLanguage,
  typescript: typescriptLanguage,
  tsx: tsxLanguage,
  json: jsonLanguage,
  html: htmlLanguage,
  xml: xmlLanguage,
};

/**
 * The grammar for a fence, or null when there is nothing to highlight it with.
 *
 * The info string is free text and this app's own fixture set shows why: a real
 * page carries ` ```ts twoslash title=example `, where the language is the
 * first word and the rest are a tool's options. So only the first token is
 * read, and it is read case-insensitively.
 *
 * Returning null is the important half. An unlabelled fence, a misspelled one,
 * a language with no grammar here, and a half-typed word are all the same case
 * to this function, and all of them fall through to exactly what the editor
 * rendered before this existed: a plain `--syntax-code` block. Nothing about
 * highlighting gates on the info string, so adding, removing or mistyping it
 * stays an ordinary text edit.
 */
export function fenceLanguage(info: string): Language | null {
  const name = info.trim().split(/[\s,]/, 1)[0].toLowerCase();
  if (name === "") return null;
  // The aliases a wiki actually writes, so a fence is not monochrome just
  // because it said `sh` where the table above says `bash`.
  switch (name) {
    case "sh":
    case "shell":
    case "zsh":
      return FENCE_LANGUAGES.bash;
    case "py":
      return FENCE_LANGUAGES.python;
    case "yml":
      return FENCE_LANGUAGES.yaml;
    case "js":
      return FENCE_LANGUAGES.javascript;
    case "ts":
      return FENCE_LANGUAGES.typescript;
    case "ps1":
    case "pwsh":
      return FENCE_LANGUAGES.powershell;
    default:
      return FENCE_LANGUAGES[name] ?? null;
  }
}

/** The info strings this module can highlight, for tests and for the README. */
export const FENCE_LANGUAGE_NAMES: readonly string[] = Object.keys(
  FENCE_LANGUAGES,
).sort();
