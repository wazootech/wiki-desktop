import { join } from "node:path";

/** Folder (under the user's home directory) that holds app-owned settings. */
const CONFIG_DIR_NAME = ".wazoo-wiki";
const CONFIG_FILE_NAME = "config.json";
const MAX_RECENT_VAULTS = 8;

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
}

export const DEFAULT_CONFIG: AppConfig = {
  vaultRoot: null,
  recentVaults: [],
  window: null,
  sidebarCollapsed: false,
};

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

let cached: AppConfig | null = null;

/**
 * Read the settings file. A missing, unreadable, or corrupt file falls back to
 * the defaults so a bad config can never prevent the app from starting.
 */
export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(await Deno.readTextFile(configPath()));
    cached = sanitize(parsed);
  } catch {
    cached = { ...DEFAULT_CONFIG };
  }
  return cached;
}

/** Merge a patch into the settings file and return the stored result. */
export async function updateConfig(
  patch: Partial<AppConfig>,
): Promise<AppConfig> {
  const next = sanitize({ ...(await loadConfig()), ...patch });
  await Deno.mkdir(configDir(), { recursive: true });
  await Deno.writeTextFile(configPath(), JSON.stringify(next, null, 2) + "\n");
  cached = next;
  return next;
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
