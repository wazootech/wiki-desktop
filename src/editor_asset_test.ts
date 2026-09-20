/**
 * The editor bundle as an asset both transports serve.
 *
 * The page reaches for a global the bundle defines, at a path the server
 * chooses. Neither side can type-check the other, so a rename on one side
 * would only show up as an editor that silently never appears.
 */
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
