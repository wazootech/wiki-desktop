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
deno task check:appearance  # drives both palettes in the real desktop webview

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

Both can run at once, and they can write settings at the same time — the desktop
window persists its geometry on every resize, while the browser changes the
appearance or the sidebar. `src/config.ts` is built for that: it re-reads the
settings file instead of serving a snapshot, merges each patch onto what is on
disk at the moment of the write, serialises the writes in a process, and renames
a scratch file over the target so a reader never sees half a file. The cost is a
file read per call, which the OS page cache makes nearly free.

`deno check` needs the `--desktop` flag to see the desktop APIs; plain
`deno check` reports
`Property 'BrowserWindow' does not exist on type 'typeof Deno'`.

### Appearance check, in the real webview

`deno task check:appearance` opens the actual window, serves the app's own
document six times — every stored preference against a dark and a light desktop
— and reads the answer back out of the running page. It takes about ten seconds,
needs a display, and exits non-zero on failure, which is why CI type-checks it
and does not run it.

It exists because two of the claims the palette rests on cannot be settled
anywhere else. The unit tests read the page as a string, so they can see that
the dark palette is declared and that no rule reads `prefers-color-scheme`, but
not that an engine resolves either. And the browser dev server is a different
engine from the desktop's — and nothing in it can be told to report a desktop
appearance at all, which is the one input that decides between the palettes when
the preference is `system`. So this check serves the page's own
`pageForTheme(...)` output, injects an emulated desktop ahead of the page's own
head script, stands in for the bindings so a stored choice can be watched
reaching `setTheme`, and measures, per case:

- **the launch** — the first mode the document is ever given, and whether
  `<body>` had been parsed yet when it was. That is as close as a window gets to
  "nothing could have painted in the wrong mode first", and it is the only check
  here with a deadline.
- **the palette** — the four tokens that carry it, compared against what
  `src/page.ts` declares (read out of the stylesheet, not copied here), plus
  `color-scheme`, the `theme-color` meta, and the colour the body actually
  paints.
- **the desktop flipping** under the page, which may move the mode only while
  the preference is `system`.
- **pinning** one through `window.wikiRunCommand`: it must reach `setTheme`
  through the bindings, check the right item in the menu, and ignore the
  desktop; and handing it back to `system` must follow the desktop again.

One line per check, so it reads as a table or as a gate. Worth knowing when it
fails: it is the only place the appearance is exercised by the engine that
ships, because the desktop window loads its document over the local server — the
pre-paint path here is the real one, not a model of it.

## Layout

| File                      | Role                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`             | Entrypoint: serves the page, adopts the startup window, registers bindings, restores window geometry, guards close with unsaved changes.                                                                                                                                                                                                          |
| `src/page.ts`             | The webview document (HTML, CSS, and JS as one string) — sidebar file list, tab strip, editor, vault picker.                                                                                                                                                                                                                                      |
| `src/dev_server.ts`       | Browser transport: serves the page and the same operations over loopback HTTP.                                                                                                                                                                                                                                                                    |
| `src/vault.ts`            | Vault path validation and file operations, including line-ending preservation. Every path from the webview passes through here.                                                                                                                                                                                                                   |
| `src/wiki_config.ts`      | The vault's own `wiki.yml` (`input`, `assets`, `exclude`), read on the way into a listing so a page and a static file are not the same thing.                                                                                                                                                                                                     |
| `src/config.ts`           | App settings in `~/.wazoo-wiki/config.json` (open vault, recent vaults, window geometry, sidebar collapsed state and width, appearance).                                                                                                                                                                                                          |
| `src/appearance_check.ts` | The appearance check behind `deno task check:appearance`: six cases, driven and read back in the real desktop webview.                                                                                                                                                                                                                            |
| `src/editor.ts`           | The editor's document model and theme, behind a small handle the page drives. Runs in the webview, so it is the one module that is not a string.                                                                                                                                                                                                  |
| `src/editor_entry.ts`     | Bundle entry: publishes that handle as `window.WikiEditor` for the page's classic script tag.                                                                                                                                                                                                                                                     |
| `src/editor_bundle.js`    | The built editor, committed and served at `/editor.js` by both transports so the desktop build stays one artifact. CI rebuilds it and fails on any diff, which is the only way drift is visible: `deno task build` makes the binary, not the bundle, so a change to `src/editor.ts` can pass every other check and still serve the old behaviour. |

## How it works

- **Vault** — a folder the user picks. Its absolute path is stored in the app
  config, so the app reopens where you left off. Nothing is written except files
  you explicitly save.
- **The vault's own config says what a page is** — `wiki.yml` (or `wiki.yaml`,
  `wiki.json`) is read before the walk and gives every listed file a scope:
  `input` under `wiki.input` (the wiki's pages), `asset` under `wiki.assets`
  (static files), `other` for everything else the vault holds — its config,
  READMEs, scripts. Assets are listed last and dimmed, behind an `Assets`
  checkbox that appears only in a vault that declares them, because the app has
  no other file browser: `exclude` is the only thing that removes a file, and a
  checkbox is what keeps a two-tier listing honest. Globs (`**` across segments,
  `*` within one) apply to files and folders, and an excluded folder is never
  entered, so its contents cost nothing and cannot reappear a level down.
  `other` files stay listed rather than hidden, because `input` is about
  indexing rather than permission and the vault's own root `README.md` has to
  stay openable. A missing, unparseable, or non-mapping config produces exactly
  the listing there was before — a broken config must not be able to hide a
  vault's files.
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
- **Theming** — every color in `src/page.ts` is a custom property, and the two
  palettes are written once each: light on `:root`, dark on
  `:root[data-theme="dark"]`. No rule reads `prefers-color-scheme`, so that
  attribute is the only answer to which mode is on. The page resolves it — from
  the stored preference, and for `system` from the OS — in a head script that
  runs before the first paint, and again from a `change` listener while the
  preference is `system`. Both entrypoints bake the stored preference into
  `<html>` (`pageForTheme`), so a user who pinned the opposite of their desktop
  never sees the wrong palette flash on launch. `color-scheme` follows the
  attribute, so scrollbars, carets, and native controls match too, and the
  `theme-color` meta reads its value out of the stylesheet rather than repeating
  it.
- **File extensions** — a checkbox in the file list's own toolbar, beside the
  list it redraws and next to Assets, on by default. It started as an Appearance
  menu command, which put it one level too far from the thing it controls: a
  user looking at the file list had no reason to think the palette menu governed
  it. The menu command remains, and the two drive one state, so either redraws
  the other. A wiki is nearly all Markdown, so a column of `Getting_Started.md`
  is noise once a page is open and the tab already names the file; turned off,
  the list drops the extension and shows it only where a name is actually being
  typed, which is the New file prompt and nowhere else. The tab strip and the
  status bar keep it, because a tab is the document's identity rather than one
  entry in a list of similar names. Only `.md` is dropped: a vault's own `.py`
  and `.yml` files are few, and shortening those would make two different files
  look alike. The toolbar wraps below 320px rather than clipping, and the two
  checkboxes are grouped so they wrap as a pair instead of one per line. The row
  still opens by path and carries it in its `title`, so the shorter label is
  display only.
- **Appearance** — `System`, `Light`, and `Dark`, under their own group in the
  menu, stored in the app config beside the sidebar width and restored on the
  next launch. They are rendered as radio items (`menuitemradio` +
  `aria-checked`
  - a check gutter) rather than commands, because a choice has to say which one
    is on instead of firing and closing the menu. What the page does with the
    choice before the first paint is measured rather than assumed — see
    `deno task check:appearance` below.
- **Tabs** — the tab strip holds one buffer per open file. Each tab keeps its
  own text, cursor, scroll position, and undo history, so switching never
  re-reads from disk and never loses an edit; a dot marks unsaved work, × or a
  middle click closes, and `Save` writes the active tab only. The window's close
  handler asks the page which buffers are dirty, so the prompt names the count.
- **Triple click selects the line** — CodeMirror recognises the gesture by
  `event.detail`, which only the browser increments, and only while the clicks
  land inside its own double-click threshold; a third click a moment late resets
  the count and the gesture arrives as one more word selection. The clicks are
  counted in the editor instead, over a window deliberately longer than that
  threshold — Windows lets it be raised well past the 500ms default, and a
  window that merely matched it would break on the very clicks it is meant to
  rescue. This selects the whole _logical_ line rather than the visual one,
  which on a wrapped paragraph is a fragment of what was aimed at, and leaves
  the trailing newline out so deleting the selection does not join two
  paragraphs. It runs as a `domEventObservers` handler because observers run
  before the editor's own, and preventing the default there is what stops
  CodeMirror adding a word selection on top.
- **The vault's path row is shown only with no vault open** — with one open it
  is the root, and that is the one piece of the sidebar header that is pure
  decoration: the name already identifies the folder, and no sidebar wide enough
  to be usable has room for the path anyway. Measured at 338px of text in a
  308px box, so what the user actually read was an ellipsis, for 26px of a
  permanent header. With no vault open the same row is the sentence saying what
  `Open vault…` is for, which is the one time it earns its height, so it is
  hidden rather than removed. The block goes from 86px to 69px.
- **The vault's own actions sit in its heading, as two icons** — they were
  full-width labelled buttons stacked under the vault's name, so the sidebar's
  first read was `Open vault…` directly beneath a vault that was already open,
  closing a vault had the bare word `Close` to say so, and the pair cost 40px of
  a 360px column. The name is the heading and the actions belong to it, the way
  the tab bar's belong to the document: two 24px squares at the end of the
  name's row, so the name keeps the width and ellipsises instead of pushing them
  off the panel. An icon names nothing on its own, so the open button carries
  `Open another vault` once a vault is open and `Open a vault` until then, and
  close is that same folder with a cross through it rather than a bare X — in a
  sidebar a bare X reads as closing the window, the tab or the panel. The file
  list's toolbar goes with the vault rather than sitting there inert: with no
  vault the list is empty, so the filter filtered nothing, the asset and
  extension checkboxes had no list to redraw, and the create button was
  disabled.
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
- **Following a link** — `Ctrl`/`Cmd`+click opens a Markdown link, and holding
  the modifier shows where it goes before you commit to it: the vault-relative
  path for a page, the URL for an external link, and plainly that there is
  nowhere to go when there is nowhere to go. An invisible modifier on a coloured
  word is not a feature anyone finds on their own, so the tooltip is the feature
  and the click is the easy half. The href is read from the syntax tree rather
  than from the text, so a click anywhere in the link finds it — label, brackets
  or target — and a URL containing a `)` resolves the way the parser says it
  does instead of the way a regular expression guesses. `src/markdown_links.ts`
  holds that read and the arithmetic that turns an href into a target, apart
  from the page so both can be tested with no DOM; the editor resolves against
  the document that is showing and the page decides what to do, because the page
  is a classic script with no import to hand and is the part that knows the
  vault. A target outside the vault opens the folder browser at the folder it
  named. External links go to `window.open`: the app runs without `--allow-run`,
  and handing a URL to the OS would mean granting a permission to every task so
  it could shell out per platform. In the desktop webview that opens a window
  rather than the system browser.
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
- **One curated icon set** — every icon in the app is an inline SVG from one map
  in `src/page.ts` (`ICONS`), copied from [Lucide](https://lucide.dev) rather
  than imported so `deno task build` stays a single self-contained artefact.
  They are not characters: a glyph like a panel or a hamburger is not in every
  font the desktop, browser and CI targets ship, where a missing character
  renders as a box, and the one colour emoji that had crept in ignored `color`
  entirely and so could not follow the palette at all. One map means a shape is
  not drawn twice and two controls cannot drift onto the same mark — the sidebar
  toggle and the app menu are squares in the same band of chrome, and were once
  both a `☰`. Each is sized on the element (a bare `viewBox` with no width
  renders at 300x150), inherits `currentColor` from its container, and is
  `aria-hidden`, so every such control carries its name in `aria-label`.
  Typography is deliberately left alone: an ellipsis in a label, a middot
  between shortcut hints and an em dash in prose are part of a sentence, not a
  control.
- **The top bar holds the open document's actions, not the inventory** — `Save`
  is the one control that keeps a word, because it is what you reach for
  mid-sentence and the `Saved` / `Unsaved changes` label beside it is what it
  acts on. Reloading from disk is the same kind of action but the rarer of the
  two, so it keeps a glyph: a 28px stroke-2 arrow whose name lives in
  `aria-label` and `title`, beside the menu, where the rarer commands live.
  `New file` is not a document action at all and has no slot: it is in the menu
  (`Ctrl+N`), the empty state, and the `+` beside the filter in the sidebar.
- **Commands** — one list in `src/page.ts` holds every action (File, Tabs, View,
  Vault) and the menu button in the top bar renders that list instead of
  repeating it in the markup, so a command cannot exist twice or be named in two
  places. The buttons and the keyboard call the same functions, and
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
  bar's own buttons — including the menu button — are clickable once the drawer
  is dismissed (clicking anywhere outside does that).
- The window has no minimum size in either direction. The shell clips its
  overflow rather than scrolling it, so a `min-width` on the body would be a
  floor the window cannot shrink below rather than one the layout grows into,
  and every control past it would be unreachable; the layout instead shrinks,
  the column becoming a drawer, and text that does not fit ellipsises. The vault
  picker's folder list is the dialog's one flexible row, so a short window takes
  its height from the list rather than pushing `Cancel` and `Use this folder`
  out of the dialog. Verified down to 240x360 and across 641x600, 900x280 and
  1200x300.
- The native application menu is not projected; commands are the page's own menu
  button only, and accelerators work because the page handles the keys.
- Files larger than 2 MiB and hidden files/directories are skipped.
- A fixed ignore set (`.git`, `.wiki`, `.cache`, `node_modules`, anything
  dot-prefixed) sits ahead of `wiki.exclude`, and the walk stops at 12 levels or
  5,000 files. Build leftovers a vault does not exclude — Python's `__pycache__`
  and `.pyc`, for instance — therefore show up among its files, as `other`.
- The `Assets` checkbox is per session rather than stored per vault, so it
  starts unchecked the way a vault's own config intends.
- The vault is not watched, so external edits need the refresh button on the tab
  bar (or **Reload from disk** in the menu); it asks before discarding a buffer
  with unsaved changes.

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
