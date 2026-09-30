/**
 * What the form shows: the fields of one page, in the order it should show
 * them, each carrying every constraint that applies to it.
 *
 * The field set is the **union of declared and observed**, and that is not a
 * hedge — it is the only set that does not break the vault. The declared
 * vocabulary is five properties in total, across two shape pages. Pages
 * meanwhile use fourteen or more distinct keys, and the two most used,
 * `wazoo:layout` and `redirect_to`, are on 17 pages each and declared by no
 * shape at all. A form built from what shapes declare would make a third of
 * this vault's pages unsettable and invisible.
 *
 * So: declared first, because those are the ones the build will reject a page
 * without, and each carrying its own `sh:minCount` / `sh:maxCount` /
 * `sh:message`; the page's own keys after it, so nothing in real use is
 * unreachable; the keys other pages in the vault use last, since they are
 * advice rather than fact about this page; and the layout keys in their own
 * group, because they are mechanics and not properties of a class.
 *
 * The other half of this module's job is **attribution**. One key can be
 * constrained by more than one shape, and `Linked_Markdown.md` is that case in
 * practice: it carries `schema:TechArticle` *and* `schema:SoftwareApplication`,
 * and both shapes constrain `schema:description` with `sh:minCount: 1`. Joining
 * on the path alone would hand one error to two shapes, and joining on a
 * report node's label would be worse still — those labels change between
 * processes. So a field carries a *list* of constraints, each naming the shape
 * that raised it, and a field with two of them renders two markers.
 */
import { entryFor, type YamlEntry, type YamlMapping } from "./frontmatter.ts";
import {
  type ShapeDeclaration,
  STRUCTURAL_KEYS,
  type TermResolver,
  typeValues,
} from "./shapes.ts";

/** Where a field's place in the form comes from. */
export type FieldOrigin =
  /** A shape targets this page's class and constrains this key. */
  | "declared"
  /** The page carries it and no shape declares it. */
  | "observed"
  /** The page carries it and other pages in the vault use it too. */
  | "suggested"
  /** Layout or redirect mechanics, on 17 pages each and declared by no shape. */
  | "structural";

/** One constraint on one key, with the shape that wrote it. */
export interface FieldConstraint {
  /** `sh:path` as the shape wrote it. */
  path: string;
  iri: string | null;
  minCount: number | null;
  maxCount: number | null;
  datatype: string | null;
  message: string | null;
  /** The shape's own page, its target class, and the label it gave itself. */
  shape: {
    sourcePath: string;
    targetClass: string;
    targetClassIri: string | null;
    label: string | null;
  };
}

/** One row of the form. */
export interface FrontmatterField {
  /**
   * The key as the page writes it, or the shape's spelling when the page does
   * not have it. A field added from a shape is added under the name the shape
   * asked for, because that is the name the build will look for.
   */
  key: string;
  /** The IRI both spellings resolve to, or null when neither resolves. */
  iri: string | null;
  origin: FieldOrigin;
  /** The page's own entry, or null for a field the page does not have yet. */
  entry: YamlEntry | null;
  /** Every constraint that applies, in the order the shapes were read. */
  constraints: FieldConstraint[];
  /**
   * True when the key is absent and its value is inferred rather than written.
   * An inferred value is never written to the file on its own.
   */
  missing: boolean;
}

export interface FieldGroup {
  id: FieldOrigin;
  /** What the group is, in the words of the thing it is describing. */
  label: string;
  /** Why it is here, for the line under the heading. */
  /** A line under the label, or null when the label says it all. */
  hint: string | null;
  fields: FrontmatterField[];
}

/** The class a page declares, and the shape that constrains it. */
export interface PageClass {
  /** The term as the page wrote it: `TechArticle` or `schema:TechArticle`. */
  term: string;
  iri: string | null;
  /** The shape targeting this class, or null when none does. */
  shape: {
    sourcePath: string;
    label: string | null;
  } | null;
}

export interface FieldModel {
  classes: PageClass[];
  groups: FieldGroup[];
  /**
   * Every key the page carries at the top level, whether or not a group shows
   * it. Empty in practice — it exists so a test can fail if a key is ever
   * dropped, because a dropped key is a key the form would silently delete.
   */
  unshown: string[];
}

/** What the model needs to know about the vault beyond the page itself. */
export interface VaultVocabulary {
  /** `graph.context`, read by `src/wiki_config.ts`. */
  context: Record<string, string>;
  /** Every shape declared by a page in the vault. */
  shapes: ShapeDeclaration[];
  /** Keys other pages use, with how many pages use each. */
  observedKeys: Record<string, number>;
}

/**
 * Build the field model for one page.
 *
 * Pure: the page's text and the vault's vocabulary in, the form's rows out. The
 * caller decides when to rebuild, which for the editor is on every change to
 * the buffer rather than on a timer.
 */
export function buildFieldModel(
  mapping: YamlMapping,
  vocabulary: VaultVocabulary,
  resolver: TermResolver,
): FieldModel {
  const { shapes, observedKeys } = vocabulary;

  const classes: PageClass[] = typeValues(mapping).map((term) => {
    const iri = resolver.type(term);
    const shape = iri === null ? undefined : shapes.find(
      (candidate) => candidate.targetClassIri === iri,
    );
    return {
      term,
      iri,
      shape: shape === undefined ? null : {
        sourcePath: shape.sourcePath,
        label: shape.label,
      },
    };
  });

  // Every shape whose target class this page carries. A page can satisfy more
  // than one at once, and their fields have to merge while their errors stay
  // attributable — so this is a list and never a first-match.
  const applicable = shapes.filter((shape) =>
    shape.targetClassIri !== null &&
    classes.some((declared) => declared.iri === shape.targetClassIri)
  );

  const declared = new Map<string, FrontmatterField>();
  for (const shape of applicable) {
    for (const property of shape.properties) {
      if (property.iri === null) continue;
      const existing = declared.get(property.iri);
      const constraint: FieldConstraint = {
        path: property.path,
        iri: property.iri,
        minCount: property.minCount,
        maxCount: property.maxCount,
        datatype: property.datatype,
        message: property.message,
        shape: {
          sourcePath: shape.sourcePath,
          targetClass: shape.targetClass,
          targetClassIri: shape.targetClassIri,
          label: shape.label,
        },
      };
      if (existing === undefined) {
        const entry = entryForIri(mapping, property.iri, resolver);
        declared.set(property.iri, {
          // The page's own spelling of the key when it has one, because the
          // form edits a file and the name in the form should be the name in
          // the file. Failing that, the name the *page* would write: a shape
          // spells a schema.org property `schema:description` because it is
          // addressing a validator, and a page writing `description` means the
          // same property through the same `@vocab`. The shape's own spelling
          // is the last resort, for a property no bare name covers.
          key: entry?.key ??
            resolver.bareName(property.iri) ??
            property.path,
          iri: property.iri,
          origin: "declared",
          entry,
          constraints: [constraint],
          missing: true,
        });
        continue;
      }
      // The same property constrained by a second shape: both constraints
      // stand, and the field is not missing if the first one found it.
      existing.constraints.push(constraint);
      if (existing.entry === null) {
        existing.entry = entryForIri(mapping, property.iri, resolver);
        if (existing.entry !== null) existing.key = existing.entry.key;
      }
    }
  }
  for (const field of declared.values()) {
    field.missing = field.entry === null;
  }
  const shown = new Set<string>();
  const claimed: string[] = [];
  for (const field of declared.values()) {
    if (field.entry !== null) claimed.push(field.entry.key);
    shown.add(field.iri ?? field.key);
  }
  // `type` is the class, and the class has its own read-only row at the top of
  // the form. A shape constrains a page's properties, not its class, so no
  // shape claims it and it would otherwise fall into the observed group and be
  // offered as an editable property of itself.
  for (const entry of mapping.entries) {
    if (entry.key === "type" || entry.key === "@type") claimed.push(entry.key);
  }

  const structural: FrontmatterField[] = [];
  const structuralSuggestions: FrontmatterField[] = [];
  const observed: FrontmatterField[] = [];
  const suggested: FrontmatterField[] = [];

  for (const entry of mapping.entries) {
    if (claimed.includes(entry.key)) continue;
    const iri = resolver.predicate(entry.key);
    // Two keys on one page can resolve to one IRI — a bare key and its
    // prefixed spelling, say. The declared field claims the first; the second
    // is still a key the author wrote, so it is still shown.
    if (iri !== null && declared.has(iri)) claimed.push(entry.key);
    const field: FrontmatterField = {
      key: entry.key,
      iri,
      origin: STRUCTURAL_KEYS.has(entry.key) ||
          (iri !== null && isStructuralIri(iri))
        ? "structural"
        : "observed",
      entry,
      constraints: [],
      missing: false,
    };
    if (field.origin === "structural") structural.push(field);
    else observed.push(field);
  }

  for (const key of Object.keys(observedKeys)) {
    if (claimed.includes(key)) continue;
    const iri = resolver.predicate(key);
    if (iri !== null && declared.has(iri)) continue;
    if (observed.some((field) => field.key === key)) continue;
    if (structural.some((field) => field.key === key)) continue;
    const origin = STRUCTURAL_KEYS.has(key) ? "structural" : "suggested";
    const field: FrontmatterField = {
      key,
      iri,
      origin,
      entry: null,
      constraints: [],
      missing: true,
    };
    if (origin === "structural") structuralSuggestions.push(field);
    else suggested.push(field);
  }
  const byUse = (a: FrontmatterField, b: FrontmatterField) =>
    (observedKeys[b.key] ?? 0) - (observedKeys[a.key] ?? 0) ||
    a.key.localeCompare(b.key);
  suggested.sort(byUse);
  structuralSuggestions.sort(byUse);
  // The page's own keys keep the order the page has them in, and only the keys
  // being offered are ordered — a form that reordered an author's frontmatter
  // to sort it would be the serialiser this whole design refuses to be.
  structural.push(...structuralSuggestions);

  const groups: FieldGroup[] = [];
  const declaredFields = [...declared.values()];
  if (declaredFields.length > 0) {
    groups.push({
      id: "declared",
      label: "Required by this page's shape",
      // Only when it says something the heading above does not. With one shape
      // the header already names it, and a second line reading "Declared by
      // TechArticle Shape" directly under a header that says the same is the
      // kind of restatement that makes a panel hard to scan. With several, the
      // count is the part a reader cannot get anywhere else.
      hint: applicable.length > 1
        ? `${applicable.length} shapes apply to this page, so a field can carry more than one result.`
        : null,
      fields: declaredFields,
    });
  }
  if (observed.length > 0) {
    groups.push({
      id: "observed",
      label: "On this page",
      hint: null,
      fields: observed,
    });
  }
  if (suggested.length > 0) {
    groups.push({
      id: "suggested",
      label: "Used elsewhere in this vault",
      hint: "No shape declares these, and this page does not use them yet.",
      fields: suggested,
    });
  }
  if (structural.length > 0) {
    groups.push({
      id: "structural",
      label: "Layout and redirects",
      hint: "Mechanics rather than properties of a class.",
      fields: structural,
    });
  }

  const unshown: string[] = [];
  for (const entry of mapping.entries) {
    if (entry.key === "type" || entry.key === "@type") continue;
    const field = [...declared.values(), ...observed, ...structural].find(
      (candidate) => candidate.entry === entry,
    );
    if (field === undefined) unshown.push(entry.key);
  }

  return { classes, groups, unshown };
}

/** The page's own entry for a key, matched by the IRI it resolves to. */
function entryForIri(
  mapping: YamlMapping,
  iri: string,
  resolver: TermResolver,
): YamlEntry | null {
  for (const entry of mapping.entries) {
    if (entry.key === "type" || entry.key === "@type") continue;
    if (resolver.predicate(entry.key) === iri) return entry;
  }
  return null;
}

/** Whether an IRI is one of the layout keys under a different spelling. */
function isStructuralIri(iri: string): boolean {
  for (const key of STRUCTURAL_KEYS) {
    if (iri.endsWith(key)) return true;
  }
  return false;
}

/** The `wazoo:layout` a page asks for, for the form's own summary line. */
export function layoutOf(mapping: YamlMapping): string | null {
  const entry = entryFor(mapping, "wazoo:layout");
  if (entry?.value.kind !== "scalar") return null;
  return entry.value.style === "empty" ? null : entry.value.text;
}
