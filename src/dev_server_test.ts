import { join } from "node:path";

import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "./config.ts";
import { portOf, startDevServer } from "./dev_server.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

Deno.test("the dev server drives the whole vault flow over HTTP", async () => {
  // Point the app config at a throwaway home so no real settings are touched.
  const home = await Deno.makeTempDir({ prefix: "wazoo-wiki-home-" });
  const vault = await Deno.makeTempDir({ prefix: "wazoo-wiki-vault-" });
  const previous = {
    home: Deno.env.get("HOME"),
    profile: Deno.env.get("USERPROFILE"),
  };
  Deno.env.set("HOME", home);
  Deno.env.set("USERPROFILE", home);
  await Deno.mkdir(join(vault, "notes"));

  const server = startDevServer({ port: 0 });
  const base = `http://127.0.0.1:${portOf(server)}/`;
  const call = async (name: string, ...args: unknown[]) => {
    const response = await fetch(`${base}api/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    return { status: response.status, body: await response.json() };
  };

  try {
    const html = await (await fetch(base)).text();
    assert(html.includes("Wazoo Wiki"), "the page is served");
    assert(html.includes("</script>"), "the page includes its script");

    assertEqual((await call("getState")).body.root, null, "no vault at first");

    const opened = await call("openVault", vault);
    assertEqual(opened.status, 200, "a vault can be opened");
    assertEqual(opened.body.root, vault, "the vault path is remembered");

    assertEqual(
      (await call("createFile", "notes/today.md", "# Today\n")).status,
      200,
      "a file can be created",
    );
    assertEqual(
      (await call("readFile", "notes/today.md")).body.content,
      "# Today\n",
      "the file can be read back",
    );
    assertEqual(
      (await call("writeFile", "notes/today.md", "# Today\n\nEdited.\n"))
        .status,
      200,
      "the file can be written",
    );
    assertEqual(
      (await call("listFiles")).body.map((file: { path: string }) => file.path)
        .join(", "),
      "notes/today.md",
      "the vault lists its files",
    );

    const browsed = await call("browse", vault);
    assertEqual(browsed.status, 200, "folders can be browsed");
    assertEqual(
      browsed.body.entries.map((entry: { name: string }) => entry.name).join(
        ", ",
      ),
      "notes",
      "browsing lists subfolders only",
    );

    // UI state rides along with the vault state, so a restart restores both.
    assertEqual(
      (await call("getState")).body.sidebarCollapsed,
      false,
      "the sidebar starts expanded",
    );
    const collapsed = await call("setSidebarCollapsed", true);
    assertEqual(collapsed.status, 200, "the sidebar state can be stored");
    assertEqual(
      collapsed.body.sidebarCollapsed,
      true,
      "storing returns the new state",
    );
    assertEqual(
      (await call("getState")).body.sidebarCollapsed,
      true,
      "the sidebar state is remembered",
    );

    assertEqual(
      (await call("getState")).body.sidebarWidth,
      DEFAULT_SIDEBAR_WIDTH,
      "the sidebar starts at its default width",
    );
    const widened = await call("setSidebarWidth", 320);
    assertEqual(widened.status, 200, "the sidebar width can be stored");
    assertEqual(
      widened.body.sidebarWidth,
      320,
      "storing the width returns the new state",
    );
    assertEqual(
      (await call("getState")).body.sidebarWidth,
      320,
      "the sidebar width is remembered",
    );
    assertEqual(
      (await call("setSidebarWidth", 5000)).body.sidebarWidth,
      SIDEBAR_MAX_WIDTH,
      "an impossible width is clamped over this transport too",
    );
    assertEqual(
      (await call("setSidebarWidth", 10)).body.sidebarWidth,
      SIDEBAR_MIN_WIDTH,
      "a sliver of a sidebar is raised to the minimum",
    );

    // The guards hold over this transport too: HTTP is not a bypass.
    const escaped = await call("readFile", "../outside.md");
    assertEqual(escaped.status, 400, "escaping the vault is rejected");
    assertEqual(escaped.body.name, "VaultError", "the error keeps its name");
    assertEqual(
      (await call("nope")).status,
      404,
      "unknown operations are refused",
    );

    const closed = await call("closeVault");
    assertEqual(closed.body.root, null, "closing the vault clears it");
  } finally {
    await server.shutdown();
    restoreEnv("HOME", previous.home);
    restoreEnv("USERPROFILE", previous.profile);
    await Deno.remove(home, { recursive: true }).catch(() => {});
    await Deno.remove(vault, { recursive: true }).catch(() => {});
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) Deno.env.delete(name);
  else Deno.env.set(name, value);
}

Deno.test("the dev server refuses cross-origin and non-JSON callers", async () => {
  const server = startDevServer({ port: 0 });
  const base = `http://127.0.0.1:${portOf(server)}/`;
  try {
    const crossOrigin = await fetch(`${base}api/getState`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://evil.example",
      },
      body: "[]",
    });
    assertEqual(crossOrigin.status, 403, "cross-origin calls are refused");

    const formPost = await fetch(`${base}api/getState`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "[]",
    });
    assertEqual(formPost.status, 415, "non-JSON calls are refused");

    const get = await fetch(`${base}api/getState`);
    assertEqual(get.status, 405, "GET is refused");

    assertEqual(
      (await fetch(`${base}nope`)).status,
      404,
      "unknown routes are refused",
    );
  } finally {
    await server.shutdown();
  }
});
