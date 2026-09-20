import { basename } from "node:path";

import {
  clampSidebarWidth,
  coerceTheme,
  homeDirectory,
  loadConfig,
  type ThemePreference,
  updateConfig,
  withRecentVault,
} from "./config.ts";
import {
  assertVaultRoot,
  browseDirectory,
  createVaultFile,
  type DirectoryListing,
  listVaultFiles,
  readVaultFile,
  VaultError,
  type VaultFile,
  type VaultFileContents,
  writeVaultFile,
} from "./vault.ts";

export interface VaultState {
  /** Absolute path of the open vault, or null when none is open. */
  root: string | null;
  /** Folder name of the open vault, for display. */
  name: string | null;
  recents: string[];
  /** Whether the file sidebar was collapsed when the app last ran. */
  sidebarCollapsed: boolean;
  /** Width of the file sidebar column in CSS pixels. */
  sidebarWidth: number;
  /** Light/dark appearance the user last chose, `system` if they never did. */
  theme: ThemePreference;
}

/**
 * The API the webview sees as `bindings.<name>(...)`. Both the desktop
 * bindings and the HTTP transport in src/dev_server.ts implement this shape,
 * and src/page.ts calls it, so the contract lives in one place.
 */
export interface WikiBindings {
  /** Current vault plus the list of recent vaults. */
  getState(): Promise<VaultState>;
  /** Every editable file in the vault, Markdown first. */
  listFiles(): Promise<VaultFile[]>;
  readFile(path: string): Promise<VaultFileContents>;
  writeFile(path: string, content: string): Promise<VaultFileContents>;
  createFile(path: string, content?: string): Promise<VaultFileContents>;
  /** List subfolders of `path` for the in-app vault picker. */
  browse(path: string | null): Promise<DirectoryListing>;
  openVault(path: string): Promise<VaultState>;
  closeVault(): Promise<VaultState>;
  /** Remember whether the sidebar is collapsed, so it survives a restart. */
  setSidebarCollapsed(collapsed: boolean): Promise<VaultState>;
  /** Remember the sidebar column's width, so it survives a restart. */
  setSidebarWidth(width: number): Promise<VaultState>;
  /** Remember the appearance, so it survives a restart. */
  setTheme(theme: string): Promise<VaultState>;
}

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
    openVault: guard(openVault),
    closeVault: guard(async () => {
      await updateConfig({ vaultRoot: null });
      return await readState();
    }),
    setSidebarCollapsed: guard(async (collapsed: boolean) => {
      await updateConfig({ sidebarCollapsed: collapsed === true });
      return await readState();
    }),
    setSidebarWidth: guard(async (width: number) => {
      // Clamped here as well as in the webview: this is a trust boundary, and
      // a stored width outside the bounds would distort every future launch.
      await updateConfig({ sidebarWidth: clampSidebarWidth(width) });
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

async function readState(): Promise<VaultState> {
  const config = await loadConfig();
  const ui = {
    recents: config.recentVaults,
    sidebarCollapsed: config.sidebarCollapsed,
    sidebarWidth: config.sidebarWidth,
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
