/**
 * Browser dev transport.
 *
 * The desktop app injects `bindings` into its own webview, which means the UI
 * can only be inspected through `deno desktop` — and the default webview
 * backend has no DevTools at all. This entrypoint serves the same page and the
 * same `src/bindings.ts` operations over loopback HTTP, so the interface can be
 * reviewed and debugged in a normal browser with real vault access.
 *
 * It is a development tool: it listens on 127.0.0.1 only, refuses
 * cross-origin callers, and should never be exposed beyond the local machine.
 */
import { createVaultApi, type VaultApi } from "./bindings.ts";
import { editorScriptResponse, isEditorScript } from "./editor_asset.ts";
import { page } from "./page.ts";

const HOSTNAME = "127.0.0.1";
const DEFAULT_PORT = 4555;
const API_PREFIX = "/api/";

export interface DevServerOptions {
  port?: number;
}

/** Serve the app UI and its operations. Used by the CLI below and by tests. */
export function startDevServer(
  options: DevServerOptions = {},
): Deno.HttpServer {
  const api = createVaultApi();
  return Deno.serve(
    { hostname: HOSTNAME, port: options.port ?? DEFAULT_PORT },
    (request) => handle(request, api),
  );
}

/** The port the server settled on, which matters when options.port is 0. */
export function portOf(server: Deno.HttpServer): number {
  const address = server.addr;
  return address.transport === "tcp" ? address.port : 0;
}

async function handle(request: Request, api: VaultApi): Promise<Response> {
  const url = new URL(request.url);
  if (isEditorScript(url.pathname)) {
    return editorScriptResponse();
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    return new Response(page, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  if (!url.pathname.startsWith(API_PREFIX)) {
    return jsonError("NotFound", `No route for ${url.pathname}.`, 404);
  }
  if (request.method !== "POST") {
    return jsonError("BindingError", "Call operations with POST.", 405);
  }
  if (!isSameOrigin(request)) {
    return jsonError(
      "BindingError",
      "Cross-origin requests are not allowed.",
      403,
    );
  }
  if (!isJson(request)) {
    return jsonError(
      "BindingError",
      "Send the arguments as application/json.",
      415,
    );
  }
  const name = url.pathname.slice(API_PREFIX.length);
  const response = await invoke(request, name, api);
  console.log(`${request.method} ${API_PREFIX}${name} -> ${response.status}`);
  return response;
}

async function invoke(
  request: Request,
  name: string,
  api: VaultApi,
): Promise<Response> {
  const handler = (api as Record<string, unknown>)[name];
  if (typeof handler !== "function") {
    return jsonError("BindingError", `Unknown operation: ${name}.`, 404);
  }
  let args: unknown;
  try {
    args = await request.json();
  } catch {
    return jsonError(
      "BindingError",
      "The request body is not valid JSON.",
      400,
    );
  }
  if (!Array.isArray(args)) {
    return jsonError(
      "BindingError",
      "Send the arguments as a JSON array.",
      400,
    );
  }
  try {
    const result = await (handler as (
      ...call: unknown[]
    ) => Promise<unknown>)(...args);
    return jsonResponse(result ?? null, 200);
  } catch (error) {
    const { name: errorName, message } = describeError(error);
    console.error(`${name}: ${errorName}: ${message}`);
    return jsonError(errorName, message, 400);
  }
}

/**
 * Mirror the desktop rule that only this origin may call the API: a browser
 * page elsewhere always sends Origin on a cross-origin POST, and a local
 * process that omits it was already able to read the vault directly.
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function isJson(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").startsWith(
    "application/json",
  );
}

function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function jsonError(name: string, message: string, status: number): Response {
  return jsonResponse({ name, message }, status);
}

if (import.meta.main) {
  const server = startDevServer({
    port: Number(Deno.env.get("WIKI_DEV_PORT") ?? DEFAULT_PORT),
  });
  console.log(
    `wiki-desktop dev server: http://${HOSTNAME}:${portOf(server)}/ ` +
      `(pid ${Deno.pid})`,
  );
  console.log(
    "Browser dev mode: same UI and the same vault operations as the desktop app.",
  );
}
