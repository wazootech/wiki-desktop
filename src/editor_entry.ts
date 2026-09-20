/**
 * Bundle entry for the webview editor.
 *
 * The page loads `/editor.js` as a classic script, so the factory is published
 * on the global object rather than imported as a module. `deno task
 * build:editor` bundles this file with `--platform browser`; the output is
 * committed and served from memory by both transports, which is what keeps the
 * desktop build a single artifact.
 */
import { createEditor } from "./editor.ts";

(globalThis as { WikiEditor?: unknown }).WikiEditor = { create: createEditor };
