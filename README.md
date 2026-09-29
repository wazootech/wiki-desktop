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

WIKI_DESKTOP_VAULT=/path/to/vault deno test --allow-read --allow-write --allow-env --allow-run=git
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
— opens a document in the editor, and reads the answers back out of the running
page. It takes about ten seconds, needs a display, and exits non-zero on
failure, which is why CI type-checks it and does not run it.

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
- **the editor's own skin** — a fixture document is opened by clicking it in the
  sidebar, and after every one of those mode changes the panel, the gutter, the
  active-line tints, and every highlighted span are compared against that mode's
  tokens. The gutter is the reason this is here: its colour comes from a theme
  extension in `src/editor.ts`, because CodeMirror injects its base theme after
  the page's stylesheet and a rule written in the page loses. Whether the
  extension wins is a fact about cascade order, which only an engine settles.
  Finally the two modes are compared with each other, which is the one claim no
  single case can make on its own: a skin applied once and never updated looks
  correct in whichever mode the app happened to launch in. That comparison is
  made field by field and only where the two palettes declare different values,
  because they legitimately agree on some: the faint ink is the same colour in
  both modes, so it can never be evidence that the skin was reapplied.

One line per check, so it reads as a table or as a gate. Worth knowing when it
fails: it is the only place the appearance is exercised by the engine that
ships, because the desktop window loads its document over the local server — the
pre-paint path here is the real one, not a model of it.

## Layout

| File                      | Role                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`             | Entrypoint: serves the page, adopts the startup window, registers bindings, restores window geometry, guards close with unsaved changes.                                                                                                                                                                                                          |
| `src/page.ts`             | The webview document (HTML, CSS, and JS as one string) — the activity bar and its panes (Explorer, Search, Recently changed), tab strip, editor, vault picker.                                                                                                                                                                                    |
| `src/dev_server.ts`       | Browser transport: serves the page and the same operations over loopback HTTP.                                                                                                                                                                                                                                                                    |
| `src/vault.ts`            | Vault path validation and file operations, including line-ending preservation and the whole-text search behind the Search view. Every path from the webview passes through here.                                                                                                                                                                  |
| `src/wiki_config.ts`      | The vault's own `wiki.yml` (`input`, `assets`, `exclude`), read on the way into a listing so a page and a static file are not the same thing.                                                                                                                                                                                                     |
| `src/config.ts`           | App settings in `~/.wazoo-wiki/config.json` (open vault, recent vaults, window geometry, sidebar collapsed state, width and selected view, appearance, and the file list's three switches as one table).                                                                                                                                          |
| `src/appearance_check.ts` | The appearance check behind `deno task check:appearance`: six cases, driven and read back in the real desktop webview.                                                                                                                                                                                                                            |
| `src/editor.ts`           | The editor's document model, its find panel, and its theme, behind a small handle the page drives. Runs in the webview, so it is the one module that is not a string.                                                                                                                                                                             |
| `src/editor_entry.ts`     | Bundle entry: publishes that handle as `window.WikiEditor` for the page's classic script tag, and the formatter as `window.WikiFormat` beside it — the page is a classic script with no import to reach either by.                                                                                                                                |
| `src/plex_mono.ts`        | IBM Plex Mono, the design system's body face, as two embedded woff2 subsets. Generated, not hand-edited; see the file's own header for how to regenerate it.                                                                                                                                                                                      |
| `src/fence_languages.ts`  | Which grammar highlights a fenced code block, if any. Its own module so the mapping is testable without a DOM, like `vault.ts` and `wiki_config.ts`.                                                                                                                                                                                              |
| `src/format.ts`           | Formatting: a pure function from a page's text to the same text tidied. Its own module for the same reason, and bundled rather than reached over a binding — see the note on formatting below.                                                                                                                                                    |
| `src/editor_bundle.js`    | The built editor, committed and served at `/editor.js` by both transports so the desktop build stays one artifact. CI rebuilds it and fails on any diff, which is the only way drift is visible: `deno task build` makes the binary, not the bundle, so a change to `src/editor.ts` can pass every other check and still serve the old behaviour. |

## How it works

- **Vault** — a folder the user picks. Its absolute path is stored in the app
  config, so the app reopens where you left off. Nothing is written except files
  you explicitly save.
- **The sidebar switches between views** — a 48px activity bar down the left
  chooses what the pane beside it shows, and each pane brings its own toolbar,
  listing and footer. The resizer, the drawer behaviour and the brand stay with
  the sidebar, and the selected view is stored beside the width and the
  collapsed flag. Two consequences worth knowing: the bar is inside the
  sidebar's width, so the minimum column had to grow by the bar's width and the
  width clamp subtracts it before the editor's floor; and at drawer width the
  bar is the only way to change view while the drawer is up, which is fine
  because its buttons are inside the drawer and so never hit the dismissing
  scrim.
- **Three views, and the third was chosen over source control** — Explorer (the
  file list, unchanged), Search, and Recently changed. Search is one new
  operation, `searchVaultFiles`, that walks the listing, reads the text files
  and returns matches grouped by file; a NUL in the opening bytes means "not
  text" and skips the file, and the `MAX_EDITABLE_BYTES` and `MAX_VAULT_FILES`
  bounds already on the walk are what keep it to milliseconds on a wiki-sized
  vault. Recently changed is a sort of the listing by modification time, so it
  needed no operation at all — the walk now records each file's time. A fourth
  view for source control was considered and left out: it would have to be a
  second inventory of the vault's files, and a reader who wants commits wants a
  commit log, which is the thing this app still does not have. What the changes
  view does instead is let a reader commit, which is the half of source control
  a wiki editor actually reaches for.
- **The changes view can commit, and the tick on a row is git's to give** — the
  list says when a file was written, which the walk already knows, and git says
  whether there is anything to commit about it, which only git knows. So a row
  gets a checkbox only where git reports a pending change, and a checkbox beside
  a file with nothing pending would be one that cannot do anything. Each pending
  file starts ticked, because unticking is the decision and ticking is the
  absence of one; the reader still writes a message and presses the button. The
  paths go to the backend rather than a "commit everything" flag, so a commit
  from the pane can only ever contain what was ticked, and a file somebody else
  staged in another window is left where it was.
- **The box can amend and push, and refuses to force either idea** — amend is
  the same gesture as commit with a different verb, so it takes the same ticked
  paths and the same message line and sits beside the Commit button rather than
  on a row of its own. The usual reason to amend is a subject line somebody
  would rather not live with, and the reader is already standing there with the
  files ticked; leaving to amend means leaving the app, and reaching for a
  terminal over a working tree this app has open. It is refused for exactly one
  thing: a last commit the remote already has, because replacing that is not an
  edit anybody else can see, it is a divergence. The button greys out and the
  branch line says which commit it is; the backend refuses it again, because a
  disabled button is a hint and not a boundary. A commit that is not pushed yet
  is squarely amendable, which is the case that is actually common. Push takes
  **no arguments at all**. The destination is read out of `branch.<name>.remote`
  and `branch.<name>.merge` on the other side rather than chosen by the page, so
  there is nothing for a mis-click to aim and nothing for anything else to aim
  either; a branch with no upstream is refused rather than guessed at, because a
  wiki's repository is as likely to be a colleague's personal one as anything
  else. There is no `--force`, no `--all` and no refspec anybody typed, so a
  branch that is behind is refused with git's own reason rather than resolved —
  the pane says "1 commit behind, so pull before pushing" and names the step it
  cannot take itself. What "up to date" means is git's answer, so the status is
  asked for again after a push rather than decremented in the page.
- **`GitStatus` carries where the branch stands, so the box need not guess** —
  `remoteInfo` asks git for the branch, its upstream, the two counts and whether
  HEAD is already an ancestor of the upstream, which is the question behind the
  amend refusal. Every field can be null for a different reason — a detached
  HEAD, a branch never pushed, an upstream this clone has not fetched — and the
  pane says which, because "nothing to push" and "we cannot tell whether there
  is anything to push" are different sentences and only the first is an answer
  the button can act on. It rides along with the status rather than being its
  own operation, because the two go out of date together.
- **`src/git.ts` shells out to git, and is the only file that does** —
  reimplementing the index, the packs and the merge machinery is not a thing a
  wiki editor should carry, so the app asks git instead. The tasks therefore
  grant `--allow-run=git` and nothing else, which is a narrower permission than
  the `--allow-run` this app was built without: a test asserts the binding layer
  itself launches no process, and git is the one caller of `Deno.Command` in the
  tree. `git` is also the app's first dependency on a program being _installed_,
  so "git is not on the PATH" and "this folder is not a repository" are two
  different sentences and neither stops the rest of the app — the second is the
  normal state of most vaults. Two things about the arrangement are deliberate
  rather than incidental. Every path is checked by `normalizeVaultPath` before
  it is used and lands after a `--`, so a wiki file called `-n.md` is a file and
  a file whose name is a shell command is a name. And the commit uses the
  _pathspec_ form of `git commit`, not `git add` followed by a bare commit: it
  builds the commit from HEAD plus the named files and leaves the index alone,
  so a commit from here cannot sweep up something another window staged, and
  cannot be surprised by the order the two operations happened in.
- **The changes view is two panes, because a source control panel is two
  things** — a source control panel answers "what changed" and "what changed
  when" at once, and one pane can only be one of those. So the view is split:
  **Changes** (the listing, newest write first, with the time under each name)
  above a draggable divider, and **History** (the same writes as days, newest
  day first, on a rail) below it. Each header folds its own section and carries
  its own count, so a folded section is still sizeable without being opened, and
  the divider keeps the sidebar resizer's contract — arrows to nudge, Shift for
  a bigger nudge, Home and End for the ends, double-click to even them out. The
  split is a ratio rather than a height, because the pane's height belongs to
  the window, and it is remembered: the share is stored in the app config beside
  the sidebar width and put back before the first paint of the next launch. It
  used not to be, on the grounds that a split set once is not a preference — but
  the reader who dragged the history down to a rail did it because of what they
  were reading, and they will be reading the same vault tomorrow.
- **The history is days, not commits** — `activityByDay` in `src/vault.ts`
  buckets the listing under each file's local midnight, dropping a file the
  filesystem could not date rather than filing it under the epoch. It is one
  function, tested there, reached through the `vaultActivity` operation, because
  the page is a string that cannot import it and a second copy of the rule would
  be a second answer to "what day is this" with only one of them under test.
  There is no commit graph, for the same reason there is no source control: the
  only history a wiki reader has is when each file was last written.
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
- **Colours come from `wazoo.dev/DESIGN.md`, not from this file** — the two
  palettes in `src/page.ts` are that file's twelve tokens spread over the roles
  the app needs: Eggshell and Ink for light, Void and Surface for dark, Sunset
  Orange for anything the user can act on, and the spec's purple only behind
  selected text. The values are copied rather than read, because a clone of this
  repository does not bring that file along and a build that failed without it
  would be worse than a copy; `src/page_test.ts` is what notices the copy going
  stale. Three places depart from a literal reading, each for a reason the
  comment beside it gives: where the spec names one value for a role this app
  needs several of, the extras are neutral steps between the values it does
  name, which is what keeps the greys warm; the light palette's word-carrying
  accent is a darkened orange, because Sunset Orange on Eggshell is 2.1:1 and
  dark can keep the brand's own value at 9:1; and the text on a brand-coloured
  control is Ink rather than white, which is 7.3:1 against 2.3:1. The native
  checkboxes take `accent-color` from the brand too, since it is the one part of
  a platform control the palette does not otherwise reach.
- **The body face is embedded, and the wordmark is not** — `wazoo.dev/DESIGN.md`
  puts IBM Plex Mono on body copy, buttons, tooltips and code, which is most of
  this app, and Inter on the logotype. Neither was being loaded at all: the
  stack named a locally installed `Inter` and no `@font-face` ever fetched it,
  so every toolbar rendered in whatever the machine happened to have installed —
  which is how a sidebar could come out in a serif face on a desktop with no
  Inter on it. Plex Mono is now embedded from `src/plex_mono.ts` as two subsets,
  latin and latin-ext, because an offline app has to look the same with no
  network and a vault's filenames are user data that can perfectly well contain
  an umlaut; that is 28KB of woff2 and 37KB of base64, which is the price of the
  face. The wordmark keeps a named local sans with a real fallback, because
  promising Inter without shipping it is the bug being fixed here. The design
  system's own `letter-spacing: -0.025em` is on the body, which is what makes
  the mono read as set rather than typed.
- **Bindings** — `win.bind(name, handler)` exposes Deno functions to the webview
  as `bindings.name(args)`. They run in-process (no socket IPC) and inherit the
  runtime's permissions, so the tasks start Deno with
  `--allow-read --allow-write --allow-env` and, for the one operation that
  shells out to git, `--allow-run=git`.

  **The page calls them with a spread, never `.apply`.** One function reaches
  every operation: `bridge[name](...(args || []))`. The desktop runtime hands
  the webview a proxy whose property access _is_ the binding name, so reading
  `.apply` off the function it returns asks for a binding called
  `getState.apply` and the call is refused — every operation in the app fails
  and the window sits on the empty state toasting
  `No binding for 'browse.apply'`. The browser bridge returns a plain function,
  so the dev server and the string tests cannot see it, and
  `src/appearance_check.ts` stubs the bindings outright, so the one check that
  runs in the real webview could not either. It was found by calling one binding
  three ways in the real runtime; `src/bindings_test.ts` now pins the call form
  so it cannot come back.
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
- **The file list's three switches** — `Assets`, `Extensions` and `Paths`, three
  checkboxes in the file list's own toolbar, beside the list they redraw. They
  are one setting in kind and are now one setting in code: a table in
  `src/page.ts` declares each one's label, tooltip, menu wording and stored key,
  and that table draws the markup, the change listeners, the items in the
  Appearance menu, and the operation that persists it. What each one _changes_
  is still written out separately, because a shortened name, a missing second
  line and a filtered list are three different edits. Every switch is stored in
  the app config and restored on the next launch, which is the point: Assets
  used to be per-session while its two neighbours persisted, and the reason was
  that it was the one switch nothing else was written in terms of. One rule
  reads them back — a stored boolean is believed, anything else falls back to
  that switch's own default — so both polarities are covered without two
  versions of the rule, and a config written before a switch existed keeps the
  layout it had. Each item is a `menuitemcheckbox` with `aria-checked`, because
  a state has to say which way it is on rather than fire and close the menu.
- **File extensions**, on by default. It started as an Appearance menu command,
  which put it one level too far from the thing it controls: a user looking at
  the file list had no reason to think the palette menu governed it. A wiki is
  nearly all Markdown, so a column of `Getting_Started.md` is noise once a page
  is open and the tab already names the file; turned off, the list drops the
  extension and shows it only where a name is actually being typed, which is the
  New file prompt and nowhere else. The tab strip and the status bar keep it,
  because a tab is the document's identity rather than one entry in a list of
  similar names. Only `.md` is dropped: a vault's own `.py` and `.yml` files are
  few, and shortening those would make two different files look alike. The row
  still opens by path and carries it in its `title`, so the shorter label is
  display only.
- **Folder paths**, on by default. That line is why the file list is as tall as
  it is: it is a second line under every row, and in a vault one folder deep —
  the usual shape of a wiki — it is the same word repeated down the whole
  column. Turned off, a row is one line, and the height of a row in `wiki/docs`
  drops from 37px to 24px. The span is left out of the row rather than hidden
  with CSS, because a `display: none` node is out of sight but still in the tab
  order and still read aloud. The row's `title` keeps the full path, so a reader
  who wants it hovers or focuses the row.
- **Assets**, off by default, and hidden entirely in a vault that declares no
  static files. The vault's own `wiki.yml` decides what is a page and what is an
  asset, so a build output folder beside four hundred pages is not what a wiki
  looks like. It is stored anyway, because a user who ticked it once meant it.
  The list reads the stored state rather than the checkbox, which is what makes
  the preference survive a vault that has nothing to offer: the checkbox is a
  mirror of the state, never the source of it. The toolbar wraps below 320px
  rather than clipping, and the checkboxes are grouped so they wrap together
  instead of one per line.
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
- **The folder dialog is the app's way in, and its home screen** — there is no
  "no vault" panel. It used to be one: a folder glyph, a sentence, and a button
  whose only job was to open the folder dialog, so the app had two surfaces for
  one action and the first click bought nothing. The dialog now opens itself
  when there is no vault, and the sidebar's button opens that same dialog when
  there is one, so closing a vault and opening another are the same gesture.
  With nothing open it is the app, so it says `Open a vault` rather than
  `Open another vault`, says in the intro that no vault is being closed, and
  offers no way out of itself — `Cancel` is hidden and `Escape` does nothing,
  because there is nothing to go back to. Choosing a folder takes it down
  through the one path allowed to, which is the bug the guard caused when it did
  not: the guard reads the state as it is, and a user with no vault is exactly
  how a vault gets opened.
- **The vault's path row is shown only with no vault open** — with one open it
  is the root, and that is the one piece of the sidebar header that is pure
  decoration: the name already identifies the folder, and no sidebar wide enough
  to be usable has room for the path anyway. Measured at 338px of text in a
  308px box, so what the user actually read was an ellipsis, for 26px of a
  permanent header. With no vault open the same row is the sentence saying what
  `Open vault…` is for, which is the one time it earns its height, so it is
  hidden rather than removed. The block goes from 86px to 69px. The whole path
  is one right-click away while a vault is open, though — see the header's own
  menu below.- **The vault header has its own menu, and it is one command** —
  right-click the name for `Copy vault path`, which is the only honest way to
  get the full path out of a sidebar that no longer shows one. It is a command
  in the same list as everything else, marked `context: true`, so the header's
  item and the app menu's entry are one entry with one run path rather than two
  copies. With no vault open the menu does not open at all: a menu of one
  greyed-out item is a worse answer than no menu. `Close vault` could have
  joined it for the same reason `Open vault…` did not — it is already in the app
  menu, one level from the panel rather than on it.

  **Reveal in Explorer is deliberately not there.** `deno desktop` has no
  file-manager API — `Deno.BrowserWindow` offers `bind`, `executeJs` and menus,
  and nothing else — so it would mean a `Deno.Command` and a wider `--allow-run`
  on the desktop tasks than the one scoped to git. Copying the path is the part
  a user can act on from the clipboard, so that is what shipped; a test asserts
  the binding layer launches no process of its own, so the decision cannot be
  quietly reversed by a second caller appearing there.
- **The vault header carries one action, and the rest are menu entries** — it
  was a row of two full-width labelled buttons stacked under the vault's name,
  so the sidebar's first read was `Open vault…` directly beneath a vault that
  was already open, closing a vault had the bare word `Close` to say so, and the
  pair cost 40px of a 360px column. It is now one 24px folder at the end of the
  name's row, so the name keeps the width and ellipsises instead of pushing it
  off the panel, and an icon names nothing on its own, so the button carries
  `Open another vault` once a vault is open and `Open a vault` until then.

  **Closing a vault is a menu entry, not a second button.** VS Code's File menu
  has `Open Folder…` and `Close Folder` as entries and neither of them as a
  button on the folder; the same split reads here as opening a different vault
  from the panel you are in, and closing the current one from the menu's `Vault`
  group, where it sits under the name it always had next to `Copy vault path`
  and is disabled when there is nothing to close. One command, one place to
  reach it from. It took the crossed-folder glyph with it, which left the folder
  as the last user of that geometry and the shared `FOLDER_PATH` constant as the
  last user of a constant.

  The file list's toolbar goes with the vault rather than sitting there inert:
  with no vault the list is empty, so the filter filtered nothing, the asset and
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
  dark mode. That the extension wins is checked in the real webview rather than
  assumed, by `deno task check:appearance`.
- **Find is the editor's panel, and the app takes `Ctrl+F` to show it** —
  `Find in page` opens CodeMirror's own search panel, so the matches, the count,
  the wrap-around and the "no results" state are the editor's state rather than
  a second set of answers kept in step by hand. The browser's own find is the
  wrong tool here and not merely a different one: CodeMirror renders only the
  lines near the viewport, so find-in-page can only ever match what happens to
  be on screen, and the sentence a reader wants in a long wiki page is usually
  the part that is not rendered. That is why the chord is taken with
  `preventDefault` — and why this is the one place the app overrides a browser
  shortcut it does not own. The distinction from `Ctrl+Shift+I` is _whose_ key
  it is: developer tools belongs to the host, find belongs to the document the
  host is showing. `highlightSelectionMatches` also marks the other occurrences
  of a selected word without being asked, which is the moment the reader was
  about to press the key. The panel arrives light-styled on a hard-coded white
  bar, so it is re-tokenized in the theme extension beside the gutter, for the
  same reason: CodeMirror injects its base theme above the page's stylesheet. It
  is the most expensive dependency the editor takes on — `@codemirror/search`
  measured **+27.3 KB minified, +9.0 KB gzipped**, 4.3% of the pre-search
  bundle, which is seven times what the formatter cost and still 1.8% of what
  `@codemirror/language-data` was rejected for.
- **Find has no replace row until something asks for one** — CodeMirror builds
  Replace into the panel whenever the editor is writable, so left alone this app
  ships a field and two buttons that rewrite the page in place, with no preview,
  inside the one panel that reads as read-only. It would have been the app's
  only bulk-rewrite surface, one Enter away from a page nobody had looked at
  yet. Neither reference widget does that, and both are copied here: VS Code
  opens find on `Ctrl+F` and adds the row on `Ctrl+H`, and the p5.js Web Editor
  puts Find and Replace on separate chords too (`Ctrl/Cmd+F` against
  `Ctrl/Cmd+Alt+F`, following Sublime). So `Replace in page` is its own command
  on `Ctrl+H`, and find is find. The row is _hidden rather than disabled_, and
  the difference is the whole guarantee: `display: none` takes the field out of
  the tab order and out of the accessibility tree, so there is nothing to tab
  into, nothing announced, and no button to press by accident — a disabled field
  is still all three. A panel that is already up keeps the row it is showing, so
  `Ctrl+F` during a replace does not pull the field out from under the user. The
  flag rides on the editor root rather than the panel, because the root is there
  synchronously when `openFind` runs and the panel's own element appears in a
  later update.
- **Find and replace come with more than their two chords, and the app picks
  which** — `searchKeymap` is registered **minus one entry**. What it brings:
  `F3` and `Ctrl+G` step to the next match, `Shift+F3` and `Ctrl+Shift+G` to the
  previous, `Escape` closes the panel, `Enter` and `Shift+Enter` work inside the
  field, and `Ctrl+D` and `Ctrl+Shift+L` are the multi-cursor pair the app keeps
  on purpose rather than filtering out. `Ctrl+Alt+G` (go to a line) is the one
  refusal, and it goes for a smaller reason: line numbers are in the gutter so
  it is not meaningless, but find is already how a reader moves around a page
  and it has three ways into next and previous, while the jump a wiki author
  actually reaches for is to a heading — not built yet, and `followLink` in
  `src/page.ts` says so when it is asked for. It is also the only three-modifier
  chord of the set, which is the most collision-prone part of a keyboard. That
  refusal is matched by **the command a binding runs, not the key it sits on**,
  so a CodeMirror release that rebinds go-to-line still has it dropped. None of
  this is in the menu's shortcut column, because that column is for the chords
  the page's own keydown handler implements and these are CodeMirror's;
  advertising them from a list that does not own them is how a label and the
  thing it labels drift apart. The surviving set is pinned by a test that reads
  the resolved keymap out of a real `EditorState` instead of matching a string
  in `src/editor.ts`, and the four multi-cursor chords are pinned by a second
  test that asserts _both_ halves — each command is bound, and the facet that
  makes it real is on — so neither half can be dropped without a failure.
- **Multiple cursors are on, and the editor says so by binding them** — this app
  shipped the opposite decision first, and the reason it reversed is the part
  worth keeping: the chords were refused because they were **dead**, not because
  the mode was unwanted. `EditorState` collapses a selection of more than one
  range with `asSingle()` unless `allowMultipleSelections` is set, so with the
  facet off `Ctrl+D` dispatched a second occurrence and got a single range back
  — measured in the running app rather than reasoned about, where a word
  selected plus `Ctrl+D` and a keystroke replaced **one** occurrence and not
  two. Holding that position meant using this editor to actively refuse four
  working chords by command identity, against whatever `@codemirror` does next,
  and the facet is one line. So the mode is on, and what it creates is four
  chords: `Ctrl+D` with a caret selects the word under it and pressed again adds
  the next occurrence of that text as a second cursor, so one keystroke then
  edits every one of them in a single undo step; `Ctrl+Shift+L` selects every
  occurrence of one selection in a pass; `Ctrl+Alt+ArrowUp` and
  `Ctrl+Alt+ArrowDown` stack a caret above and below; and `Escape` drops back to
  the single main range, which is the selection `Ctrl+D` started from. The two
  text-driven chords reach the same set of cursors from two directions rather
  than in sequence — `Ctrl+D` refuses once the ranges have stopped holding the
  same text, and `Ctrl+Shift+L` refuses with more than one range at all, so
  pressing it after two `Ctrl+D`s does nothing — and both are silent when they
  cannot act, which is what a chord doing arithmetic on the selection should do.
  Nothing else had to change for any of it: `drawSelection` already renders the
  extra carets, the theme already paints `.cm-cursor`, and
  `highlightSelectionMatches` was already tinting every occurrence of the
  selected word, which turns out to be the preview of what `Ctrl+Shift+L` does.
  The status bar is the one place the mode shows up as an absence — it reports
  the primary cursor (`selection.main`), not a count, so a second cursor is
  visible in the document and nowhere else.
- **Which keymap answers a chord is declared, not positional** — the find chords
  are wrapped in `Prec.high` rather than spread first inside a single
  `keymap.of`. The behaviour is the same; what changes is that "find wins" stops
  being a fact about an array index. The version before this ranked them by
  position, which works and is not fragile on its own, but it means the next
  extension to bring bindings has to notice the ordering before it can work out
  where to place itself. `Prec` is the API CodeMirror has for saying it where
  the chords are declared, and the test that guards it reverses the editor's
  extension list and asserts the find chords still come first — a property a
  positional keymap could not have.
- **Fenced code is highlighted by its language** — `src/fence_languages.ts` maps
  a fence's info string to a grammar for the fourteen languages this vault
  actually uses (`bash`, `yaml`, `sparql`, `python`, `json`, `toml`,
  `powershell`, `javascript`, `jsx`, `typescript`, `tsx`, `html`, `xml`,
  `turtle`), plus the aliases a wiki writes (`sh`, `zsh`, `py`, `yml`, `js`,
  `ts`, `ps1`, `pwsh`, `rq`, `ttl`). It is a hand-picked subset rather than
  `@codemirror/language-data`, which measured 1,527 KB against this editor's 514
  KB, and whose `load()` is a dynamic import that `deno bundle` inlines anyway —
  a grammar that never runs still costs its bytes. The twelve lezer and ported
  grammars measured **+83 KB minified, +33 KB gzipped**, 5% of the registry, and
  the two RDF modes added **+5.7 KB minified, +1.6 KB gzipped** on top of that
  (`deno bundle --platform browser --minify`, then `gzip -9`). They resolve a
  grammar for 121 of the vault's 124 named fences.

  The lookup reads only the **first word** of the info string, because it is
  free text: a real page carries `` ```ts twoslash title=example ``, where the
  rest belongs to a tool. Anything it cannot resolve returns null — an
  unlabelled fence, a typo, a half-typed word — and the block renders exactly as
  it did before, so adding or mistyping an info string stays an ordinary text
  edit and nothing can throw. The three fences that still resolve to nothing are
  the `markdown`-labelled wrappers in `Dataview_Integration.md`, left alone
  deliberately: they document a syntax rather than hold code a reader copies,
  and a nested Markdown grammar inside a Markdown fence is its own decision.

  **`sparql` (19 fences) and `turtle` (1) used to be refused here**, on the
  finding that neither has a maintained CodeMirror 6 grammar and that a
  third-party one is not a dependency to take on for 15% of the vault's fences.
  The search was for a _lezer_ grammar, and it missed the package that was
  already installed: `@codemirror/legacy-modes` — the dependency behind `bash`,
  `powershell` and `toml` above — carries `mode/sparql` and `mode/turtle`, and
  `@codemirror/language-data`, the registry rejected on size two paragraphs up,
  is itself a list of descriptions that load those two out of that package. So
  the two most wiki-shaped languages in the vault were the ones left flat. They
  now take the same route as the other modes: 70.3% of the `sparql` fences'
  visible characters carried a colour under the twelve-tag palette, 95.6% carry
  one with the palette widened below, against none before either.

  **Resolving a grammar is not the same as colouring the block**, and the second
  half was the bug behind #35: a block could parse perfectly and still render as
  prose, because the style named twelve tags and the grammars emit more. `yaml`
  was the loudest case — 29 fences whose keys are tagged
  `definition(propertyName)` and whose plain scalars are tagged `content` — but
  the same hole swallowed every identifier in bash, python, json and toml. Two
  rules close it: `t.name` for a name the grammar distinguishes (a YAML key, a
  variable, a property, an attribute, a label, and their `definition(...)` and
  `special(...)` variants) onto a new `--syntax-name` token, and the two
  literals a grammar does not quote — a plain scalar and an IRI — onto the
  string colour. `typeName` still wins over `name` because a tag's inheritance
  chain is tried most-specific first. What is deliberately left at the body
  colour is the punctuation family: separators, brackets, operators.

  The second of those two is where the author's own first attempt went wrong,
  and the file keeps the scar: `content` is the one rule that is **scoped to a
  grammar** rather than applied to the document. `@lezer/highlight` defines the
  tag as "plain text in XML or markup documents", and a YAML plain scalar
  (`givenName: Alice`), an html text node, an xml one and a JSX text node all
  carry it — but so does every `Paragraph` `@lezer/markdown` produces, so a
  document-wide rule for it rendered the sentence you are reading in the string
  colour, which is how it was caught: by looking at a page. The tag cannot tell
  a scalar from a sentence; the grammar can, and `HighlightStyle.define`'s
  `scope` is how a style asks — applied once per tree against its top node type,
  which inside a fence is the fence's grammar and never the document's. So
  `yamlLanguage`, `htmlLanguage`, `xmlLanguage` and the JavaScript family each
  get a style for that one rule. Four styles for five grammars, because jsx and
  tsx are configured copies of `javascriptLanguage` and configuration keeps a
  language's data, so a scope pointed at one of the four accepts all four —
  harmless here, since none of the others tags anything `content`.

  `src/syntax_tokens_test.ts` is what holds that. It parses one fixture per
  language in this table through `fenceLanguage` and fails on any tag no style
  in `markdownHighlightStyles` reaches _for that tree_ — a grammar cannot be
  added without a colour for it, a rule cannot be dropped quietly, and neither
  can a scope be pointed at the wrong grammar or at the document. It cannot see
  the rendering (a nested language only enters the tree once a view drives the
  parse context), so the colours themselves are still checked by opening the
  app: prose in `--text-editor`, a YAML fence's keys in `--syntax-name` and its
  scalars in `--syntax-string`.

  This is what makes the last four syntax tokens live. `keyword`, `string`,
  `number` and `type` were mapped in the highlight style from the start and
  rendered nothing, because the Markdown grammar does not parse fence contents;
  the grammars produce the tags and the existing tokens colour them, with no
  change to the stylesheet.
- **Page frontmatter is parsed as YAML, not as Markdown** — `documentLanguage`
  in `src/editor.ts` wraps the Markdown language in `@codemirror/lang-yaml`'s
  `yamlFrontmatter`, so the `---` block every page opens with is a YAML tree
  instead of a paragraph and a bullet list: `- schema:TechArticle` was a list
  item, `type:` part of a sentence, and neither was parsed by anything. What
  made that visible was pulling on the colour — the only reason the frontmatter
  looked highlighted at all was the palette rule for `content` that also
  rendered the prose green, because both were the same tag in the same tree. Now
  the keys take `--syntax-name`, the scalars `--syntax-string` through the same
  scoped rule a yaml fence uses, and both `---` lines take `--syntax-marker`.

  The cost, stated rather than discovered: a file that opens with `---` and
  never closes it is frontmatter as far as this parser is concerned, so the rest
  of it is read as YAML until a closing line arrives. That is upstream's rule
  rather than a setting. Measured across the vault: all 87 pages open with
  `---`, all 87 parse their frontmatter as a yaml tree, and not one document in
  the vault has an error node anywhere. A new file is created empty
  (`createFile(path, "")`), so the case is reachable only by typing `---` on the
  first line of a page and carrying on, and it resolves the moment the second
  `---` is typed. `src/syntax_tokens_test.ts` parses a whole document through
  the language the editor actually installs and asserts the four claims
  together: a yaml tree above, a key tagged as a name, a scalar tagged
  `content`, and below the closing `---` a Markdown `Paragraph` carrying that
  same tag that is **not** coloured. Replacing the document language with plain
  Markdown fails it on the first of those.
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
  named. External links go to `window.open`: the app grants `--allow-run` for
  git alone, and handing a URL to the OS would mean a permission every task
  carries so it can shell out per platform. In the desktop webview that opens a
  window rather than the system browser.
- **Line endings** — the editor's document holds LF only, and the file keeps the
  ending it arrived with. `src/vault.ts` converts on the way in and back on the
  way out, so fixing a typo in a CRLF page is a one-line diff rather than a
  whole-file rewrite. A BOM is preserved for the same reason.
- **Formatting is a function, not a subprocess** — `Format page` in the File
  menu, or `Shift+Alt+F`, runs `src/format.ts` over the text the editor holds
  and hands the result back through `applyFormatted`. It is a pure `string` to
  `string` and it never touches the file on disk, which is what makes it correct
  on a tab with unsaved work in it. The alternative was shelling out to the
  `wiki` CLI, and that is wrong here twice over: the app runs without
  `--allow-run` on purpose (see _Reveal in Explorer_ above), and `wiki fmt`
  takes only existing file paths and writes them back — no stdin — so it would
  reformat the copy on disk and lose the edits. Routing it through the app's own
  read/write path would also have been better on line endings, which
  `src/vault.ts` already gets right per file and `wiki fmt` does not. It was
  `Ctrl+Shift+I` to begin with, which is the chord every browser has bound to
  its developer tools for twenty years: the desktop webview ships without
  devtools so nothing happened there, and in `dev:web` the press opened a
  console the user had not asked for. A shortcut that fights the host is not a
  shortcut, and nothing in this app's own checks can see the collision — hence a
  test that names the browser's reserved chords instead.
- **Formatting every open page is the same call, run over the tab strip** —
  `Format all open pages` filters the tabs to the ones the vault calls pages and
  runs the identical format-and-apply over each, so there is no second formatter
  to disagree with the first and no second answer to what a page is. The tab on
  screen goes through `applyFormatted`; the others are formatted in place on the
  page's own buffer, which `stashCursor` keeps in step and the editor reconciles
  the next time that tab is shown. Switching to each tab in turn would have kept
  the per-tab undo stacks, at the price of scrolling the window around under the
  user — and a tab whose text changed underneath it loses that stack anyway when
  the editor rebuilds its state, which is what `Reload from disk` has always
  done. The summary counts against the number of open pages, because "Formatted
  3" is a different piece of news when three were open and when three hundred
  were, and it names any open file it skipped for not being a page.
- **What the formatter will not do is most of it** — headings get one space and
  lose a closing run, bullets become dashes, task boxes lose their extra
  spacing, tables are aligned to their widest cell, and a document ends on
  exactly one newline. It leaves fenced code, frontmatter, setext headings, hard
  line breaks, blank-line runs, emphasis markers, and ordered-list numbering
  alone, and each of those is a test in `src/format_test.ts` rather than a
  caveat. Two of them are the kind of thing a formatter is expected to get
  wrong: two trailing spaces are a hard line break, so stripping trailing
  whitespace would silently join lines; and intraword `__` is not emphasis while
  intraword `_` is, so rewriting `__bold__` to `**bold**` would change what
  `snake__case__name` means. Only pages are formatted — the vault's own
  `wiki.yml` decides what a page is, and formatting its README or its config is
  a change nobody asked for.
- **A format is one undo step, and it is not a save** — `applyFormatted`
  replaces the whole document, because a formatter reads the page rather than a
  range, and maps the selection through the change so a reflowed paragraph does
  not drop the user at the top of the file. It is a plain edit: the tab goes
  dirty and the user saves it like any other, which is the honest state for a
  change they have not looked at yet. Text that is already tidy changes nothing
  at all, so pressing the key on a clean page costs no transaction and leaves no
  dirty dot.
- **The formatter's bundle cost is measured, the way the fence subset's was** —
  it is bundled into `src/editor_bundle.js` rather than reached over a binding,
  and measured **+3.9 KB minified, +1.5 KB gzipped**, 0.6% of the bundle. That
  is the argument for a bounded hand-rolled pass over an AST round trip: this is
  13 tests and a few hundred lines against a remark/mdast pipeline's megabytes,
  and the passes here are chosen so that a line they do not apply to comes back
  byte-identical.
- **Sidebar** — the panel icon at the top-left collapses the column on wide
  windows (the editor reflows into the space) and slides it in as a drawer below
  640px. It is one action with two affordances: the brand row's while the
  sidebar is showing and the tab bar's once it is collapsed, so the control
  stays in the window's top-left corner and never strands itself. The collapsed
  state is stored in the app config, so it survives a restart. The two layouts
  keep different states for that one control — a collapsed column against a
  closed drawer — so the wording is derived from whichever layout is on screen,
  and re-derived when a window crosses 640px. It is derived for the `title` as
  well as the `aria-label`, because the tooltip is the one a mouse user reads:
  the buttons shipped with the wording each layout starts in, so after the first
  collapse the brand toggle's tooltip still said "Hide vault files" while the
  control beside it said "Show".
- **A file row says what it is, not only what colour it is** — the row for the
  document on screen carries `aria-current`, and an asset row — one the vault's
  config lists as static rather than as a page — carries a visually hidden
  "static file". Both were drawn states and nothing else: brand colour and a
  rail for the open ones, a dimmed row for the assets, which a screen reader
  cannot see. The note goes in the row rather than in an `aria-label` that would
  replace the visible name and break voice control.
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
  autocomplete or code folding yet.
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
