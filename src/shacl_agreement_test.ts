/**
 * The claim this feature rests on, tested against the thing it must agree with.
 *
 * `src/shacl.ts` evaluates frontmatter in the app rather than calling
 * `wiki check`, and that is only defensible if the two say the same thing. This
 * test is what makes it defensible: it runs the real `wiki` CLI over a copy of a
 * real vault, parses the report, runs this app's evaluator over the same pages,
 * and fails if the two sets of results differ in any path or message.
 *
 * #8 is explicit that regexing pyshacl's text report is the coupling that
 * breaks silently when the wording changes. That is a real objection, and it is
 * why the parsing lives here and not in the app: **this** coupling is allowed to
 * break, and when it does the test fails loudly. The app itself never reads the
 * report — it reads the shape documents and evaluates them, which is a
 * structured input that does not change its wording.
 *
 * The mutations are the interesting half. A vault that already passes produces
 * no results to compare, so this removes `description` from real pages three
 * ways and checks each:
 *
 * - **removed** — the case in #8's first acceptance criterion.
 * - **emptied** — `description:` with nothing after it. The graph loader adds no
 *   triple for a `None`, so this is a `MinCount` failure and not an empty string
 *   that happens to satisfy the constraint.
 * - **emptied on a two-shape page** — `Linked_Markdown.md` is the only page in
 *   this vault that two shapes constrain, and both constrain
 *   `schema:description`. One of the two shapes declares an `sh:message` and the
 *   other does not, so this is the one case that checks the shape's own wording
 *   *and* the fallback against the same report, and the one that decides whether
 *   the fallback in `DEFAULT_MESSAGES` is really pyshacl's.
 *
 *     WIKI_DESKTOP_VAULT=/path/to/vault deno test --allow-read --allow-write \
 *       --allow-env --allow-run=wiki src/shacl_agreement_test.ts
 */
import {
  applyEdit,
  entryFor,
  readFrontmatter,
  removeEdit,
} from "./frontmatter.ts";
import { buildFieldModel, type VaultVocabulary } from "./fields.ts";
import { validate } from "./shacl.ts";
import { parseShape, TermResolver } from "./shapes.ts";
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

const vaultRoot = Deno.env.get("WIKI_DESKTOP_VAULT") ?? "";

/** Why this test did not run, when it did not. */
function unavailable(): string | null {
  if (vaultRoot === "") return "WIKI_DESKTOP_VAULT is not set";
  return null;
}

/** The `wiki` binary, or null when it is not on the PATH. */
async function wikiCommand(): Promise<string | null> {
  try {
    const found = await new Deno.Command("wiki", {
      args: ["--version"],
      stdout: "piped",
      stderr: "null",
    }).output();
    return found.success ? "wiki" : null;
  } catch {
    return null;
  }
}

/**
 * Both sides name a focus node the same way, which took one change to arrange.
 *
 * `wiki check` binds `wiki:` to the site's base and prints `wiki:CSS`, so an
 * app that quoted its own `wiki/CSS.md` in a message would be reporting on the
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
async function readVocabulary(root: string): Promise<VaultVocabulary> {
  const config = await readWikiConfig(root);
  const resolver = new TermResolver(config.context);
  const shapes = [];
  for (const [path, text] of await readPages(root)) {
    const shape = parseShape(text, path, resolver);
    if (shape !== null) shapes.push(shape);
  }
  const observedKeys: Record<string, number> = {};
  for (const text of (await readPages(root)).values()) {
    const { frontmatter } = readFrontmatter(text);
    if (frontmatter === null) continue;
    for (const entry of frontmatter.mapping.entries) {
      if (entry.key === "type") continue;
      observedKeys[entry.key] = (observedKeys[entry.key] ?? 0) + 1;
    }
  }
  return { context: config.context, shapes, observedKeys };
}

/** Drop `description` from a page, the way the form's remove control does. */
function withoutDescription(text: string): string {
  const { frontmatter } = readFrontmatter(text);
  if (frontmatter === null) return text;
  const entry = entryFor(frontmatter.mapping, "description");
  if (entry === null) return text;
  return applyEdit(text, removeEdit(text, entry));
}

/** Replace a key's value with nothing at all: `description:`. */
function withEmptyDescription(text: string): string {
  const { frontmatter } = readFrontmatter(text);
  if (frontmatter === null) return text;
  const entry = entryFor(frontmatter.mapping, "description");
  if (entry === null) return text;
  return applyEdit(text, removeEdit(text, entry)) === text
    ? text
    : text.replace(/^description:.*$/m, "description:");
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
 * Eighty-seven pages produce a hundred results, so dumping both sides is a way
 * of hiding the two lines that matter. This prints the difference and nothing
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
  ignore: unavailable() !== null,
  async fn() {
    const command = await wikiCommand();
    if (command === null) {
      console.log("skipped: the wiki CLI is not on the PATH");
      return;
    }
    const source = await Deno.realPath(vaultRoot);
    const work = await Deno.makeTempDir({ prefix: "wiki-agree-" });
    try {
      await Deno.copyFile(`${source}/wiki.yml`, `${work}/wiki.yml`);
      const originals = await readPages(source);
      for (const [path, text] of originals) {
        await Deno.mkdir(`${work}/${path}`.replace(/\/[^/]+$/, ""), {
          recursive: true,
        });
        await Deno.writeTextFile(`${work}/${path}`, text);
      }

      /*
       * Three vaults, three questions. Each is written and checked in turn, and
       * the shape documents are re-read for each one so a mutated page cannot
       * leave a stale shape behind.
       */
      const cases: {
        label: string;
        mutate: (pages: Map<string, string>) => Map<string, string>;
      }[] = [
        {
          label: "an unmodified vault, which should report nothing",
          mutate: (pages) => new Map(pages),
        },
        {
          label: "description removed from three pages",
          mutate: (pages) => {
            const next = new Map(pages);
            let changed = 0;
            for (const [path, text] of next) {
              if (changed === 3) break;
              if (!/^description:/m.test(text)) continue;
              next.set(path, withoutDescription(text));
              changed += 1;
            }
            return next;
          },
        },
        {
          label: "description emptied on every page that has one",
          mutate: (pages) => {
            const next = new Map(pages);
            for (const [path, text] of next) {
              if (/^description:/m.test(text)) {
                next.set(path, withEmptyDescription(text));
              }
            }
            return next;
          },
        },
        {
          label:
            "Linked_Markdown emptied: two shapes, one message, one fallback",
          mutate: (pages) => {
            const next = new Map(pages);
            for (const [path, text] of next) {
              if (path.endsWith("Linked_Markdown.md")) {
                next.set(path, withEmptyDescription(text));
              }
            }
            return next;
          },
        },
      ];

      for (const testCase of cases) {
        const pages = testCase.mutate(new Map(originals));
        for (const [path, text] of pages) {
          await Deno.writeTextFile(`${work}/${path}`, text);
        }
        const vocabulary = await readVocabulary(work);
        const config = await readWikiConfig(work);

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
        const resolver = new TermResolver(vocabulary.context);
        const theirs = canonical(parseReport(report));
        const ours = canonical(
          appFindings(pages, vocabulary, resolver, config),
        );

        assert(
          ours.length === theirs.length &&
            ours.every((line, index) => line === theirs[index]),
          `${testCase.label}:\n${differences(ours, theirs)}`,
        );
        console.log(
          `  ${testCase.label}: ${
            theirs.length === 0 ? "no results, and none here" : "same results"
          } (${theirs.length})`,
        );
      }
    } finally {
      await Deno.remove(work, { recursive: true });
    }
  },
});
