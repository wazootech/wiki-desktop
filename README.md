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
deno task dev      # desktop app with hot reload
deno task dev:web  # the same UI and vault operations over loopback HTTP
deno task build    # compile the distributable binary (wiki-desktop.exe on Windows)
deno task check    # type-check (uses --desktop for the Deno.BrowserWindow types)
deno task test     # unit tests

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

| File                | Role                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`       | Entrypoint: serves the page, adopts the startup window, registers bindings, restores window geometry, guards close with unsaved changes. |
| `src/page.ts`       | The webview document (HTML, CSS, and JS as one string) — sidebar file list, tab strip, editor, vault picker.                             |
| `src/dev_server.ts` | Browser transport: serves the page and the same operations over loopback HTTP.                                                           |
| `src/vault.ts`      | Vault path validation and file operations. Every path from the webview passes through here.                                              |
| `src/config.ts`     | App settings in `~/.wazoo-wiki/config.json` (open vault, recent vaults, window geometry, sidebar).                                       |

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
  own text and cursor, so switching never re-reads from disk and never loses an
  edit; a dot marks unsaved work, × or a middle click closes, and `Save` writes
  the active tab only. The window's close handler asks the page which buffers
  are dirty, so the prompt names the count.
- **Sidebar** — the ☰ at the top-left collapses the column on wide windows (the
  editor reflows into the space) and slides it in as a drawer below 640px. It is
  one action with two affordances: the brand row's while the sidebar is showing
  and the tab bar's once it is collapsed, so the control stays in the window's
  top-left corner and never strands itself. The collapsed state is stored in the
  app config, so it survives a restart.

## Known limitations

- **No native folder picker yet.** `deno desktop` does not expose one (it is on
  their roadmap), so the app ships its own folder browser: navigate from Home,
  Documents, Desktop, or the working directory, or paste a path. A
  `<input
  type="file">` seeded picker is the documented workaround once single
  files need opening by path.
- The editor is a plain `<textarea>` — no syntax highlighting, no wrap, and
  nothing that understands Markdown yet. Open files are tabs, but `Save` writes
  the active tab only; there is no save-all and no session restore.
- `Ctrl+W`, `Ctrl+Tab`, and `Ctrl+B` work in the desktop window, but a browser
  keeps `Ctrl+W` and `Ctrl+Tab` for its own tabs, so in browser dev mode close
  and switch with the mouse and use `Ctrl+B` for the sidebar.
- Files larger than 2 MiB and hidden files/directories are skipped.
- The vault is not watched, so external edits need the **Reload** button.

## Hybrid desktop and web

The app is meant to run as a desktop window and as a web app from the same code.
What that already means here:

- One implementation of every operation, with the transport chosen at the edge
  (`win.bind` for desktop, HTTP for web) and the UI unaware of which it is on.
- One page string, so the web target needs no bundler and deploys as a single
  Deno module.
- One set of path guards, so HTTP access is not a way around them.
- Both transports guard unsaved work: the desktop window intercepts its own
  close event, and the page adds a `beforeunload` handler for the browser.

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
