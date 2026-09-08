# wiki-desktop agent guidance

This repo is a Theia-based desktop product for Wazoo Wiki, built following the
official Eclipse Theia blueprint / docs pattern:

- Monorepo: lerna workspaces (`applications/*`, `theia-extensions/*`).
- App targets: `applications/electron`, `applications/browser`.
- Extensions: `theia-extensions/wiki` (M1 editor core), `product`,
  `updater`, `launcher`.
- Build: `npm install && npm run build`; start: `npm run start --scope=@wazoo-wiki/electron-app`.
- Theia CLI: `@theia/cli` (`theia build`, `theia start`, `theia extension:build`).

Upstream attribution: Eclipse Theia / Eclipse Theia IDE blueprint
(https://github.com/eclipse-theia/theia, https://github.com/eclipse-theia/theia-ide).
Keep Eclipse Theia license notices when syncing from upstream blueprint.

Product identity: Wazoo Wiki; config folder `.wazoo-wiki`; app id
`dev.wazoo.wiki`; primary accent `#FF8C00`.

Reference design doc: `docs/design.md` (kept temporarily on branch `wip/react-mock`).
