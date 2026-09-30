import { join } from "node:path";

/** Folder (under the user's home directory) that holds app-owned settings. */
const CONFIG_DIR_NAME = ".wazoo-wiki";
const CONFIG_FILE_NAME = "config.json";
const MAX_RECENT_VAULTS = 8;

/**
 * Sidebar column bounds in CSS pixels. The webview interpolates these into the
 * page, so the drag handle, the stored value, and the layout token cannot
 * disagree about what is allowed.
 *
 * The minimum is the narrowest *usable* column, and the column now contains the
 * activity bar as well as a view. It used to be 180, which bought 180px of file
 * list; with a 48px bar inside it the same number would buy 131px, which is not
 * a file list anyone can scan. So the bar's width is added here rather than
 * subtracted somewhere in the page, and the number keeps meaning what it meant:
 * the least room the sidebar's contents have ever been given.
 */
export const SIDEBAR_MIN_WIDTH = 230;
export const SIDEBAR_MAX_WIDTH = 520;
export const DEFAULT_SIDEBAR_WIDTH = 250;

/**
 * Width of the activity bar, in CSS pixels: the strip of view buttons that runs
 * down the left of the sidebar and switches what the pane beside it shows.
 *
 * It is inside the sidebar's width rather than beside it, so the column has to
 * give up this much of the window before the editor gives up any. Exported for
 * the same reason the sidebar's own bounds are: the page's clamp is a trust
 * boundary as much as a layout, and it has to be spending the same number the
 * bar is actually drawn at.
 */
export const ACTIVITY_BAR_WIDTH = 48;

/**
 * Where the changes/history split sits, as the changes pane's share of the
 * height, and the ends it can be dragged to.
 *
 * A share rather than a height, because the split's height belongs to the
 * window: a height chosen on a tall window is most of a short one, and would
 * need re-clamping for every window the user ever opens it in. The two bounds
 * are the bargain: a section squeezed to nothing was not really offered, and
 * one left with the lot is not a split.
 *
 * Exported for the same reason the sidebar's bounds are. The page drags with
 * them and this file stores with them, and a stored ratio the drag could not
 * produce would be a ratio no user had ever chosen.
 */
export const DEFAULT_SPLIT_RATIO = 0.7;
export const MIN_SPLIT_RATIO = 0.2;
export const MAX_SPLIT_RATIO = 0.8;

/**
 * How the app picks between the light and dark palettes. `system` defers to the
 * operating system, which is what the desktop runtime and every browser report
 * through prefers-color-scheme, so it is the default: the app matches the rest
 * of the desktop until the user says otherwise.
 */
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export const DEFAULT_THEME: ThemePreference = "system";

/**
 * Which view a page's frontmatter is shown in.
 *
 * A **view state**, like the appearance and the sidebar's switches, rather than
 * a per-document editing mode: it is one answer for the whole app, stored
 * beside the other window preferences, and it is never a parse failure. A page
 * whose frontmatter is malformed opens, shows raw, and saves unchanged whatever
 * this says — which is also why the panel can always fall back rather than
 * refusing.
 *
 * `auto` is the recommendation and it defers to what the vault declares:
 * structured where a shape targets the page's class, raw otherwise, so a reader
 * who wants raw always does not have to say so per file.
 */
export const FRONTMATTER_MODES = ["auto", "structured", "raw"] as const;
export type FrontmatterMode = (typeof FRONTMATTER_MODES)[number];
export const DEFAULT_FRONTMATTER_MODE: FrontmatterMode = "auto";

/**
 * The views the sidebar switches between, in the order the activity bar draws
 * them.
 *
 * A table like {@link LIST_VIEW_DEFAULTS}, and for the same reason: the bar's
 * buttons, the panes in the markup, the selected-view setting and the View
 * commands in the menu all come from this one list, so a view cannot exist in
 * one of them and not the others.
 *
 * Source control is deliberately not here. It would need its own reader — the
 * listing cannot see `.git`, which is on purpose — and it would have to answer
 * whether it manages the vault or the repository around it, which the UI cannot
 * ask. "Recently changed" is the same question a wiki reader actually has, over
 * data the listing already carries.
 */
export const SIDEBAR_VIEWS = ["explorer", "search", "recent"] as const;
export type SidebarView = (typeof SIDEBAR_VIEWS)[number];
export const DEFAULT_SIDEBAR_VIEW: SidebarView = "explorer";

/** True for a stored or requested view the app can actually show. */
export function isSidebarView(value: unknown): value is SidebarView {
  return typeof value === "string" &&
    (SIDEBAR_VIEWS as readonly string[]).includes(value);
}

/**
 * Coerce a stored or requested view into one the page can apply, falling back to
 * the file list rather than to a blank pane. Same rule as
 * {@link coerceTheme}: a settings file written by a build that had a view this
 * one has not heard of must not be able to leave the sidebar empty.
 */
export function coerceSidebarView(value: unknown): SidebarView {
  return isSidebarView(value) ? value : DEFAULT_SIDEBAR_VIEW;
}

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
  /**
   * Which view the sidebar was showing, restored on the next launch.
   *
   * Stored next to the width and the collapsed flag rather than with the list
   * view's switches, because it is a place in the window rather than something
   * about the listing: it is worth the same on every vault, and the file list
   * stays the answer to which file is open.
   */
  sidebarView: SidebarView;
  /**
   * The changes pane's share of the changes/history split, restored on the
   * next launch.
   *
   * Stored next to the width because it is the same kind of thing: a place in
   * the window the reader dragged into place and would otherwise have to drag
   * into place again on every launch.
   */
  splitRatio: number;
  /** Light/dark appearance: `system` follows the OS, or the user pinned one. */
  theme: ThemePreference;
  /**
   * Whether frontmatter is shown as a form or as the YAML it is.
   *
   * Stored here rather than per tab because it is a preference about how this
   * reader likes to work, not a mode a document is in: opening a page in
   * structured mode and switching to raw would otherwise leave that page in a
   * mode no other page was in.
   */
  frontmatterMode: FrontmatterMode;
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
  sidebarView: DEFAULT_SIDEBAR_VIEW,
  splitRatio: DEFAULT_SPLIT_RATIO,
  theme: DEFAULT_THEME,
  frontmatterMode: DEFAULT_FRONTMATTER_MODE,
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

/**
 * Coerce a stored or requested frontmatter mode into one the panel can apply.
 *
 * An unknown value falls back to `auto` rather than to a mode that might not
 * exist, for the reason every stored setting here is believed only when it is
 * one of the values this build knows: a settings file written by a later build
 * must not be able to put this one in a state it cannot draw.
 */
export function coerceFrontmatterMode(value: unknown): FrontmatterMode {
  return typeof value === "string" &&
      (FRONTMATTER_MODES as readonly string[]).includes(value)
    ? value as FrontmatterMode
    : DEFAULT_FRONTMATTER_MODE;
}

/**
 * Clamp a stored or dragged split ratio into the ends the divider can reach.
 *
 * Clamped on the way in as well as on the way to the page, for the same reason
 * the width is: whatever the page sends outlives this session, and a stored
 * ratio outside these ends would leave a section at a size the drag cannot
 * return it to.
 */
export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
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
    sidebarView: coerceSidebarView(record.sidebarView),
    splitRatio: clampSplitRatio(Number(record.splitRatio)),
    theme: coerceTheme(record.theme),
    frontmatterMode: coerceFrontmatterMode(record.frontmatterMode),
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
