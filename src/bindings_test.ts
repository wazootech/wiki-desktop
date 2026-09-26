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

Deno.test("the webview calls the bridge in a form the desktop proxy accepts", async () => {
  // The one function every operation goes through, and the seam where the two
  // transports disagree. The desktop runtime hands the webview a proxy whose
  // property access is the binding name, so `bridge[name].apply(null, args)`
  // reads `.apply` as a binding called "getState.apply": every call in the app
  // is refused, and the window sits on the empty state toasting
  // `No binding for 'browse.apply'`. The browser bridge returns a plain
  // function, so the dev server cannot see it, and the string tests here cannot
  // see it either -- which is why this is a test about the call form and not
  // about an operation.
  const page = await Deno.readTextFile(join(import.meta.dirname!, "page.ts"));
  const start = page.indexOf("async function call(name, args)");
  // The function's own body, comments stripped: the comment above the call
  // quotes the broken form on purpose, and a test that read it back as code
  // would fail on the explanation rather than on the behaviour.
  const callBody = page
    .slice(start, page.indexOf("\n      }", start))
    .replace(/^\s*\/\/.*$/gm, "");
  assert(
    !/\.apply\(/.test(callBody),
    "call() reaches the bridge through .apply, which the desktop proxy reads as a binding name",
  );
  assert(
    /bridge\[name\]\(\.\.\.\(args \|\| \[\]\)\)/.test(callBody),
    "and through a spread, which both transports accept",
  );
  // The browser bridge is the other half of the same seam, so it has to accept
  // what the page now sends it.
  const browserBridge = page
    .slice(
      page.indexOf("function browserBridge()"),
      page.indexOf("function browserBridge()") + 300,
    )
    .replace(/^\s*\/\/.*$/gm, "");
  assert(
    /\(\.\.\.args\) => request\(String\(name\), args\)/.test(browserBridge),
    "the browser bridge forwards a spread call as the operation's arguments",
  );
});
