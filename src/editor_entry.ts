/**
 * Bundle entry for the webview editor.
 *
 * The page loads `/editor.js` as a classic script, so the factory is published
 * on the global object rather than imported as a module. `deno task
 * build:editor` bundles this file with `--platform browser`; the output is
 * committed and served from memory by both transports, which is what keeps the
 * desktop build a single artifact.
 *
 * The formatter rides along here for the same reason, and for one more: the
 * page has no import statement to reach it by, and this is the only script it
 * loads. It is a second global rather than a member of the editor's handle
 * because it is not part of the editor — it is a pure function over text that
 * the page calls and then hands the result back through `applyFormatted`. The
 * handle still does not know what formatting is.
 */
import { createEditor } from "./editor.ts";
import { formatMarkdown } from "./format.ts";

(globalThis as { WikiEditor?: unknown }).WikiEditor = { create: createEditor };
(globalThis as { WikiFormat?: unknown }).WikiFormat = { formatMarkdown };
