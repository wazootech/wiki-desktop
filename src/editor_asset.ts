/**
 * The editor bundle as a served asset.
 *
 * Both transports reach the webview over HTTP — `deno desktop` points its
 * window at the server started in src/main.ts — so the editor arrives the same
 * way the page does: one `Deno.serve` handler over loopback. The bundle is
 * embedded as text rather than read from disk, which is what keeps
 * `deno task build` a single artifact.
 */
import bundle from "./editor_bundle.js" with { type: "text" };

/** Where the page looks for the editor, and what it is served as. */
export const EDITOR_SCRIPT_PATH = "/editor.js";

export function isEditorScript(pathname: string): boolean {
  return pathname === EDITOR_SCRIPT_PATH;
}

export function editorScriptResponse(): Response {
  return new Response(bundle, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
