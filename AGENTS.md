# Agent guidelines

## Code health

Family-wide rules live in the
[wazootech workspace constitution](https://github.com/wazootech/workspace/blob/main/AGENTS.md#code-health-standards);
this repo's specifics:

- **Before pushing**, run the `check.yml` steps: `deno fmt --check`,
  `deno lint`, `deno task check`, `deno task test`, then
  `deno task build:editor` and confirm
  `git diff --exit-code -- src/editor_bundle.js`.
- CI uses Deno `v2.9.8`; `deno.json` sets `strict` and `lock.frozen`.
  `no-explicit-any` is enforced by `deno lint`.
- Third-party actions are pinned to full commit SHAs with a version comment.
- `secret-scan.yml` (gitleaks) runs on every PR and push to main; never suppress
  a finding without a human decision.
- The `agreement` job installs an unpinned `wazootech-wiki` on purpose, so
  upstream wording drift turns it red (see issue #50). Do not pin it to hide
  that.
- `code-health.yml` is warn-only (file length, TODO/FIXME without an issue link)
  and excludes the generated `src/editor_bundle.js` and `testdata/`.
  `.github/CODEOWNERS` assigns review.
