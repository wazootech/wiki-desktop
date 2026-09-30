/**
 * What the vault declares, read once per request rather than cached.
 *
 * The frontmatter form needs three things the app cannot see from one page: the
 * prefix map, the shape documents, and which keys the vault actually uses. All
 * three come from the vault, all three change while the app is open, and #8
 * names editing a shape re-deriving the form as a live-update question rather
 * than a cache-invalidation one.
 *
 * So this does not cache. The census of the toolchain's own vault — 87 pages,
 * every one of which has frontmatter — reads in about 20ms, which is less than
 * the round trip a cached copy would save on the first call after an edit, and a
 * cache here would be a second answer to "what does this vault declare" that
 * could go stale while the app is open. `src/shapes_test.ts` holds the shape
 * discovery; this is the walk around it.
 */
import { readFrontmatter } from "./frontmatter.ts";
import { parseShape, type ShapeDeclaration, TermResolver } from "./shapes.ts";
import type { VaultFile } from "./vault.ts";
import { readWikiConfig, type WikiConfig } from "./wiki_config.ts";

/** Everything the panel needs that is a fact about the vault, not the page. */
export interface VaultVocabularyPayload {
  /** `graph.context`, the prefix map bare keys and CURIEs meet in. */
  context: Record<string, string>;
  /** `wiki.input`, for deriving a page's IRI the way the graph does. */
  inputs: string[];
  /** `graph.base_iri`, or null when the config declares none. */
  baseIri: string | null;
  /** Every shape a page in this vault declares. */
  shapes: ShapeDeclaration[];
  /**
   * Every top-level key the vault's **content** pages use, with how many use
   * it. Shape documents are excluded: their keys describe the shape, not an
   * instance of the class it constrains.
   */
  observedKeys: Record<string, number>;
}

/** The pages of a vault that carry frontmatter, for the shape walk. */
function isShapeCandidate(file: VaultFile): boolean {
  return file.isMarkdown;
}

/**
 * Read a vault's declared vocabulary.
 *
 * The walk is over the listing the app already builds for the sidebar, so it
 * costs one read per page and no second traversal. Non-Markdown files are
 * skipped by `isShapeCandidate`, which is here rather than inline because the
 * listing's own scope says what a page is and this trusts it.
 */
export async function readVaultVocabulary(
  root: string,
  files: readonly VaultFile[],
  config?: WikiConfig,
): Promise<VaultVocabularyPayload> {
  const wikiConfig = config ?? await readWikiConfig(root);
  const resolver = new TermResolver(wikiConfig.context);
  const shapes: ShapeDeclaration[] = [];
  const observedKeys: Record<string, number> = {};

  for (const file of files) {
    if (!isShapeCandidate(file)) continue;
    let text: string;
    try {
      text = await Deno.readTextFile(`${root}/${file.path}`);
    } catch {
      // A file that cannot be read is not a shape and not a key. The listing
      // can be a moment behind the filesystem, and a page that has just been
      // deleted is not an error in the middle of a census.
      continue;
    }
    const { frontmatter } = readFrontmatter(text);
    if (frontmatter === null) continue;
    const shape = parseShape(text, file.path, resolver);
    if (shape !== null) {
      // A shape is a page, but its keys are its own bookkeeping: `sh:property`,
      // `sh:targetClass`, `rdfs:label` and `rdfs:comment` describe the shape
      // rather than an instance of the class it constrains. Counting them makes
      // the form offer `sh:property` on a `TechArticle` page, which is not a
      // suggestion a reader could act on.
      //
      // Skipping them also reproduces the census #22 measured, exactly: of the
      // fourteen-odd keys its pages use, the only ones that disappear with the
      // two shape pages excluded are the four `rdfs:`/`sh:` ones. `wazoo:layout`
      // (17), `redirect_to` (17), `codeRepository` (4) and the three single-use
      // keys are all still there, which is the set the form has to reach.
      shapes.push(shape);
      continue;
    }
    for (const entry of frontmatter.mapping.entries) {
      // `type` is the class, and it has its own row in the form.
      if (entry.key === "type" || entry.key === "@type") continue;
      observedKeys[entry.key] = (observedKeys[entry.key] ?? 0) + 1;
    }
  }

  return {
    context: wikiConfig.context,
    inputs: wikiConfig.inputs,
    baseIri: wikiConfig.baseIri,
    shapes,
    observedKeys,
  };
}
