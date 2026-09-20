/**
 * Criterion 1 of the editor decision (wazootech/wiki-desktop#6), as a test that
 * can be re-run rather than a number in an issue thread: every page in a real
 * vault survives `read → editor document model → save` with its bytes intact.
 *
 * The editor's contract is that a file nobody edited is a file nobody rewrote,
 * and this is the only check that can fail for the reasons a real vault has —
 * front matter, and pages with endings or a BOM that neither editor can hold.
 * It needs a vault to point at, so it is opt-in:
 *
 *     WIKI_DESKTOP_VAULT=/path/to/vault/wiki deno test --allow-read --allow-write --allow-env
 *
 * The vault is copied first and the round trip happens on the copy, so a run
 * can never write to the vault it was handed.
 */
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";

import { listVaultFiles, readVaultFile, writeVaultFile } from "./vault.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** What the user's edits arrive at: the editor's document, parsed and back. */
function throughDocumentModel(text: string): string {
  return EditorState.create({ doc: text, extensions: [markdown()] })
    .doc.toString();
}

const vaultRoot = Deno.env.get("WIKI_DESKTOP_VAULT") ?? "";

Deno.test({
  name: "every page in a real vault survives a full round trip",
  ignore: vaultRoot === "",
  fn: async () => {
    const source = await Deno.realPath(vaultRoot);
    const work = await Deno.makeTempDir({ prefix: "wiki-fidelity-" });
    try {
      const pages = (await listVaultFiles(source)).filter((file) =>
        file.isMarkdown
      );
      assert(pages.length > 0, `no Markdown pages under ${source}`);
      for (const page of pages) {
        await Deno.mkdir(`${work}/${page.path}`.replace(/\/[^/]+$/, ""), {
          recursive: true,
        });
        await Deno.copyFile(`${source}/${page.path}`, `${work}/${page.path}`);
      }

      let bytes = 0;
      let crlf = 0;
      let bom = 0;
      const rewritten: string[] = [];

      for (const page of pages) {
        const before = await Deno.readTextFile(`${work}/${page.path}`);
        bytes += new TextEncoder().encode(before).length;
        if (before.includes("\r\n")) crlf += 1;
        if (before.charCodeAt(0) === 0xfeff) bom += 1;

        const read = await readVaultFile(work, page.path);
        await writeVaultFile(
          work,
          page.path,
          throughDocumentModel(read.content),
        );

        if (await Deno.readTextFile(`${work}/${page.path}`) !== before) {
          rewritten.push(page.path);
        }
      }

      console.log(
        `${pages.length} pages, ${bytes} bytes, ${crlf} CRLF, ${bom} BOM`,
      );
      assert(
        rewritten.length === 0,
        `${rewritten.length} pages came back changed: ${
          rewritten.slice(0, 5).join(", ")
        }`,
      );
    } finally {
      await Deno.remove(work, { recursive: true });
    }
  },
});
