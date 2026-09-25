import { join } from "node:path";

/** Folder (under the user's home directory) that holds app-owned settings. */
const CONFIG_DIR_NAME = ".wazoo-wiki";
const CONFIG_FILE_NAME = "config.json";
const MAX_RECENT_VAULTS = 8;

/**
 * Sidebar column bounds in CSS pixels. The webview interpolates these into the
 * page, so the drag handle, the stored value, and the layout token cannot
 * disagree about what is allowed.
 */
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 520;
export const DEFAULT_SIDEBAR_WIDTH = 250;

/**
 * How the app picks between the light and dark palettes. `system` defers to the
 * operating system, which is what the desktop runtime and every browser report
 * through prefers-color-scheme, so it is the default: the app matches the rest
 * of the desktop until the user says otherwise.
 */
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export const DEFAULT_THEME: ThemePreference = "system";

export interface WindowGeometry {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export interface AppConfig {
  /** Absolute path of the folder the app treats as the wiki vault. */
  vaultRoot: string | null;
  /** Most recently opened vault roots, newest first. */
  recentVaults: string[];
  /** Last known window size and position, restored on the next launch. */
  window: WindowGeometry | null;
  /** Whether the file sidebar was collapsed, restored on the next launch. */
  sidebarCollapsed: boolean;
  /** Width of the file sidebar column in CSS pixels. */
  sidebarWidth: number;
  /** Light/dark appearance: `system` follows the OS, or the user pinned one. */
  theme: ThemePreference;
}

export const DEFAULT_CONFIG: AppConfig = {
  vaultRoot: null,
  recentVaults: [],
  window: null,
  sidebarCollapsed: false,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  theme: DEFAULT_THEME,
};

/**
 * Coerce a stored or requested appearance into one the page can apply. An
 * unknown value falls back to `system` rather than to a blank palette, and the
 * page bakes the result into `<html>` before its first paint.
 */
export function coerceTheme(value: unknown): ThemePreference {
  return typeof value === "string" &&
      (THEME_PREFERENCES as readonly string[]).includes(value)
    ? value as ThemePreference
    : DEFAULT_THEME;
}

/** Clamp a stored or dragged sidebar width into the range the layout allows. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

/**
 * The user's home directory, or the working directory when it is unknown.
 *
 * Windows uses USERPROFILE: HOME is often unset there, and when it is set (by
 * Git Bash, for example) it holds an MSYS path such as `/c/Users/name` that
 * does not resolve as a Windows path.
 */
export function homeDirectory(): string {
  const home = Deno.build.os === "windows"
    ? Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME")
    : Deno.env.get("HOME");
  return home ?? Deno.cwd();
}

export function configDir(): string {
  return join(homeDirectory(), CONFIG_DIR_NAME);
}

export function configPath(): string {
  return join(configDir(), CONFIG_FILE_NAME);
}

/**
 * Read the settings file. A missing, unreadable, or corrupt file falls back to
 * the defaults so a bad config can never prevent the app from starting.
 *
 * This reads on every call rather than serving a cached snapshot. The desktop
 * window and the dev server are separate processes sharing one file, so a
 * snapshot is precisely what makes one of them write back a setting the other
 * changed in the meantime. The file is a few hundred bytes; the read is not
 * worth the staleness.
 */
export async function loadConfig(): Promise<AppConfig> {
  try {
    return sanitize(JSON.parse(await Deno.readTextFile(configPath())));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Updates waiting for their turn. Without it, two `updateConfig` calls in one
 * process could both read the file, and whichever finished writing last would
 * erase the other's patch.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Merge a patch into the settings file and return the stored result.
 *
 * The merge happens inside the queue and reads the file first, so a patch is
 * applied to what is on disk at that moment rather than to a snapshot taken
 * when the caller started waiting. That is what makes a change in the desktop
 * window and one in the browser both survive.
 */
export async function updateConfig(
  patch: Partial<AppConfig>,
): Promise<AppConfig> {
  const stored = writeQueue.then(
    () => writeConfig(patch),
    () => writeConfig(patch),
  );
  // Keep a rejected write from poisoning the queue for everything behind it.
  writeQueue = stored.then(() => {}, () => {});
  return await stored;
}

async function writeConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const next = sanitize({ ...(await loadConfig()), ...patch });
  await Deno.mkdir(configDir(), { recursive: true });
  await writeAtomically(
    configPath(),
    JSON.stringify(next, null, 2) + "\n",
  );
  return next;
}

/**
 * Write to a scratch file and rename it over the target. A concurrent reader
 * then sees either the whole old file or the whole new one, never half of
 * either. The scratch file lives in the same directory, because a rename is
 * only atomic within one filesystem, and carries the pid so two processes do
 * not write over each other's scratch file.
 */
async function writeAtomically(path: string, contents: string): Promise<void> {
  const scratch = `${path}.${Deno.pid}.tmp`;
  try {
    await Deno.writeTextFile(scratch, contents);
    await renameWithRetry(scratch, path);
  } catch (error) {
    await Deno.remove(scratch).catch(() => {});
    throw error;
  }
}

/**
 * Rename over the target, retrying briefly. On Windows the rename fails while
 * another process happens to have the file open, which a read-then-write cycle
 * makes likely rather than rare, and which is a retry rather than a lost
 * setting.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0;; attempt++) {
    try {
      await Deno.rename(from, to);
      return;
    } catch (error) {
      const retryable = attempt < 5 &&
        (error instanceof Deno.errors.NotFound ||
          error instanceof Deno.errors.PermissionDenied);
      if (!retryable) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}

/** Move `root` to the front of the recent-vault list, newest first. */
export function withRecentVault(
  recentVaults: string[],
  root: string,
): string[] {
  return [root, ...recentVaults.filter((entry) => entry !== root)].slice(
    0,
    MAX_RECENT_VAULTS,
  );
}

/** Coerce arbitrary JSON into a config object that the app can trust. */
function sanitize(value: unknown): AppConfig {
  const record = (value ?? {}) as Record<string, unknown>;
  const vaultRoot = typeof record.vaultRoot === "string"
    ? record.vaultRoot
    : null;
  const recentVaults = Array.isArray(record.recentVaults)
    ? record.recentVaults.filter(
      (entry): entry is string => typeof entry === "string",
    )
    : [];
  const geometry = record.window as Record<string, unknown> | null | undefined;
  const width = Number(geometry?.width);
  const height = Number(geometry?.height);
  const hasSize = Number.isFinite(width) && Number.isFinite(height);

  return {
    vaultRoot,
    recentVaults,
    window: hasSize ? { ...readPosition(geometry), width, height } : null,
    sidebarCollapsed: record.sidebarCollapsed === true,
    sidebarWidth: clampSidebarWidth(Number(record.sidebarWidth)),
    theme: coerceTheme(record.theme),
  };
}

function readPosition(
  geometry: Record<string, unknown> | null | undefined,
): { x?: number; y?: number } {
  const x = Number(geometry?.x);
  const y = Number(geometry?.y);
  return {
    ...(Number.isFinite(x) ? { x } : {}),
    ...(Number.isFinite(y) ? { y } : {}),
  };
}
