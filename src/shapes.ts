/**
 * What a page's frontmatter means, as far as the vault declares.
 *
 * Three things live here, in the order they depend on each other:
 *
 * - **Term resolution.** A page writes `softwareVersion`; a shape writes
 *   `sh:path: schema:softwareVersion`. Those are the same property only
 *   through `graph.context`'s prefix map, which is why `src/wiki_config.ts`
 *   reads a section it had no reason to before. Without it the class's
 *   properties and the page's keys are two unrelated lists of strings.
 * - **Shape discovery.** Shapes are documents *inside* the vault, not schema
 *   files beside it: a page whose `type` is `sh:NodeShape` declares one. So
 *   the same scanner that reads a page reads a shape, and a shape's own
 *   `sh:property` list is the first genuinely recursive thing the frontmatter
 *   component has to render.
 * - **The field model.** What the form shows: the union of what a shape
 *   declares and what the page actually carries, because the declared
 *   vocabulary is five properties in total and a form built only from those
 *   would make `wazoo:layout` and `redirect_to` — 17 pages each — unsettable.
 *
 * The resolution rules here are a deliberate copy of the ones in
 * `wazootech/wiki` (`src/wiki/context.py` and `resolve_predicate` /
 * `resolve_type` in `src/wiki/graph.py`), down to the detail that a
 * `graph.context` without an `@vocab` means bare keys resolve to nothing. A
 * second, nearly-identical set of rules is how a form ends up disagreeing with
 * the build about what a key means, and the whole point of the component is
 * that it does not. `src/shapes_test.ts` holds both halves of that claim.
 */
import {
  entryFor,
  readFrontmatter,
  type YamlEntry,
  type YamlMapping,
  type YamlValue,
} from "./frontmatter.ts";

/**
 * The prefixes the `wiki` toolchain carries whether or not a vault declares
 * them, and their values. `DEFAULT_NAMESPACES` in `src/wiki/context.py`, with
 * `rdflib`'s two read out longhand.
 */
const DEFAULT_NAMESPACES: Readonly<Record<string, string>> = {
  schema: "https://schema.org/",
  wiki: "https://wiki.example.org/",
  foaf: "http://xmlns.com/foaf/0.1/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  owl: "http://www.w3.org/2002/07/owl#",
  dc: "http://purl.org/dc/elements/1.1/",
  dcterms: "http://purl.org/dc/terms/",
  sh: "http://www.w3.org/ns/shacl#",
  wazoo: "https://wazootech.github.io/wiki-cli/vocab/",
};

/** The `@vocab` a vault gets for declaring no `graph.context` at all. */
const DEFAULT_VOCAB = "https://schema.org/";

/** The frontmatter types that make a page a shape rather than a page. */
const SHAPE_TYPES: ReadonlySet<string> = new Set([
  "NodeShape",
  "PropertyShape",
  "sh:NodeShape",
  "sh:PropertyShape",
]);

/**
 * Keys that are layout and redirect mechanics rather than properties of a class.
 *
 * `wazoo:layout` and `redirect_to` appear on 17 pages each and are declared by
 * no shape, so a class's property list is the wrong home for them. They are
 * still shown, in their own group: hiding them is a dead end, and presenting
 * them as a property of `schema:TechArticle` is noise.
 */
export const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
  "wazoo:layout",
  "redirect_to",
]);

/**
 * A prefix map that answers the only question the field model asks: is this
 * term, and the term a shape declares, the same one?
 */
export class TermResolver {
  private readonly namespaces: Record<string, string>;

  constructor(context: Readonly<Record<string, string>> | null | undefined) {
    if (context === null || context === undefined) {
      // No declared context at all: the toolchain's own defaults, and a bare
      // key is a schema.org term because that is what an undeclared vault gets.
      this.namespaces = { ...DEFAULT_NAMESPACES };
      this.vocab = DEFAULT_VOCAB;
      return;
    }
    this.namespaces = { ...DEFAULT_NAMESPACES };
    let vocab: string | null = null;
    for (const [prefix, iri] of Object.entries(context)) {
      if (prefix === "@vocab") {
        vocab = iri === "" ? null : iri;
        continue;
      }
      this.namespaces[prefix] = iri;
    }
    // A context that declares prefixes but no `@vocab` resolves no bare keys at
    // all, and pretending otherwise is how a form invents properties the build
    // never sees.
    this.vocab = vocab;
  }

  /** The `@vocab`, or null when the vault declares none. */
  readonly vocab: string | null;

  /** The IRI a predicate key means, or null when it means nothing. */
  predicate(key: string): string | null {
    const colon = key.indexOf(":");
    if (colon > 0) {
      const namespace = this.namespaces[key.slice(0, colon)];
      if (namespace !== undefined) return namespace + key.slice(colon + 1);
    }
    if (key.startsWith("wiki.")) {
      return this.namespaces.wiki + key.slice(5);
    }
    return this.vocab === null ? null : this.vocab + key;
  }

  /**
   * The IRI a `type` value means.
   *
   * Not the same function as {@link predicate}, and the difference is real: a
   * type may be written as an absolute IRI, in which case it is already one.
   */
  type(value: string): string | null {
    const colon = value.indexOf(":");
    if (colon > 0) {
      const namespace = this.namespaces[value.slice(0, colon)];
      if (namespace !== undefined) return namespace + value.slice(colon + 1);
      // An unknown prefix is an absolute IRI, not a bare term to expand.
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
      return null;
    }
    return this.vocab === null ? null : this.vocab + value;
  }

  /**
   * The bare name an IRI has under the vocab, or null when it has none.
   *
   * This is what decides the key a form writes when it adds a field a shape
   * requires: a shape writes `sh:path: schema:description` because it is
   * talking to a validator, while the page writes `description` because that is
   * how the rest of its keys are written. Both are the same IRI through
   * `@vocab`, so a form that added the prefixed one would be valid and
   * inconsistent, which is the kind of thing a reader has to notice and undo.
   */
  bareName(iri: string | null): string | null {
    if (iri === null || this.vocab === null) return null;
    return iri.startsWith(this.vocab) ? iri.slice(this.vocab.length) : null;
  }

  /** The prefixes this resolver knows, for a form that shows where a term came from. */
  knownPrefixes(): string[] {
    return Object.keys(this.namespaces).sort();
  }

  /**
   * The IRI an `sh:datatype` names, or null when it names none we can read.
   *
   * A shape writes `xsd:string` and rdflib compares against
   * `http://www.w3.org/2001/XMLSchema#string`, so the two have to meet before
   * they can be compared. `xsd` is in the toolchain's default namespaces, so
   * this works whether or not the vault's context declares it.
   */
  datatype(term: string): string | null {
    const colon = term.indexOf(":");
    if (colon > 0) {
      const namespace = this.namespaces[term.slice(0, colon)];
      if (namespace !== undefined) return namespace + term.slice(colon + 1);
    }
    return term.includes("://") ? term : null;
  }

  /**
   * The shortest CURIE for an IRI, or the IRI itself when no prefix covers it.
   *
   * This is what a default validation message interpolates, and why it exists
   * rather than printing the full IRI: the report `wiki check` prints binds the
   * same prefixes, so `Less than 1 values on wiki:CSS->schema:description` is
   * the string both sides produce rather than one of them producing an IRI and
   * the other a CURIE. The longest matching namespace wins, so
   * `http://www.w3.org/2001/XMLSchema#string` does not come back as
   * `rdf:string` by way of some other prefix that happens to share a stem.
   */
  curie(iri: string | null): string | null {
    if (iri === null) return null;
    let best: string | null = null;
    let bestLength = -1;
    for (const [prefix, namespace] of Object.entries(this.namespaces)) {
      if (!iri.startsWith(namespace)) continue;
      if (namespace.length <= bestLength) continue;
      bestLength = namespace.length;
      best = `${prefix}:${iri.slice(namespace.length)}`;
    }
    return best ?? iri;
  }
}

/** One `sh:property` of a shape: a path and the constraints on it. */
export interface ShapeProperty {
  /** `sh:path` as the shape wrote it. */
  path: string;
  /** The IRI that path is, when it is one. */
  iri: string | null;
  minCount: number | null;
  maxCount: number | null;
  /** `sh:datatype` as written, e.g. `xsd:string`. */
  datatype: string | null;
  /** `sh:message`, or null when the shape declared none. */
  message: string | null;
}

/** A shape, as declared by one page in the vault. */
export interface ShapeDeclaration {
  /** The vault path of the page that declares it. */
  sourcePath: string;
  /** `sh:targetClass` as written, and the IRI it is. */
  targetClass: string;
  targetClassIri: string | null;
  /** `rdfs:label`, when the shape gave itself one. */
  label: string | null;
  properties: ShapeProperty[];
}

/**
 * Read a page as a shape, or return null when it is not one.
 *
 * A page is a shape when its `type` names one, which is how the vault declares
 * them: two documents, both with `type: sh:NodeShape` on the second line of
 * their frontmatter. Four other pages mention the term, but every mention is
 * body prose or a fenced example, and counting those would be a count of
 * mentions rather than of shapes.
 */
export function parseShape(
  text: string,
  sourcePath: string,
  resolver: TermResolver,
): ShapeDeclaration | null {
  const { frontmatter } = readFrontmatter(text);
  if (frontmatter === null) return null;
  const types = typeValues(frontmatter.mapping);
  if (!types.some((type) => SHAPE_TYPES.has(type))) return null;

  const target = entryFor(frontmatter.mapping, "sh:targetClass") ??
    entryFor(frontmatter.mapping, "targetClass");
  const targetClass = scalarOf(target);
  if (targetClass === null) return null;

  const properties: ShapeProperty[] = [];
  const declared = entryFor(frontmatter.mapping, "sh:property") ??
    entryFor(frontmatter.mapping, "property");
  if (declared?.value.kind === "sequence") {
    for (const item of declared.value.items) {
      if (item.value.kind !== "mapping") continue;
      const property = readPropertyShape(item.value, resolver);
      if (property !== null) properties.push(property);
    }
  }

  return {
    sourcePath,
    targetClass,
    targetClassIri: resolver.type(targetClass),
    label: scalarOf(entryFor(frontmatter.mapping, "rdfs:label")),
    properties,
  };
}

function readPropertyShape(
  shape: YamlMapping,
  resolver: TermResolver,
): ShapeProperty | null {
  const path = scalarOf(entryFor(shape, "sh:path"));
  if (path === null) return null;
  return {
    path,
    iri: resolver.predicate(path),
    minCount: countOf(entryFor(shape, "sh:minCount")),
    maxCount: countOf(entryFor(shape, "sh:maxCount")),
    datatype: scalarOf(entryFor(shape, "sh:datatype")),
    message: scalarOf(entryFor(shape, "sh:message")),
  };
}

/** The `type` of a page, whether it is written as one value or a list of them. */
export function typeValues(mapping: YamlMapping): string[] {
  const entry = entryFor(mapping, "type") ?? entryFor(mapping, "@type");
  return entry === null ? [] : scalarList(entry.value);
}

/**
 * The strings a value holds, for a field that may be written either way.
 *
 * `type: TechArticle` and `type: [schema:TechArticle, schema:SoftwareApplication]`
 * are the same field with one value and two, and a page can carry both spellings
 * of one class across two documents, so nothing here normalises and compares.
 */
export function scalarList(value: YamlValue): string[] {
  if (value.kind === "scalar") {
    return value.style === "empty" ? [] : [unquote(value.text)];
  }
  if (value.kind === "sequence") {
    const out: string[] = [];
    for (const item of value.items) out.push(...scalarList(item.value));
    return out;
  }
  return [];
}

/** The value of an entry as one string, or null when it is not one. */
function scalarOf(entry: YamlEntry | null | undefined): string | null {
  if (entry === undefined || entry === null) return null;
  if (entry.value.kind !== "scalar") return null;
  if (entry.value.style === "empty") return null;
  return unquote(entry.value.text);
}

function countOf(entry: YamlEntry | null | undefined): number | null {
  const raw = scalarOf(entry);
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

/** A quoted scalar as its contents, which is what a comparison wants. */
export function unquote(text: string): string {
  if (text.length < 2) return text;
  const first = text[0];
  if ((first === '"' || first === "'") && text.endsWith(first)) {
    return text.slice(1, -1);
  }
  return text;
}

/** The part of `wiki.yml` a document IRI is derived from. */
export interface DocumentIriConfig {
  /** `wiki.input` — the directories holding pages. */
  inputs: readonly string[];
  /** `graph.context`, for the `wiki` prefix a base falls back to. */
  context: Readonly<Record<string, string>>;
  /** `graph.base_iri`, or null when the config declares none. */
  baseIri: string | null;
}

/**
 * The IRI the graph gives a page.
 *
 * A validation result is addressed by its focus node, and a focus node has to be
 * the same node on both sides of a comparison: `wiki check` prints
 * `Less than 1 values on wiki:CSS->schema:description`, so an app that named the
 * same page `CSS.md` would be reporting a fact about a different subject in
 * words that differ for that reason alone. The rule is `_file_slug` in
 * `src/wiki/graph.py`: the path relative to the input directory it is under,
 * without its extension, against a base that is `graph.base_iri` when declared
 * and the context's `wiki` prefix when it is not.
 *
 * A page under none of the input directories falls back to its own name, which
 * is what the graph does when `relative_to` raises.
 *
 * It lives here rather than in `src/wiki_config.ts` because the webview needs it
 * too — the panel derives the focus node itself, from the buffer it is showing
 * — and that module reaches for `node:path`.
 */
export function documentIri(
  path: string,
  config: DocumentIriConfig,
  frontmatter?: Readonly<Record<string, unknown>> | null,
): string | null {
  const base = config.baseIri ?? config.context.wiki;
  if (base === undefined || base === "") return null;
  const normalized = path.replace(/\\/g, "/");

  // Precedence: @id, then id, then filename (mirrors CLI frontmatter_to_graph)
  if (frontmatter) {
    const declared = frontmatter["@id"] ?? frontmatter["id"];
    if (declared !== undefined && declared !== null) {
      const idStr = String(declared).trim();
      if (idStr !== "") {
        // If absolute IRI (http(s)://, ftp://, urn:, etc.), return as-is
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(idStr) || idStr.startsWith("urn:")) {
          return idStr;
        }
        // Non-absolute: return as declared (CLI keeps as-is; base is handled by context)
        return idStr;
      }
    }
  }

  let slug = normalized;
  for (const input of config.inputs) {
    if (normalized === input || normalized.startsWith(`${input}/`)) {
      slug = normalized.slice(input.length + 1);
      break;
    }
  }
  return base + slug.replace(/\.md$/i, "");
}
