/**
 * Wazoo Wiki desktop entrypoint.
 *
 * `deno desktop` opens a native window pointed at the HTTP server started here;
 * the first `new Deno.BrowserWindow()` adopts that startup window. Everything
 * the webview can do — listing, reading, and writing vault files — goes through
 * the bindings registered below.
 */
import { createVaultApi } from "./bindings.ts";
import { loadConfig, updateConfig } from "./config.ts";
import { editorScriptResponse, isEditorScript } from "./editor_asset.ts";
import { pageForTheme } from "./page.ts";

Deno.serve(async (request) => {
  if (isEditorScript(new URL(request.url).pathname)) {
    return editorScriptResponse();
  }
  // The stored appearance is baked into the document so the window's first
  // paint is already in the right mode: waiting for the bindings would show the
  // wrong one, and a dark desktop would get a white flash on every launch.
  const config = await loadConfig();
  return new Response(pageForTheme(config.theme), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
});

const win = new Deno.BrowserWindow({
  title: "Wazoo Wiki",
  width: 1180,
  height: 800,
});

// Bindings run in this Deno runtime, so the webview never touches browser file
// APIs. The operation shapes are pinned by WikiBindings in src/bindings.ts on
// both sides of the boundary rather than at this call site.
for (const [name, handler] of Object.entries(createVaultApi())) {
  win.bind(name, handler as (...args: unknown[]) => Promise<unknown>);
}

/** Remember where the user left the window; Deno does not restore it for us. */
let geometryTimer: ReturnType<typeof setTimeout> | undefined;
function persistGeometry(): void {
  clearTimeout(geometryTimer);
  geometryTimer = setTimeout(async () => {
    const [width, height] = win.getSize();
    const [x, y] = win.getPosition();
    await updateConfig({ window: { width, height, x, y } }).catch(() => {});
  }, 400);
}
win.addEventListener("resize", persistGeometry);
win.addEventListener("move", persistGeometry);

/** The webview owns the buffers, so ask it before letting a close through. */
win.addEventListener("close", async (event) => {
  const dirty = await win
    .executeJs("window.wikiEditorHasUnsavedChanges()")
    .catch(() => false);
  if (!dirty) return;
  event.preventDefault();
  // The page names the affected files: only it knows how many tabs are dirty.
  const discard = await win
    .executeJs("window.wikiEditorConfirmDiscard()")
    .catch(() => false);
  if (discard) win.close();
});

const startup = await loadConfig();
if (startup.window) {
  win.setSize(startup.window.width, startup.window.height);
  if (startup.window.x !== undefined && startup.window.y !== undefined) {
    win.setPosition(startup.window.x, startup.window.y);
  }
}
