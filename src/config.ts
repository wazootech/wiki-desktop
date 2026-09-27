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

/**
 * The switches on the file list's own toolbar, and what each is worth when
 * nothing has said otherwise.
 *
 * They differ in what they change and agree in everything else: a checkbox
 * beside the list, an item in the Appearance menu, one stored boolean, and a
 * value that survives a restart. Declared as one table so that is the only way
 * to add a fourth — and so the sanitiser below has one rule to apply rather
 * than one per setting, which is how Assets ended up per-session while its two
 * neighbours persisted.
 */
export const LIST_VIEW_DEFAULTS = {
  /**
   * Whether the file list shows each file's extension.
   *
   * A wiki is nearly all Markdown, so a column of `Getting_Started.md` reads as
   * noise once a page is open and the tab already names the file. Turned off,
   * the extension is hidden in the list and shown only where a name is being
   * typed — the New file prompt, which has to carry the real name anyway.
   */
  showExtensions: true,
  /**
   * Whether the file list shows the folder each file sits in.
   *
   * That path is a second line under every row, so it roughly doubles the
   * height of the list. In a vault that is one folder deep — the usual shape
   * of a wiki — it is also the same word repeated down the whole column, and
   * a reader scanning names would rather have the rows compact. Turned off,
   * the folder is hidden here and the row's title still carries the full path
   * for anyone who hovers it.
   */
  showPaths: true,
  /**
   * Whether the vault's static files are listed beside its pages.
   *
   * Off by default, and for a reason that is not tidiness: the vault's own
   * `wiki.yml` decides what is a page and what is an asset, so a build output
   * folder beside four hundred pages is not what a wiki looks like. It is
   * stored anyway, because a user who ticked it once meant it, and re-earning
   * that decision on every launch is the kind of small friction that makes a
   * setting feel broken rather than default.
   */
  showAssets: false,
} as const;

/** The name of a list-view switch, which is also its key in the config file. */
export type ListViewKey = keyof typeof LIST_VIEW_DEFAULTS;

/** The operation that stores one switch, named after it: `setShowAssets`. */
export type ListViewSetter = `set${Capitalize<ListViewKey>}`;

/**
 * The operation that stores one switch, from the switch's own name.
 *
 * Written once, here, where the table is, and used by both sides of the seam:
 * src/bindings.ts registers the operation under this name and src/page.ts calls
 * it, so the two cannot spell the same convention two ways and have a fourth
 * switch reach for one of them.
 */
export function setterFor(key: ListViewKey): ListViewSetter {
  return `set${key.charAt(0).toUpperCase()}${
    key.slice(
      1,
    )
  }` as ListViewSetter;
}

/** One boolean per switch in {@link LIST_VIEW_DEFAULTS}. */
export type ListViews = { [Key in ListViewKey]: boolean };

/** Everything else the app remembers between launches. */
export interface AppSettings {
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

/**
 * The stored config: the app's own settings plus the list's switches.
 *
 * A type rather than an interface because the switches come from a table, and
 * an interface cannot be written over a mapped type.
 */
export type AppConfig = AppSettings & ListViews;

export const DEFAULT_CONFIG: AppConfig = {
  vaultRoot: null,
  recentVaults: [],
  window: null,
  sidebarCollapsed: false,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  theme: DEFAULT_THEME,
  ...LIST_VIEW_DEFAULTS,
};

/**
 * The list's switches, each falling back to its own default.
 *
 * One rule for all three, and it has to be this one: a stored value is believed
 * when it is a boolean and ignored otherwise, so the setting's default decides
 * both the config written before the setting existed and the file where a
 * string or a number landed in its place. That covers both polarities without
 * two versions of the rule — "only an explicit false turns this off" and "only
 * an explicit true turns that on" are the same sentence with a different
 * default — and it is the reason a `"no"` in the file cannot silently flip a
 * list that the user never touched.
 */
export function sanitizeListViews(
  record: Record<string, unknown>,
): ListViews {
  const views = {} as ListViews;
  for (const key of Object.keys(LIST_VIEW_DEFAULTS) as ListViewKey[]) {
    views[key] = listViewValue(key, record[key]);
  }
  return views;
}

/**
 * One switch's value, from whatever a file or a caller offered.
 *
 * The single place the rule is written, so the reader of a stored config and
 * the writer of a stored value cannot drift apart: they are the same question
 * asked in two directions.
 */
export function listViewValue(key: ListViewKey, value: unknown): boolean {
  return typeof value === "boolean" ? value : LIST_VIEW_DEFAULTS[key];
}

/**
 * Pull the switches out of a config, for a state object that wants them as a
 * group rather than one field at a time.
 */
export function listViewsOf(config: ListViews): ListViews {
  const views = {} as ListViews;
  for (const key of Object.keys(LIST_VIEW_DEFAULTS) as ListViewKey[]) {
    views[key] = config[key];
  }
  return views;
}

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
    ...sanitizeListViews(record),
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
