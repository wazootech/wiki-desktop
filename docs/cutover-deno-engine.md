# Cutover impact: the Deno engine rewrite

The wiki toolchain is being rewritten from Python to Deno/TypeScript in
[wazootech/wiki#317](https://github.com/wazootech/wiki/pull/317). When it lands,
`wiki check` is a different program with different output. This note records
what that means for this app, measured rather than inferred, so the next person
does not have to re-derive it.

**Status as of 2026-09-30: not actionable yet.** PR #317 is open with no formal
approval, `@wazoo/wiki` does not exist on JSR, and no Deno release is tagged.
The blockers are listed at the bottom. Nothing here needs doing until they
clear, and nothing here should change the app's design in the meantime — see
[Decision](#decision) for why.

## What actually arrives, and where

The rewrite is easy to misread as "npm replaces PyPI." It is not quite that, and
the distinction matters for this app specifically.

|                        | npm `wazootech-wiki`                                     | JSR `@wazoo/wiki`                                                                                                    |
| ---------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Today (0.1.23)         | a Node shim that builds a Python venv and spawns it      | does not exist (404)                                                                                                 |
| After cutover (0.1.24) | same shim shape, spawning a **bundled Deno runtime**     | the **in-process engine**                                                                                            |
| Public surface         | `exports: {".": "./dist/index"}` — the `Wiki` class only | `src/wiki/mod.ts` — `Config`, `frontmatterToGraph`, `validateShacl`, `loadShapes`, `iterDocumentFiles`, `Context`, … |
| Method bodies          | every method shells out to a subprocess                  | direct function calls                                                                                                |

The npm `Wiki` SDK is a _process wrapper_; its own docstring says "Each method
shells out to the Python CLI." Swapping PyPI for npm therefore yields the same
subprocess architecture with a different interpreter underneath. The thing that
would change this app's architecture is JSR, not npm.

## This app has no runtime dependency on the CLI

Worth stating plainly because it bounds the blast radius: there is no PyPI
dependency in the shipped app. The only `Deno.Command` in `src/` is `git`, and
the only runtime grant is `--allow-run=git`. The Python toolchain appears in
exactly two places:

- `.github/workflows/check.yml`, job `agreement` — `pip install wazootech-wiki`
- `src/shacl_agreement_test.ts` — spawns `wiki` to compare against

So the cutover is a **CI-only change**. Nothing in the distributable binary
moves.

## The premise behind the in-app evaluator no longer holds

`.github/workflows/check.yml` justifies reimplementing validation in the app:

> The panel decides a field's validity itself, from the vault's own shapes,
> rather than asking `wiki check` — because the CLI can only read a file that is
> already on disk, and #8's first acceptance criterion is a verdict before the
> save.

The first half of that is no longer true. The new engine is in-process and
graph-based: `validateShacl(dataGraph, shapesGraph)` takes graphs, and
`frontmatterToGraph(record, config, { fileId })` takes a record. An unsaved
buffer is directly validatable without spawning anything, which is exactly what
the editor needs.

Two costs are real, and are why this was not simply adopted:

- `validateShacl` is **async**. `planFrontmatter` → `FrontmatterPanel.plan()` →
  `render()` is synchronous on every keystroke, so the panel's render path would
  have to change shape, not just gain an import.
- Consuming the engine would mean the app and the CLI are no longer two
  independent implementations, which dissolves the premise of the agreement test
  entirely. The test is only meaningful while there are two things to compare.

There is also a plan already recorded for this:
[wiki#310](https://github.com/wazootech/wiki/issues/310) (`wiki check --json`,
structured diagnostics) would let the app use the CLI's own answers instead of
extending its evaluator, per the README's known limitations. That is the cleaner
route to closing the three-constraint gap, and it does not require the engine to
be importable.

## What actually changes: report rendering

Measured by running `refactor/deno-rewrite` at `09390f9` under Deno 2.9.6
against the same vaults and the same `wiki 0.1.23`, with the app unchanged.

**Semantics agree. Text does not.** Same vault, same mutation, both engines,
three results each on the same pages with the same constraint:

|             | Python 0.1.23                               | Deno 0.1.24                                     |
| ----------- | ------------------------------------------- | ----------------------------------------------- |
| Focus Node  | `wiki:Chapterhouse_Dune`                    | `<https://example.org/books/Chapterhouse_Dune>` |
| Result Path | `schema:name`                               | `<https://schema.org/name>`                     |
| Message     | `Less than 1 values on wiki:X->schema:name` | `Less than 1 values`                            |

Three separate divergences, and only the first two are cosmetic:

1. **Focus nodes become full IRIs.** Declared CURIEs are expanded, so even
   `wiki:Gamma` prints as `<https://wazootech.github.io/wiki/Gamma>`.
2. **Result paths become full IRIs.**
3. **`sh:minCount` messages lose their subject entirely.** This one is
   user-facing: the field panel shows that string to a reader.

Against the committed fixture, the very first case of the agreement test fails:

```
only this app:    wiki:Gamma | schema:headline | TechArticle must have exactly one headline.
only wiki check:  <https://wazootech.github.io/wiki/Gamma> | <https://schema.org/headline> | TechArticle must have exactly one headline.
```

`canonical()` in `src/shacl_agreement_test.ts` compares `page | path | message`
literally, with no IRI normalization, so every case will fail on cutover day —
not subtly, and not only where messages differ.

The rewrite declares this as an accepted known difference: reports render terms
as N-Triples rather than rdflib's `__str__`, and `check` is a `known` case in
its differential harness rather than a `parity` case.

## Every existing vault fails to load at cutover

Independent of anything above, and the most disruptive single fact. `fmt:`
blocks written for mdformat are rejected outright — `wrap`, `end_of_line`, and
`extensions` each fail independently, and then _every_ command exits 1, `check`
included:

```
Error: Invalid config file wiki.yml: 1 validation error for Config
  Value error, Invalid config file wiki.yml: Invalid key 'wrap' in wiki.yml fmt.
  Keys must be one of {'textWrap', 'lineWidth', 'newLineKind'}.
```

All three vaults this project is tested against are affected: `wazootech/wiki`
`docs/wiki.yml`, `ethanpedia`, and the `wazootech/wiki` examples. A 15-line
vault reproduces it. The replacement is not a rename — `wrap: "no"` is not
`textWrap: "no"`, and `extensions` has no equivalent at all, since mdformat's
extension list selects parsing behaviour and none of `textWrap` / `lineWidth` /
`newLineKind` means that.

This is intentional per ADR 0001 and it is a vault-side fix, not a wiki-desktop
one. Reported upstream as
[wazootech/wiki#327](https://github.com/wazootech/wiki/issues/327), including
the request for a migration note and a cleaner error, since the actionable
sentence is currently buried inside a Pydantic `input_value` dump.

## What does not change

Checked against the new engine, not assumed:

- **A page's explicit `id`/`@id` still wins over the filename.** Same precedence
  (`@id`, then `id`, then `base_iri + fileId + extension`), same
  `graph.include_file_extension` handling.
  [#40](https://github.com/wazootech/wiki-desktop/issues/40) stays accurate
  against either engine.
- **Absent `wiki.input` still defaults to `["wiki"]`,** and an explicit
  `input: []` still means nothing.
  [#39](https://github.com/wazootech/wiki-desktop/pull/39) holds.
- **A Markdown file outside `wiki.input` is still not a page.**
  `iterDocumentFiles` walks only the configured inputs, so
  [#41](https://github.com/wazootech/wiki-desktop/pull/41) holds — verified on
  the same probe vault, where the new engine reported the page inside `wiki/`
  and ignored the one outside, exactly like the fixed app.
- **The Windows console-encoding bug is already fixed** by the rewrite, since
  there is no longer a Python process selecting `sys.stdout.encoding`. Reported
  against 0.1.23 as
  [wazootech/wiki#326](https://github.com/wazootech/wiki/issues/326) and
  annotated with that finding.
- **The formatter change does not touch this app.** `src/format.ts` is the
  editor's own whitespace formatter — deliberately not an AST round trip — and
  reads no `fmt:` config. `wiki.yml`'s `fmt` block is documented in
  `src/wiki_config.ts` as belonging to the toolchain.

## Decision

**Keep reimplementing the evaluator; treat the cutover as a CI-only change.**

The app has no runtime dependency to swap, the engine's semantics agree with the
current CLI, and the three behaviours the panel depends on (`@id` precedence,
the `wiki.input` default, the input-scope rule) are all confirmed unchanged.
Adopting the in-process engine would cost the async render-path change and the
agreement test's meaning, in exchange for closing a gap that
[wiki#310](https://github.com/wazootech/wiki/issues/310) is positioned to close
more cheaply.

The accepted cost is that the panel will quote a message format the CLI no
longer produces, and the agreement test will need its comparisons normalized
rather than literal. That is a known, bounded, and documentable divergence — not
a silent one, which is the property that matters.

## Blockers

None of this is actionable until all of these clear:

- PR [#317](https://github.com/wazootech/wiki/pull/317) merged with a formal
  approval. It is currently self-reviewed with no `reviewDecision`.
- `@wazoo/wiki` created and linked on JSR — still 404. Everything described as
  importable above is only reachable after this.
- A first tagged release. PyPI is retired at cutover, so 0.1.23 stops being
  installable from PyPI and the npm package switches over in the same release.
- Standalone binaries are planned for linux-x64, windows-x64, and mac-arm64.
  **No macOS x64**, which matters for anyone installing one directly on an Intel
  Mac.

There is no published timeline, and `wiki-desktop` appears nowhere in the
`wazootech/wiki` repository — there is no consumer-integration plan upstream, so
whatever this app settles on is settled unilaterally.

## When it lands

In order, because each depends on the one before:

1. **Migrate the test vaults' `fmt:` blocks** off `wrap` / `end_of_line` /
   `extensions`, or the CI `agreement` job cannot read them. This is a blocker
   for everything below and belongs to the vaults, not to this repo.
2. **Normalize the agreement test's comparisons** — expand the app's CURIEs and
   the CLI's IRIs to a common form before comparing, so focus nodes and result
   paths are comparable again. Decide explicitly whether term _syntax_ is in or
   out of the contract; the current test compares it, and that is what fails
   first.
3. **Decide the message-wording question** (see below). This is the only item
   here that is a product decision rather than a mechanical fix.
4. **Switch the CI install** from `pip install wazootech-wiki` to the npm
   package. Smallest change of the four, and worth doing early so it is not the
   thing that breaks.
5. **Re-baseline `testdata/shacl-vault/`** expectations, which are written in
   the current engine's vocabulary.

On (3): the panel currently says
`Less than 1 values on wiki:CSS->schema:description` and the new CLI will say
`Less than 1 values`. Keeping the richer message means this app's field panel
deliberately diverges from the tool it mirrors, which is a legitimate choice but
should be a decision rather than an accident — and the agreement test needs to
know which way it goes before it can assert anything useful about messages.

## Reproducing the measurements

The engine can be run from a branch checkout before it is released, which is how
everything above was measured:

```sh
git clone --depth 1 --single-branch \
  --branch refactor/deno-rewrite https://github.com/wazootech/wiki.git wikits
deno run --allow-read --allow-write --allow-env --allow-net \
  wikits/src/wiki/cli.ts --version          # → wiki, version 0.1.24
deno run --allow-read --allow-write --allow-env --allow-net \
  wikits/src/wiki/cli.ts -c <vault> check
```

Two traps, both of which produced wrong answers before being caught:

- **A shim must be a real executable.** Putting a `#!/bin/sh` script named
  `wiki` earlier on `PATH` does _not_ work — Windows `CreateProcess` cannot run
  it, and `Deno.Command("wiki")` silently falls through to the real binary. The
  agreement test then passes against the Python CLI while appearing to test the
  new engine. A `wiki.cmd` batch file works, and logging from inside the shim is
  how to prove which engine actually ran.
- **Do not compare result _counts_.** Both engines returned 2 results for a case
  where every focus node, path, and message differed. A count check would have
  called that agreement.
