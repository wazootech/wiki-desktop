import { basename } from "node:path";

import {
  clampSidebarWidth,
  clampSplitRatio,
  coerceSidebarView,
  coerceTheme,
  homeDirectory,
  LIST_VIEW_DEFAULTS,
  type ListViewKey,
  type ListViews,
  type ListViewSetter,
  listViewsOf,
  listViewValue,
  loadConfig,
  setterFor,
  type SidebarView,
  type ThemePreference,
  updateConfig,
  withRecentVault,
} from "./config.ts";
import {
  activityByDay,
  type ActivityDay,
  assertVaultRoot,
  browseDirectory,
  createVaultFile,
  type DirectoryListing,
  listVaultFiles,
  readVaultFile,
  type SearchHit,
  searchVaultFiles,
  VaultError,
  type VaultFile,
  type VaultFileContents,
  writeVaultFile,
} from "./vault.ts";

/** Everything about the open vault that is not a list-view switch. */
export interface VaultStateBase {
  /** Absolute path of the open vault, or null when none is open. */
  root: string | null;
  /** Folder name of the open vault, for display. */
  name: string | null;
  recents: string[];
  /** Whether the file sidebar was collapsed when the app last ran. */
  sidebarCollapsed: boolean;
  /** Width of the file sidebar column in CSS pixels. */
  sidebarWidth: number;
  /** Which sidebar view was showing, from the activity bar's list. */
  sidebarView: SidebarView;
  /** The changes pane's share of the changes/history split, 0.2 to 0.8. */
  splitRatio: number;
  /** Light/dark appearance the user last chose, `system` if they never did. */
  theme: ThemePreference;
}

/**
 * The state the page reads at launch, the switches included.
 *
 * The switches arrive as one group because they are stored as one group and
 * sanitised by one rule, and a state that has to name them one by one is a
 * state where a fourth is easy to forget.
 */
export type VaultState = VaultStateBase & ListViews;

/** The name of the operation that stores one switch, from its key. */
export type { ListViewSetter } from "./config.ts";

/**
 * The API the webview sees as `bindings.<name>(...)`. Both the desktop
 * bindings and the HTTP transport in src/dev_server.ts implement this shape,
 * and src/page.ts calls it, so the contract lives in one place.
 */
export type WikiBindings =
  & {
    /** Current vault plus the list of recent vaults. */
    getState(): Promise<VaultState>;
    /** Every editable file in the vault, Markdown first. */
    listFiles(): Promise<VaultFile[]>;
    readFile(path: string): Promise<VaultFileContents>;
    writeFile(path: string, content: string): Promise<VaultFileContents>;
    createFile(path: string, content?: string): Promise<VaultFileContents>;
    /** List subfolders of `path` for the in-app vault picker. */
    browse(path: string | null): Promise<DirectoryListing>;
    /**
     * Every line of every listed file containing `query`, grouped by file.
     *
     * The whole of the search backend, and one operation rather than several
     * because there is nothing to keep between calls: the listing is already
     * loaded, so a search is a scan that returns matches.
     */
    search(query: string): Promise<SearchHit[]>;
    /**
     * The listing as a history: writes grouped under the day they happened.
     *
     * Its own operation because the day a write belongs to is decided once, in
     * src/vault.ts, and the page is a string that cannot import it. Reading it
     * here is the same trade the search view makes: the pane asks for what it
     * draws rather than re-deriving it from a listing it happens to hold.
     */
    vaultActivity(): Promise<ActivityDay[]>;
    openVault(path: string): Promise<VaultState>;
    closeVault(): Promise<VaultState>;
    /** Remember whether the sidebar is collapsed, so it survives a restart. */
    setSidebarCollapsed(collapsed: boolean): Promise<VaultState>;
    /** Remember the sidebar column's width, so it survives a restart. */
    setSidebarWidth(width: number): Promise<VaultState>;
    /** Remember which view the sidebar is showing, so it survives a restart. */
    setSidebarView(view: string): Promise<VaultState>;
    /**
     * Remember where the changes/history split sits, so it survives a restart.
     *
     * Clamped for the same reason the width is: the page is a caller like any
     * other, and a stored ratio outside the ends the divider can be dragged to
     * is a split the user could not have put there and could not undo.
     */
    setSplitRatio(ratio: number): Promise<VaultState>;
    /** Remember the appearance, so it survives a restart. */
    setTheme(theme: string): Promise<VaultState>;
  }
  & {
    /**
     * Remember one of the file list's switches, so it survives a restart.
     *
     * One operation per switch, generated from the table in src/config.ts, so the
     * stored surface and the page's list of controls cannot disagree about how
     * many switches there are. Hence the type rather than an interface: an
     * interface cannot carry a mapped member.
     */
    [Name in ListViewSetter]: (show: boolean) => Promise<VaultState>;
  };

/** The same operations as plain functions, ready for any transport. */
export type VaultApi = {
  [Name in keyof WikiBindings]: (
    ...args: Parameters<WikiBindings[Name]>
  ) => Promise<Awaited<ReturnType<WikiBindings[Name]>>>;
};

/**
 * Build the vault operations. This is the whole app surface: the desktop
 * entrypoint exposes it through `win.bind`, and the dev server through HTTP.
 */
export function createVaultApi(): VaultApi {
  return {
    getState: guard(readState),
    listFiles: guard(async () =>
      await listVaultFiles(await requireVaultRoot())
    ),
    readFile: guard(async (path: string) =>
      await readVaultFile(await requireVaultRoot(), path)
    ),
    writeFile: guard(async (path: string, content: string) =>
      await writeVaultFile(await requireVaultRoot(), path, content)
    ),
    createFile: guard(async (path: string, content: string = "") =>
      await createVaultFile(await requireVaultRoot(), path, content)
    ),
    browse: guard(async (path: string | null) =>
      await browseDirectory(path ?? homeDirectory())
    ),
    search: guard(async (query: string) =>
      await searchVaultFiles(await requireVaultRoot(), query)
    ),
    vaultActivity: guard(async () =>
      activityByDay(await listVaultFiles(await requireVaultRoot()))
    ),
    openVault: guard(openVault),
    closeVault: guard(async () => {
      await updateConfig({ vaultRoot: null });
      return await readState();
    }),
    setSidebarCollapsed: guard(async (collapsed: boolean) => {
      await updateConfig({ sidebarCollapsed: collapsed === true });
      return await readState();
    }),
    ...listViewSetters(),
    setSidebarWidth: guard(async (width: number) => {
      // Clamped here as well as in the webview: this is a trust boundary, and
      // a stored width outside the bounds would distort every future launch.
      await updateConfig({ sidebarWidth: clampSidebarWidth(width) });
      return await readState();
    }),
    setSidebarView: guard(async (view: string) => {
      // Coerced for the same reason the theme is: whatever the page sends
      // outlives this session, and a view the page cannot draw would leave the
      // sidebar showing nothing at all.
      await updateConfig({ sidebarView: coerceSidebarView(view) });
      return await readState();
    }),
    setSplitRatio: guard(async (ratio: number) => {
      await updateConfig({ splitRatio: clampSplitRatio(Number(ratio)) });
      return await readState();
    }),
    setTheme: guard(async (theme: string) => {
      // Coerced for the same reason the width is clamped: the page is a caller
      // like any other, and an unknown value here would outlive this session.
      await updateConfig({ theme: coerceTheme(theme) });
      return await readState();
    }),
  };
}

/**
 * Wrap a handler so failures reach the caller as `{ name, message }` with a
 * message that is safe and useful to display. Handlers are a trust boundary:
 * every path argument is validated inside src/vault.ts.
 */
function guard<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<Result> | Result,
): (...args: Args) => Promise<Result> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      throw toUserMessage(error);
    }
  };
}

function toUserMessage(error: unknown): Error {
  if (error instanceof VaultError) return error;
  if (error instanceof Deno.errors.NotFound) {
    return new VaultError("That file or folder no longer exists.");
  }
  if (error instanceof Deno.errors.PermissionDenied) {
    return new VaultError("The app is not allowed to read or write there.");
  }
  if (error instanceof Deno.errors.IsADirectory) {
    return new VaultError("That is a folder, not a file.");
  }
  if (error instanceof Deno.errors.NotADirectory) {
    return new VaultError("That path is not a file.");
  }
  if (error instanceof Deno.errors.AlreadyExists) {
    return new VaultError("That already exists.");
  }
  return new VaultError(
    error instanceof Error && error.message
      ? error.message
      : "Something went wrong.",
  );
}

async function requireVaultRoot(): Promise<string> {
  const config = await loadConfig();
  if (!config.vaultRoot) throw new VaultError("Open a vault first.");
  return config.vaultRoot;
}

/**
 * One setter per switch, generated from the table, so adding a switch is a line
 * in src/config.ts rather than a line here as well.
 *
 * The value is coerced by the same function the stored config is read with
 * rather than cast: the page is a caller like any other, and whatever it sends
 * outlives the session that sent it.
 */
function listViewSetters(): Pick<VaultApi, ListViewSetter> {
  const setters = {} as Record<
    ListViewSetter,
    (show: boolean) => Promise<VaultState>
  >;
  for (const key of Object.keys(LIST_VIEW_DEFAULTS) as ListViewKey[]) {
    setters[setterFor(key)] = guard(async (show: boolean) => {
      await updateConfig({ [key]: listViewValue(key, show) });
      return await readState();
    });
  }
  return setters as Pick<VaultApi, ListViewSetter>;
}

async function readState(): Promise<VaultState> {
  const config = await loadConfig();
  const ui = {
    recents: config.recentVaults,
    sidebarCollapsed: config.sidebarCollapsed,
    ...listViewsOf(config),
    sidebarWidth: config.sidebarWidth,
    sidebarView: config.sidebarView,
    splitRatio: config.splitRatio,
    theme: config.theme,
  };
  if (!config.vaultRoot) {
    return { root: null, name: null, ...ui };
  }
  try {
    const root = await assertVaultRoot(config.vaultRoot);
    return { root, name: basename(root), ...ui };
  } catch {
    // The vault moved or was deleted since it was last opened.
    await updateConfig({ vaultRoot: null });
    return { root: null, name: null, ...ui };
  }
}

async function openVault(path: string): Promise<VaultState> {
  const root = await assertVaultRoot(path);
  const config = await loadConfig();
  await updateConfig({
    vaultRoot: root,
    recentVaults: withRecentVault(config.recentVaults, root),
  });
  return await readState();
}
