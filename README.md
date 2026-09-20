# wiki-desktop

Wazoo Wiki desktop app — from-scratch
[Deno desktop](https://docs.deno.com/runtime/desktop/) build (Deno 2.9+).

The app opens a native window, points it at a local `Deno.serve()` handler, and
does all filesystem work in the Deno runtime through
[bindings](https://docs.deno.com/runtime/desktop/bindings/). It is vault-first:
you open a folder as your wiki, the sidebar lists what is in it, and open/save
go straight to disk — no browser file APIs, no build step, no bundled frontend.

This repo is an early work in progress. The earlier Theia-based attempt
(`wiki-theia`) is shelved; the mock that preceded it lives on in
[wiki-desktop-experiment](https://github.com/wazootech/wiki-desktop-experiment).

## Requirements

- Deno 2.9 or newer (`deno desktop` shipped in 2.9; CI pins v2.9.6).

## Commands

```sh
deno task dev          # desktop app with hot reload
deno task dev:web      # the same UI and vault operations over loopback HTTP
deno task build        # compile the distributable binary (wiki-desktop.exe on Windows)
deno task build:editor # rebuild the committed editor bundle from src/editor.ts
deno task check        # type-check (uses --desktop for the Deno.BrowserWindow types)
deno task test         # unit tests

WIKI_DESKTOP_VAULT=/path/to/vault deno test --allow-read --allow-write --allow-env
                       # adds one opt-in test: every page in that vault has to
                       # survive read → editor → save with its bytes intact

deno fmt           # formatting
deno lint          # lint
```

### Browser dev mode

`deno task dev:web` serves the app on `http://127.0.0.1:4555/` (override with
`WIKI_DEV_PORT`). It is the same page and the same operations as the desktop
app, reached over HTTP instead of the `bindings` proxy, which makes the UI
reviewable and debuggable in a normal browser — the default webview backend has
no DevTools at all.

It is a development tool: it listens on loopback only and refuses cross-origin
callers and non-JSON requests. Desktop and web share one implementation of every
operation (`createVaultApi()`), so the path guards below apply to both.

`deno check` needs the `--desktop` flag to see the desktop APIs; plain
`deno check` reports
`Property 'BrowserWindow' does not exist on type 'typeof Deno'`.

## Layout

| File                   | Role                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main.ts`          | Entrypoint: serves the page, adopts the startup window, registers bindings, restores window geometry, guards close with unsaved changes.         |
| `src/page.ts`          | The webview document (HTML, CSS, and JS as one string) — sidebar file list, tab strip, editor, vault picker.                                     |
| `src/dev_server.ts`    | Browser transport: serves the page and the same operations over loopback HTTP.                                                                   |
| `src/vault.ts`         | Vault path validation and file operations, including line-ending preservation. Every path from the webview passes through here.                  |
| `src/config.ts`        | App settings in `~/.wazoo-wiki/config.json` (open vault, recent vaults, window geometry, sidebar collapsed state and width).                     |
| `src/editor.ts`        | The editor's document model and theme, behind a small handle the page drives. Runs in the webview, so it is the one module that is not a string. |
| `src/editor_entry.ts`  | Bundle entry: publishes that handle as `window.WikiEditor` for the page's classic script tag.                                                    |
| `src/editor_bundle.js` | The built editor, committed and served at `/editor.js` by both transports so the desktop build stays one artifact.                               |

## How it works

- **Vault** — a folder the user picks. Its absolute path is stored in the app
  config, so the app reopens where you left off. Nothing is written except files
  you explicitly save.
- **Bindings** — `win.bind(name, handler)` exposes Deno functions to the webview
  as `bindings.name(args)`. They run in-process (no socket IPC) and inherit the
  runtime's permissions, so the tasks start Deno with
  `--allow-read --allow-write --allow-env`.
- **Path safety** — bindings are a trust boundary. `src/vault.ts` rejects
  absolute paths and `..`, resolves symlinks with `Deno.realPath`, and verifies
  the result stays inside the vault root before touching the filesystem.
- **Errors** — a handler that throws reaches the webview as
  `{ name, message, stack }`; `src/bindings.ts` translates filesystem failures
  into messages that are safe to show, and the UI surfaces them as a toast.
- **Theming** — every color in `src/page.ts` is a custom property. Light is the
  default and dark follows the operating system's setting
  (`@media (prefers-color-scheme: dark)`), with `color-scheme: light dark` so
  scrollbars, carets, and native controls match too. There is no in-app theme
  toggle yet; adding one only means reassigning the token block on `:root`.
- **Tabs** — the tab strip holds one buffer per open file. Each tab keeps its
  own text, cursor, scroll position, and undo history, so switching never
  re-reads from disk and never loses an edit; a dot marks unsaved work, × or a
  middle click closes, and `Save` writes the active tab only. The window's close
  handler asks the page which buffers are dirty, so the prompt names the count.
- **Editor** — [CodeMirror 6](https://codemirror.net/) with the Markdown
  grammar, chosen in [#6](https://github.com/wazootech/wiki-desktop/issues/6)
  against a regex overlay and against `editorcn`/Tiptap (HTML- or
  ProseMirror-first, and we would own the Markdown round trip). It is bundled to
  `src/editor_bundle.js` and served from memory at `/editor.js`, so the page
  string stays a string and the desktop build stays one artifact; CI rebuilds
  the bundle and fails if it has drifted from `src/editor.ts`. The page reaches
  it only through a handle (`getValue`, `showDocument`, `forgetDocument`,
  `getCursor`), so the tab strip, dirty state, and `Save` do not know CodeMirror
  exists. Syntax colours are the same custom properties as the rest of the UI,
  and the theme is a CodeMirror extension — CodeMirror injects its base theme
  _after_ the page's stylesheet with an extra class of specificity, so a
  page-written `.cm-gutters` rule loses and the gutter renders light grey in
  dark mode.
- **Line endings** — the editor's document holds LF only, and the file keeps the
  ending it arrived with. `src/vault.ts` converts on the way in and back on the
  way out, so fixing a typo in a CRLF page is a one-line diff rather than a
  whole-file rewrite. A BOM is preserved for the same reason.
- **Sidebar** — the panel icon at the top-left collapses the column on wide
  windows (the editor reflows into the space) and slides it in as a drawer below
  640px. It is one action with two affordances: the brand row's while the
  sidebar is showing and the tab bar's once it is collapsed, so the control
  stays in the window's top-left corner and never strands itself. The collapsed
  state is stored in the app config, so it survives a restart.
- **Two icon-only buttons, two icons** — the sidebar toggle and the app menu are
  both 28px squares in the same band of chrome, so they cannot share a glyph:
  the toggle draws a panel (an inline SVG in `src/page.ts`, sized on the
  element, because the glyphs for "sidebar" are not in every font the desktop,
  browser and CI targets ship) and the menu keeps the hamburger the toggle used
  to borrow. Both are drawn from one constant and both rely on `aria-label` for
  their name, since an `aria-hidden` SVG contributes none.- **The top bar holds
  the open document's actions, not the inventory** — `Save` is the one control
  that keeps a word, because it is what you reach for mid-sentence and the
  `Saved` / `Unsaved changes` label beside it is what it acts on. Reloading from
  disk is the same kind of action but the rarer of the two, so it keeps a glyph:
  a 28px stroke-2 arrow whose name lives in `aria-label` and `title`, beside the
  `☰`, where the rarer commands live. `New file` is not a document action at
  all and has no slot: it is in the menu (`Ctrl+N`), the empty state, and the
  `+` beside the filter in the sidebar.
- **Commands** — one list in `src/page.ts` holds every action (File, Tabs, View,
  Vault) and the `☰` in the top bar renders that list instead of repeating it
  in the markup, so a command cannot exist twice or be named in two places. The
  buttons and the keyboard call the same functions, and
  `window.wikiRunCommand(id)` runs one by id and reports whether it ran — which
  is how the browser preview and the tests drive the same path, and how
  `src/main.ts` will reach in if the native menu is ever projected. An entry's
  accelerator label is only ever a shortcut the page itself handles.
- **Sidebar width** — the column's right edge is a drag handle (`col-resize`),
  clamped to 180–520px and to the width that still leaves the editor room on a
  small window. The handle is a separator, so it is tabbable and resizable from
  the keyboard (`←`/`→`, `Shift` for a jump, `Home`/`End` for the bounds), and
  double-clicking it restores the default. The chosen width is stored in the app
  config next to the collapsed state. The drawer layout below 640px hides the
  handle, since there the sidebar's position _is_ the state.

## Known limitations

- **No native folder picker yet.** `deno desktop` does not expose one (it is on
  their roadmap), so the app ships its own folder browser: navigate from Home,
  Documents, Desktop, or the working directory, or paste a path. A
  `<input
  type="file">` seeded picker is the documented workaround once single
  files need opening by path.
- **Highlighting is Markdown-only.** Headings, links, emphasis, wikilinks, and
  fences are coloured, but code inside a fence is not parsed by its language:
  the grammar for the 14 fence languages in our own docs vault is
  `@codemirror/language-data`, which measures **1.5 MB minified (526 KB gzipped)
  for the grammars alone** — about three times the editor. Adopting it is a
  deliberate trade, not an oversight
  ([#6](https://github.com/wazootech/wiki-desktop/issues/6)). There is no
  search, autocomplete, folding, or multi-cursor yet.
- `Save` writes the active tab only; there is no save-all and no session
  restore.
- `Ctrl+W`, `Ctrl+Tab`, and `Ctrl+B` work in the desktop window, but a browser
  keeps `Ctrl+W` and `Ctrl+Tab` for its own tabs, so in browser dev mode close
  and switch with the mouse and use `Ctrl+B` for the sidebar.
- Below 640px the sidebar is a drawer whose scrim covers the window, so the tab
  bar's own buttons — including the `☰` menu — are clickable once the drawer is
  dismissed (clicking anywhere outside does that).
- The native application menu is not projected; commands are the page's `☰`
  menu only, and accelerators work because the page handles the keys.
- Files larger than 2 MiB and hidden files/directories are skipped.
- The vault is not watched, so external edits need the refresh button on the tab
  bar (or **Reload from disk** in the `☰` menu); it asks before discarding a
  buffer with unsaved changes.

## Hybrid desktop and web

The app is meant to run as a desktop window and as a web app from the same code.
What that already means here:

- One implementation of every operation, with the transport chosen at the edge
  (`win.bind` for desktop, HTTP for web) and the UI unaware of which it is on.
- One page string, so the web target needs no bundler of its own; the editor is
  the one committed bundle, and both transports serve it from memory at the same
  path.
- One set of path guards, so HTTP access is not a way around them.
- Both transports guard unsaved work: the desktop window intercepts its own
  close event, and the page adds a `beforeunload` handler for the browser.
- Commands live in the page for the same reason. `win.setApplicationMenu` is a
  Deno-side call the browser cannot see, so a native menu would be unreachable
  from the preview and unassertable in CI, while the page's menu is clickable in
  both. Measured on Deno 2.9.6 / Windows with the default backend: the window
  really owns a native menu and invoking an item does fire `menuclick`, but
  accelerators are inert — the item renders `CmdOrCtrl+1` and pressing it
  reaches the webview instead — and UI Automation exposes no `MenuBar` at all,
  so the only way to drive one is raw Win32. Projecting it is therefore a
  deliberate trade for a later change, not a missing line of code.

What is still desktop-shaped and needs to change before a hosted web deployment
is real: vault selection exposes server filesystem paths (`browse`/`openVault`),
settings live in a per-machine JSON file, there is no authentication or tenancy,
and `window.prompt`/`window.confirm` are used for the new-file and
unsaved-changes dialogs — fine in the desktop runtime, unreliable in an embedded
web view.

## Next steps

Wire the [`wiki` CLI](https://github.com/wazootech/wiki) engine in behind the
editor (`check`, `lint`, `render`, `query`) so the app validates and renders a
vault rather than only editing its files.
