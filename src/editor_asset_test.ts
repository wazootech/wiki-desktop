/**
 * The editor bundle as an asset both transports serve.
 *
 * The page reaches for a global the bundle defines, at a path the server
 * chooses. Neither side can type-check the other, so a rename on one side
 * would only show up as an editor that silently never appears.
 */
import { join } from "node:path";

import {
  EDITOR_SCRIPT_PATH,
  editorScriptResponse,
  isEditorScript,
} from "./editor_asset.ts";
import { page } from "./page.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
Deno.test("the page loads the path the transports serve", () => {
  assert(
    page.includes(`<script src="${EDITOR_SCRIPT_PATH}"></script>`),
    `the page loads ${EDITOR_SCRIPT_PATH}`,
  );
  assert(
    isEditorScript(EDITOR_SCRIPT_PATH),
    "the route recognises its own path",
  );
  assert(
    !isEditorScript("/") && !isEditorScript("/api/getState"),
    "the route stays out of the page's and the API's way",
  );
});

Deno.test("the served bundle is a script that defines the page's factory", async () => {
  const response = editorScriptResponse();
  assert(response.status === 200, "the bundle is served");
  assert(
    response.headers.get("content-type")?.startsWith("text/javascript") ===
      true,
    "it is served as JavaScript",
  );

  const body = await response.text();
  assert(
    body.length > 100_000,
    `the bundle carries the editor (got ${body.length} bytes)`,
  );
  assert(
    body.includes("WikiEditor"),
    "the bundle publishes the global the page looks for",
  );
  // A classic script, not a module: a stray export would be a syntax error in
  // the tag the page uses.
  assert(
    !/^\s*(export|import)\s/m.test(body),
    "the bundle has no module syntax",
  );
  assert(
    page.includes("window.WikiEditor"),
    "the page reads that global",
  );
});

Deno.test("the committed bundle carries every method the page calls", async () => {
  /**
   * The bundle is built by a task and committed, so a method added to the
   * handle in src/editor.ts does not reach the app until someone runs
   * `deno task build:editor` -- and nothing else notices. A search result that
   * jumps to its line was silently opening at line 1 for exactly this reason:
   * `editorApi?.goToLine(...)` is an optional call, so a handle without the
   * method is a no-op rather than a crash, and the only symptom is a search that
   * does not land where it says it will.
   */
  const source = await Deno.readTextFile(
    join(import.meta.dirname!, "editor.ts"),
  );
  const handle = source.slice(
    source.indexOf("export interface WikiEditorHandle"),
  );
  const declared = new Set(
    [...handle.matchAll(/^\s{2}(\w+)\(/gm)].map((match) => match[1]),
  );
  const called = new Set(
    [...page.matchAll(/editorApi\??\.(\w+)\(/g)].map((match) => match[1]),
  );

  assert(
    declared.size >= 6 && called.size >= 5,
    `the handle and the page each name their methods (${declared.size} declared, ${called.size} called)`,
  );
  const unknownToTheHandle = [...called].filter((name) => !declared.has(name));
  assert(
    unknownToTheHandle.length === 0,
    `the page calls methods the handle does not declare: ${
      unknownToTheHandle.join(", ")
    }`,
  );

  const bundle = await (await editorScriptResponse()).text();
  // Property names survive minification because they are the handle's own, so
  // a bundle built before a method existed is missing the name outright.
  const missing = [...called].filter((name) => !bundle.includes(name));
  assert(
    missing.length === 0,
    `the committed bundle is older than the handle: it has no ${
      missing.join(", ")
    } -- run deno task build:editor`,
  );
});
