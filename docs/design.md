# wiki-desktop — Design Document

Fresh restart of the wiki-desktop project. Prior iteration preserved at
[wazootech/wiki-desktop-experiment](https://github.com/wazootech/wiki-desktop-experiment)
(Theia-fork approach; retired after Phase 2a branding landed).

---

## 1. Purpose

- **One-liner:** a Linked-Markdown-native desktop editor for wiki management, built on the `wazootech/wiki` toolchain.
- **Editor-first, not agent-first:** the app is a place to author and maintain wikis; AI/agent integration is a distribution feature, not the core.
- **Scope anchor:** `wazootech/wiki#269` (prototype proposal).

## 2. Non-negotiables

- The Wiki CLI/toolchain stays the source of truth for validation and rendering; the app is a frontend driving it (`wazootech-wiki` SDK or MCP).
- File-first writes: edits are local `.md` writes; Git remains the history layer. No HTTP mutation surface (upstream `serve` stays read-only).
- The wiki MCP server ships with the app; external harnesses can chat with a wiki without installing the CLI or skills.

## 3. Why a restart (lessons from the experiment)

- The Theia-IDE fork gave a full IDE shell but dragged ~40 unwanted platform packages (AI suite, debug, SCM, collaboration) that each needed hide-then-drop surgery.
- Fork weight: lerna monorepo, yarn, upstream sync burden, slow builds; even "cheap branding" was a multi-day slice.
- Verification friction: Electron test suites were environment-blocked (missing Chrome) for the project's whole life.
- Decision carried forward: keep the *product* ideas (below), drop the *shell* approach.

## 4. Architecture

### 4.1 Process model
- Electron app: main process (window, lifecycle, file dialogs) + renderer (editor UI) + utility process (wiki toolchain bridge).
- Wiki toolchain invoked in-process via `wazootech-wiki` SDK where possible; CLI subprocess as fallback seam.

### 4.2 Layers (each independently testable)
- **core/** — pure domain logic: frontmatter parse/serialize, validation-report normalization, page-tree model. No Electron, no DOM.
- **bridge/** — wraps the wiki toolchain: `check`, `lint`, `fmt`, `render`, `link`, `query`. Emits normalized diagnostics.
- **ui/** — editor surface (renderer): page tree, split source/preview, panels.
- **mcp/** — bundled MCP server exposing read-only wiki surface to external harnesses.

### 4.3 Editor strategy
- Reuse decision (experiment issue #2) was never closed. For the restart, default to a purpose-built React editor (Tiptap/ProseMirror base — the `editorcn` lineage) with plain-text source as the persistence format.
- Gate before building UI: verify Tiptap markdown serialization round-trips frontmatter + wikilinks losslessly. If it fails, fall back to a CodeMirror source editor + preview pane (split-only, no rich WYSIWYG).

## 5. Product surface

### 5.1 M1 — MVP (each item is independently shippable)
- Open wiki root; discover `wiki.yml`/`wiki.yaml`; build page tree from filesystem routes.
- Split source/preview markdown editor.
- Frontmatter pane (`@context` / `@id` / `@type` / IRIs), open-schema.
- Live trust lane: `check` + `lint` on save, violations surfaced inline/problems pane.
- Render SPARQL blocks on save/command; surface `render --check` staleness.
- Backlinks + metadata panel (typed links preferred over plain backlinks).
- Bundled MCP registration (see §7).

### 5.2 M2
- Link autocomplete.
- `--fix-broken` triggered from the UI (explicit action only).
- Visual graph surface (typed links).

### 5.3 M3
- OKF v0.2 trust stamps (consumer of `wazootech/wiki#268`).
- `wazoo://` deep links.
- LLM-assisted page generation (ties into `wiki#267` WikiSkill loop).

## 6. Brand & shell

- Product name: **Wazoo Wiki**; config folder `.wazoo-wiki`; app id `dev.wazoo.wiki`.
- Dark-only theme at first; tokens from `wazoo.dev/brand/styles.css` (primary `#FF8C00`, void `#040404`, text `#B0B0B1`).
- Typography: headings Inter, body IBM Plex Mono, tracking `-0.025em`.
- Opinionated by default: wiki workflow visible, general-IDE chrome absent — trivially achievable now that we own the shell instead of hiding a fork's.
- Mandatory attribution: "Built on Eclipse Theia" no longer applies; keep MIT licensing hygiene for any reused upstream code (e.g. editorcn is MIT — keep its notice).

## 7. MCP distribution

- Ship `wiki mcp` (or a thin launcher over `wazootech-wiki`) inside the app bundle; expose the stdio endpoint to the OS.
- Query-first, read-only surface: `query_sparql`, `describe_wiki`, read-only resources.
- No-CLI contract: MCP must work when the standalone `wiki` command is not on PATH (bundled binary or embedded runtime).
- Any new tools (check/lint/render reports) go upstream in `wazootech/wiki` as their own issues — no forking.

## 8. Build, test, CI

- Package manager: pnpm (settles experiment issue #12 from the other direction).
- Tests per layer: core (pure unit), bridge (contract tests against the CLI), ui (component), e2e (Playwright over Electron).
- Avoid the experiment's blocker: prefer Node-side test runners; keep Electron-dependent tests few and clearly gated.
- CI: lint + typecheck + unit tests on PRs; packaged build on main.

## 9. Explicit non-goals (v1)

- Real-time collaboration.
- General IDE features (debugging, SCM UI, terminal, notebooks).
- Auto-update pipeline (defer until release process exists).
- Light theme.
- Any write path over HTTP.

## 10. References

- `wazootech/wiki#269` — prototype proposal (anchor)
- `wazootech/wiki#268` — OKF v0.2 trust research (M3 consumer)
- `wazootech/wiki#267` — WikiSkill evolution loop (M3)
- `wazootech/wazoo-desktop#1` — deno desktop runtime proposal (fallback shell, only if Electron is rejected)
- `shadcn-labs/editorcn` — MIT React/Tiptap editor components (reuse candidate)
- Experiment repo: `wazootech/wiki-desktop-experiment` — issue #1 (original scope), #15 plan (branding decisions), STATE.md (verification baseline)
