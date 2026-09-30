# The fixture vault for `src/shacl_agreement_test.ts`

A vault small enough to read in one sitting, built so that `wiki check` and
this app's evaluator have something to disagree about.

The test that uses it is opt-in by environment variable today, which means it
runs when a human remembers and not otherwise. This directory is what lets CI
run it: the point of the test is that the panel's per-field verdict is the same
fact `wiki check` reports, and a claim like that which is only checked by hand
is a claim that decays.

Set `WIKI_DESKTOP_VAULT` to a real vault to run the same test over that
instead. It is the same code and the same assertions; this fixture is the
default so that a run with no arguments is a real run.

## What each page is for

| Page | Why it exists |
| --- | --- |
| `wiki.yml` | The smallest config that still declares a `wiki` prefix, because a focus node is only comparable between the two sides when both sides spell it the same way. `graph.context` has no `foaf`, `dc`, or `wazoo` on purpose: the resolver has defaults for those, and a fixture that declared them would not be testing that. |
| `wiki/Tech_Article_Shape.md` | A shape **with** `sh:message` on two of its three properties, and one property (`schema:wordCount`) with neither a message nor a `minCount`, so it can only fail on `sh:datatype`. |
| `wiki/Software_Application_Shape.md` | A shape with **no** `sh:message` anywhere. Every result it raises falls back to `DEFAULT_MESSAGES`, so it is what keeps that table honest against pyshacl's own wording. |
| `wiki/Alpha.md`, `wiki/Beta.md` | Two ordinary, valid `TechArticle` pages. Two rather than one so that a mutation that "removes a key from three pages" has somewhere to stop. |
| `wiki/Gamma.md` | The interesting one. `headline` is a two-item list against `sh:maxCount: 1`, and `wordCount` is the quoted string `"120"` against `sh:datatype: xsd:integer`. Those are the two constraints this vault's real shapes never reach, and the quoted-scalar case is the one where the graph loader and a naive reader disagree. |
| `wiki/Delta.md` | A page two shapes constrain, with `type` written as a list. TechArticle declares `sh:message` on `description`; SoftwareApplication does not. Emptying `description` here produces both wordings in one report, which is the only way to check the shape's message and the fallback against each other. |
| `wiki/Epsilon.md` | A page no shape constrains. It must produce no results on either side — a validator that reports something about an unconstrained page is worse than one that reports nothing. |

## Why `Gamma` uses a list and not a repeated key

```yaml
headline: Gamma
headline: Gamma Again
```

is a single value as far as the graph is concerned, because the loader takes
the last one it sees. `sh:maxCount: 1` is therefore satisfied. A two-item
sequence is two triples, and is what actually trips the constraint. The test
that removes a key writes YAML the way a person would, and this is the one
place where the two readings diverge enough to be worth pinning.

## Keeping it in step with the real toolchain

`wiki check` is installed from PyPI (`wazootech-wiki`), and the agreement test
pins nothing about its version — a new release that changes pyshacl's wording
should fail this test, because that is exactly the drift it exists to catch.
The fixture's `wiki.yml` is a subset of the real vault's, so adding a prefix
here is only worth doing when a prefix is what is under test.
