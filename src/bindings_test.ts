import { join } from "node:path";

import { createVaultApi } from "./bindings.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("the webview only calls operations the API provides", async () => {
  // The webview script is a string, so this seam gets no help from the type
  // checker: a renamed or misspelled operation would only fail at runtime, and
  // only in the transport the user happens to be running.
  const page = await Deno.readTextFile(join(import.meta.dirname!, "page.ts"));
  const called = new Set(
    [...page.matchAll(/call\('(\w+)'/g)].map((match) => match[1]),
  );
  const provided = new Set(Object.keys(createVaultApi()));

  const unregistered = [...called].filter((name) => !provided.has(name));
  const unused = [...provided].filter((name) => !called.has(name));
  assert(
    unregistered.length === 0,
    `the webview calls operations the API does not provide: ${
      unregistered.join(", ")
    }`,
  );
  assert(
    unused.length === 0,
    `the API provides operations the webview never calls: ${unused.join(", ")}`,
  );
});
