/**
 * The claim this feature rests on, tested against the thing it must agree with.
 *
 * `src/shacl.ts` evaluates frontmatter in the app rather than calling
 * `wiki check`, and that is only defensible if the two say the same thing. This
 * test is what makes it defensible: it runs the real `wiki` CLI over a copy of a
 * vault, parses the report, runs this app's evaluator over the same pages, and
 * fails if the two sets of results differ in any focus node, path, or message.
 *
 * #8 is explicit that regexing pyshacl's text report is the coupling that
 * breaks silently when the wording changes. That is a real objection, and it is
 * why the parsing lives here and not in the app: **this** coupling is allowed to
 * break, and when it does the test fails loudly. The app itself never reads the
 * report — it reads the shape documents and evaluates them, which is a
 * structured input that does not change its wording.
 *
 * ## Which vault
 *
 * `testdata/shacl-vault/` by default, and a real one when
 * `WIKI_DESKTOP_VAULT` names it. The fixture used to be the *only* way to run
 * this, which is another way of saying it did not run: it was skipped unless
 * someone exported a path, so a drift between the panel and the build would
 * have been found by whoever noticed first rather than by CI. The fixture is
 * small, it is committed, and it is built to be hard to pass by accident — see
 * its README.
 *
 * The mutations are derived from the shapes rather than written out, because a
 * test that names `wiki/Linked_Markdown.md` is a test of one vault's contents.
 * Each case below says what to break and the test works out which key that is,
 * so the same assertions run over the fixture and over a real vault.
 *
 * ## When the CLI is missing
 *
 * `WIKI_AGREEMENT_REQUIRED=1` turns "the `wiki` CLI is not on the PATH" from a
 * printed note into a failure. CI sets it, because a test that skips when its
 * subject is absent is a test that reports success for having done nothing —
 * which is the exact failure mode this file exists to rule out.
 *
 *     deno task test:agreement
 *     WIKI_DESKTOP_VAULT=/path/to/vault deno task test:agreement
 *
 * It needs `--allow-run=wiki`, which `deno task test` does not grant, so it is
 * its own task and its own CI step. A separate step also means the Python
 * install it depends on is scoped to the one job that needs it.
 */
import {
  applyEdit,
  entryFor,
  readFrontmatter,
  removeEdit,
  setValueEdit,
} from "./frontmatter.ts";
import { buildFieldModel, type VaultVocabulary } from "./fields.ts";
import { validate } from "./shacl.ts";
import { parseShape, type ShapeDeclaration, TermResolver } from "./shapes.ts";
import { listVaultFiles } from "./vault.ts";
import { documentIri, readWikiConfig, type WikiConfig } from "./wiki_config.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** One result, reduced to the three things both sides can be compared on. */
interface Finding {
  page: string;
  path: string;
  message: string;
}

/**
 * The vault under test: the committed fixture unless one is named.
 *
 * Resolved from `import.meta.url` rather than the working directory, so
 * `deno task test` from anywhere in the repo finds it.
 */
function vaultRoot(): string {
  const named = Deno.env.get("WIKI_DESKTOP_VAULT");
  if (named !== undefined && named !== "") return named;
  return new URL("../testdata/shacl-vault/", import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/, "$1")
    .replace(/\/$/, "");
}

/**
 * Whether a missing `wiki` CLI should fail rather than print a note.
 *
 * On a developer's machine, where the CLI may simply not be installed, a note
 * is the right outcome. In CI it is not: the job installed the CLI on purpose,
 * and a skip there would be green for no reason.
 */
function cliRequired(): boolean {
  return Deno.env.get("WIKI_AGREEMENT_REQUIRED") === "1";
}

/** The `wiki` binary, or null when it cannot be run. */
async function wikiCommand(): Promise<string | null> {
  try {
    const found = await new Deno.Command("wiki", {
      args: ["--version"],
      stdout: "piped",
      stderr: "null",
    }).output();
    return found.success ? "wiki" : null;
  } catch (error) {
    // Two quite different reasons land here, and the message says which,
    // because "not on the PATH" sent someone looking at their shell when the
    // real problem was a missing `--allow-run=wiki` in the task.
    if (error instanceof Deno.errors.NotCapable) {
      return null;
    }
    throw error;
  }
}

/**
 * Both sides name a focus node the same way, which took one change to arrange.
 *
 * `wiki check` binds `wiki:` to the site's base and prints `wiki:Gamma`, so an
 * app that quoted its own `wiki/Gamma.md` in a message would be reporting on the
 * same subject in words that differ for that reason alone — and a fallback
 * message quotes the focus node by construction. The app therefore anchors on
 * the page's IRI, which `documentIri` derives the way `_file_slug` in
 * `src/wiki/graph.py` does, and the two strings match without a translation
 * here.
 */

/** The results `wiki check -v` printed, read back out of its report. */
function parseReport(report: string): Finding[] {
  const findings: Finding[] = [];
  let focus: string | null = null;
  let path: string | null = null;
  for (const line of report.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("Focus Node:")) {
      focus = trimmed.slice("Focus Node:".length).trim();
    } else if (trimmed.startsWith("Result Path:")) {
      path = trimmed.slice("Result Path:".length).trim();
    } else if (trimmed.startsWith("Message:") && focus !== null) {
      findings.push({
        page: focus,
        path: path ?? "",
        message: trimmed.slice("Message:".length).trim(),
      });
      focus = null;
      path = null;
    }
  }
  return findings;
}

/** The same results, from the evaluator in this app. */
function appFindings(
  pages: Map<string, string>,
  vocabulary: VaultVocabulary,
  resolver: TermResolver,
  config: WikiConfig,
): Finding[] {
  const findings: Finding[] = [];
  for (const [path, text] of pages) {
    const { frontmatter } = readFrontmatter(text);
    if (frontmatter === null) continue;
    const model = buildFieldModel(frontmatter.mapping, vocabulary, resolver);
    // The app anchors a result on the page's IRI, which is the named node the
    // report also names, rather than on a blank node whose label changes.
    const focus = documentIri(path, config);
    if (focus === null) continue;
    for (const result of validate(model, resolver, focus).violations) {
      findings.push({
        page: resolver.curie(focus) ?? focus,
        path: result.resultPath,
        message: result.message,
      });
    }
  }
  return findings;
}

/** Read every page of a vault, keyed by vault path. */
async function readPages(root: string): Promise<Map<string, string>> {
  const pages = new Map<string, string>();
  for (const file of await listVaultFiles(root)) {
    if (!file.isMarkdown) continue;
    pages.set(
      file.path,
      await Deno.readTextFile(`${root}/${file.path}`),
    );
  }
  return pages;
}

/** The shape documents of a vault, read the way the app reads them. */
function readVocabulary(
  pages: Map<string, string>,
  config: WikiConfig,
): VaultVocabulary {
  const resolver = new TermResolver(config.context);
  const shapes: ShapeDeclaration[] = [];
  for (const [path, text] of pages) {
    const shape = parseShape(text, path, resolver);
    if (shape !== null) shapes.push(shape);
  }
  const observedKeys: Record<string, number> = {};
  for (const text of pages.values()) {
    const { frontmatter } = readFrontmatter(text);
    if (frontmatter === null) continue;
    for (const entry of frontmatter.mapping.entries) {
      if (entry.key === "type") continue;
      observedKeys[entry.key] = (observedKeys[entry.key] ?? 0) + 1;
    }
  }
  return { context: config.context, shapes, observedKeys };
}

/**
 * The key to break, found from the shapes rather than named here.
 *
 * It is the bare name of a property some shape constrains with `sh:minCount`,
 * because that is the constraint #8's first acceptance criterion is about: a
 * required field shows invalid before the page is saved. `bareName` is what
 * turns the shape's `schema:description` into the `description` a page writes,
 * and going through the resolver is deliberate — a key hardcoded here would be a
 * second, unchecked copy of the term-resolution rules.
 *
 * Of the candidates, the one the most pages carry wins. A required key on a
 * single page makes the "removed from three pages" case remove it from one, and
 * a case that quietly does less than its label says is worse than no case: it
 * reports agreement over a smaller surface than a reader would assume.
 */
function requiredKey(
  shapes: readonly ShapeDeclaration[],
  pages: ReadonlyMap<string, string>,
  resolver: TermResolver,
): string {
  const candidates = new Set<string>();
  for (const shape of shapes) {
    for (const property of shape.properties) {
      if (property.minCount === null || property.minCount < 1) continue;
      const bare = resolver.bareName(property.iri ?? property.path);
      if (bare !== null) candidates.add(bare);
    }
  }
  assert(
    candidates.size > 0,
    "no shape constrains a property with sh:minCount, so there is nothing to " +
      "remove and this test would compare two empty sets",
  );

  let best = "";
  let bestCount = -1;
  for (const candidate of candidates) {
    let count = 0;
    for (const text of pages.values()) {
      if (new RegExp(`^${escapeRegExp(candidate)}:`, "m").test(text)) {
        count += 1;
      }
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** A key used as a pattern, with the characters YAML allows in one escaped. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The one page two shapes constrain, found by asking the shapes.
 *
 * This is the case that matters most, and the reason is in the shapes rather
 * than in the test: when two shapes constrain the same required property, one
 * with an `sh:message` and one without, a single empty key produces two results
 * whose wording comes from two different places. Comparing them in one report
 * is what makes `DEFAULT_MESSAGES` a measurement rather than a recollection.
 *
 * Returns null when no page is constrained twice, and the case that uses it
 * reports that as a skip rather than passing silently.
 */
function twoShapePage(
  pages: Map<string, string>,
  shapes: readonly ShapeDeclaration[],
  resolver: TermResolver,
): { path: string; key: string } | null {
  for (const [path, text] of pages) {
    const { frontmatter } = readFrontmatter(text);
    if (frontmatter === null) continue;
    const classes = new Set<string>();
    for (const entry of frontmatter.mapping.entries) {
      if (entry.key !== "type" && entry.key !== "@type") continue;
      for (const item of scalarsOf(entry)) {
        const iri = resolver.type(item);
        if (iri !== null) classes.add(iri);
      }
    }
    const applicable = shapes.filter((shape) =>
      shape.targetClassIri !== null && classes.has(shape.targetClassIri)
    );
    if (applicable.length < 2) continue;

    // A key both shapes require, and disagree about the wording of.
    const shared = new Map<string, { messages: Set<string> }>();
    for (const shape of applicable) {
      for (const property of shape.properties) {
        if (property.minCount === null || property.minCount < 1) continue;
        const bare = resolver.bareName(property.iri ?? property.path);
        if (bare === null) continue;
        const found = shared.get(bare) ?? { messages: new Set<string>() };
        found.messages.add(property.message ?? "");
        shared.set(bare, found);
      }
    }
    for (const [key, { messages }] of shared) {
      if (messages.size > 1) return { path, key };
    }
  }
  return null;
}

/** The strings a `type` entry holds, whether written as a value or a list. */
function scalarsOf(entry: { value: unknown }): string[] {
  const value = entry.value as {
    kind: string;
    text?: string;
    style?: string;
    items?: { value: { kind: string; text?: string; style?: string } }[];
  };
  if (value.kind === "scalar") {
    return value.style === "empty" || value.text === undefined
      ? []
      : [value.text];
  }
  if (value.kind === "sequence" && value.items !== undefined) {
    return value.items.flatMap((item) =>
      item.value.kind === "scalar" && item.value.text !== undefined
        ? [item.value.text]
        : []
    );
  }
  return [];
}

/** Drop a key from a page, the way the form's remove control does. */
function withoutKey(text: string, key: string): string {
  const { frontmatter } = readFrontmatter(text);
  if (frontmatter === null) return text;
  const entry = entryFor(frontmatter.mapping, key);
  if (entry === null) return text;
  return applyEdit(text, removeEdit(text, entry));
}

/** Replace a key's value with nothing at all: `key:`. */
function withEmptyValue(text: string, key: string): string {
  const { frontmatter } = readFrontmatter(text);
  if (frontmatter === null) return text;
  const entry = entryFor(frontmatter.mapping, key);
  if (entry === null) return text;
  // A value that is already empty is left alone, so the edit is a real
  // replacement rather than a no-op the caller would read as a change.
  if (entry.value.kind === "scalar" && entry.value.style === "empty") {
    return text;
  }
  return applyEdit(text, setValueEdit(text, entry, ""));
}

/** A stable, comparable rendering of a set of findings. */
function canonical(findings: Finding[]): string[] {
  return [
    ...new Set(
      findings.map((finding) =>
        `${finding.page} | ${finding.path} | ${finding.message}`
      ),
    ),
  ].sort();
}

/**
 * What one side said and the other did not.
 *
 * A vault can produce a hundred results, so dumping both sides is a way of
 * hiding the two lines that matter. This prints the difference and nothing
 * else, capped so a systematic disagreement is still readable.
 */
function differences(ours: string[], theirs: string[]): string {
  const only = [
    ...ours.filter((line) => !theirs.includes(line)).map((line) =>
      `  only this app: ${line}`
    ),
    ...theirs.filter((line) => !ours.includes(line)).map((line) =>
      `  only wiki check: ${line}`
    ),
  ];
  const head = only.slice(0, 12);
  const more = only.length - head.length;
  return [
    `wiki check: ${theirs.length} results, this app: ${ours.length}`,
    ...head,
    ...(more > 0 ? [`  ...and ${more} more`] : []),
  ].join("\n");
}

Deno.test({
  name: "the app's field state is the answer `wiki check` gives",
  async fn() {
    const command = await wikiCommand();
    if (command === null) {
      const note =
        "the wiki CLI is not runnable here — not installed, or the test was " +
        "run without --allow-run=wiki";
      if (cliRequired()) {
        throw new Error(
          `${note}, and WIKI_AGREEMENT_REQUIRED=1 says that is a failure. Run ` +
            "it with `deno task test:agreement`.",
        );
      }
      console.log(`skipped: ${note}`);
      return;
    }

    const source = await Deno.realPath(vaultRoot());
    // `realPath` answers with backslashes on Windows, so the check is against a
    // normalised path rather than against a string that only matches on one
    // platform — a test that skips its own baseline assertion on Windows is a
    // test that is quietly weaker there.
    const bundled = source.replace(/\\/g, "/").endsWith("testdata/shacl-vault");
    const config = await readWikiConfig(source);
    const resolver = new TermResolver(config.context);
    const originals = await readPages(source);
    const vocabulary = await readVocabulary(originals, config);
    const key = requiredKey(vocabulary.shapes, originals, resolver);
    const shared = twoShapePage(originals, vocabulary.shapes, resolver);

    /*
     * Checked before anything else, because it is the claim every other case
     * rests on. If both sides return nothing they agree, and so would two
     * evaluators that were both broken — a vault whose committed pages produce
     * no results cannot tell a correct evaluator from a broken one.
     *
     * That is a claim about the *fixture*, not about any vault, so it is only
     * asserted for the bundled one. A real vault being clean is the normal
     * state of a maintained vault and not a defect; the mutations below are what
     * give it something to disagree about.
     */
    if (bundled) {
      const baseline = canonical(
        appFindings(new Map(originals), vocabulary, resolver, config),
      );
      assert(
        baseline.length > 0,
        "the bundled fixture's committed pages produce no results, so every " +
          "case below compares two empty sets — which two broken evaluators " +
          "would also do",
      );
    }

    const work = await Deno.makeTempDir({ prefix: "wiki-agree-" });
    try {
      await Deno.copyFile(`${source}/wiki.yml`, `${work}/wiki.yml`);
      for (const [path, text] of originals) {
        await Deno.mkdir(`${work}/${path}`.replace(/\/[^/]+$/, ""), {
          recursive: true,
        });
        await Deno.writeTextFile(`${work}/${path}`, text);
      }

      /*
       * Each case is a vault, and each is written and checked in turn. The
       * shape documents are re-read for each one so a mutated page cannot leave
       * a stale shape behind.
       */
      const cases: {
        label: string;
        mutate: (pages: Map<string, string>) => Map<string, string>;
      }[] = [
        {
          label: bundled
            ? "the fixture as committed, invalid on purpose"
            : "an unmodified vault, which should report nothing",
          mutate: (pages) => new Map(pages),
        },
        {
          label: `${key} removed from the first three pages that carry it`,
          mutate: (pages) => {
            const next = new Map(pages);
            let changed = 0;
            for (const [path, text] of next) {
              if (changed === 3) break;
              if (!new RegExp(`^${escapeRegExp(key)}:`, "m").test(text)) {
                continue;
              }
              next.set(path, withoutKey(text, key));
              changed += 1;
            }
            return next;
          },
        },
        {
          label: `${key} emptied on every page that carries it`,
          mutate: (pages) => {
            const next = new Map(pages);
            for (const [path, text] of next) {
              if (new RegExp(`^${escapeRegExp(key)}:`, "m").test(text)) {
                next.set(path, withEmptyValue(text, key));
              }
            }
            return next;
          },
        },
      ];

      if (shared === null) {
        // Not a failure: a vault with no doubly-constrained page cannot test
        // the fallback wording, and saying so is better than quietly dropping
        // the case and leaving a reader to assume it ran.
        console.log(
          "  skipped: no page is constrained by two shapes that word the same " +
            "required key differently",
        );
      } else {
        cases.push({
          label:
            `${shared.key} emptied on ${shared.path}: two shapes, one message, ` +
            "one fallback",
          mutate: (pages) => {
            const next = new Map(pages);
            next.set(
              shared.path,
              withEmptyValue(next.get(shared.path) ?? "", shared.key),
            );
            return next;
          },
        });
      }

      for (const testCase of cases) {
        const pages = testCase.mutate(new Map(originals));
        for (const [path, text] of pages) {
          await Deno.writeTextFile(`${work}/${path}`, text);
        }
        const workConfig = await readWikiConfig(work);
        const workVocabulary = readVocabulary(pages, workConfig);
        const workResolver = new TermResolver(workVocabulary.context);

        const checked = await new Deno.Command(command, {
          args: ["check", "-v"],
          cwd: work,
          stdout: "piped",
          stderr: "piped",
        }).output();
        // `wiki check` exits 1 when it finds something, which is the case here
        // rather than a failure of the command, so the text is read either way.
        const report = new TextDecoder().decode(checked.stderr) +
          new TextDecoder().decode(checked.stdout);
        const theirs = canonical(parseReport(report));
        const ours = canonical(
          appFindings(pages, workVocabulary, workResolver, workConfig),
        );

        assert(
          ours.length === theirs.length &&
            ours.every((line, index) => line === theirs[index]),
          `${testCase.label}:\n${differences(ours, theirs)}`,
        );
        console.log(`  ${testCase.label}: same results (${theirs.length})`);
      }
    } finally {
      await Deno.remove(work, { recursive: true });
    }
  },
});
