/**
 * What `wiki check` would say about a page, evaluated from the shapes the app
 * has already read.
 *
 * #8 asks for a form whose per-field state is the same answer the build gives,
 * and names `wiki check --json` (wazootech/wiki#310) as the way to get it. That
 * option is not on the command line yet, and there is a second reason it could
 * not be the whole answer even if it were: `check_shacl_file` reads through
 * `document_data_from_path`, so the CLI can only validate a file that is
 * **already on disk**. The first acceptance criterion in #8 is that a field
 * shows invalid *before saving*, which no call to a path-taking CLI can do.
 *
 * So the evaluation happens here, over the live buffer, from the same shape
 * documents the build reads. Three things keep that honest rather than a second
 * opinion:
 *
 * - **The messages are the shapes'.** `sh:message` is already used in this
 *   vault, and where a constraint has one it is used verbatim, so the string in
 *   the field and the string in `wiki check`'s report are the same string. Only
 *   a constraint with no message falls back, and the fallback is not invented
 *   here — it is pyshacl 0.31.0's own wording, measured and written down in
 *   {@link DEFAULT_MESSAGES}.
 * - **The keys are resolved the way the graph loader resolves them**, including
 *   the part that is easy to get wrong: a quoted YAML scalar is a string and a
 *   bare one is not, so `age: "3"` fails `sh:datatype xsd:integer` and
 *   `age: 3` does not. `literalTypeOf` is the copy of that rule.
 * - **The result is keyed by (focusNode, resultPath)**, never by a report
 *   node's label. Those labels change between processes, and a nested
 *   violation's own focus node is a blank node that changes too, so anything
 *   anchored to the page keeps its address across runs.
 *
 * What it does *not* do is inference, and that is stated rather than hidden:
 * `pyshacl.validate` is called with `inference="rdfs"` by the build, and a
 * constraint that only fires after rdfs expansion is not one this evaluator
 * will produce. The two shape documents in this vault declare no such
 * constraint, and `src/shacl_agreement_test.ts` runs both engines over the real
 * vault to keep the difference at zero rather than at "none that I know of".
 */
import type { YamlEntry, YamlValue } from "./frontmatter.ts";
import type {
  FieldConstraint,
  FieldModel,
  FrontmatterField,
} from "./fields.ts";
import type { TermResolver } from "./shapes.ts";

/** SHACL's severities. `sh:Warning` is a warning, and the form says so. */
export type Severity = "Violation" | "Warning" | "Info";

/** The constraint components this evaluator implements, by their SHACL names. */
export type ConstraintComponent = "MinCount" | "MaxCount" | "Datatype";

/** One validation result, addressed the way #8 requires it to be addressed. */
export interface Violation {
  /**
   * The document the result is about — the page's IRI, which is a named node
   * and so has an address that is the same in every process. A violation on a
   * nested structure is anchored here rather than to the blank node that
   * actually holds it, because that blank node's label differs between runs.
   */
  focusNode: string;
  /** The property the result is about, as the shape writes it. */
  resultPath: string;
  /** The same property as an IRI, when it resolves to one. */
  resultPathIri: string | null;
  severity: Severity;
  message: string;
  /**
   * Whether the message is the shape's own or the fallback. A reader can be
   * told which, and a shape that wrote its own message deserves the credit.
   */
  messageFrom: "shape" | "default";
  component: ConstraintComponent;
  /** The shape that raised it — never a blank node's label. */
  shape: FieldConstraint["shape"];
}

/**
 * What pyshacl 0.31.0 says when a constraint declares no `sh:message`.
 *
 * Measured, not remembered: each of these is the `Message:` line of a report
 * from a shape deliberately written without messages. The templates are the
 * tool's; the two terms inside them are rendered with this vault's own prefix
 * map, which is the same set of prefixes the report binds.
 */
export const DEFAULT_MESSAGES: Readonly<{
  MinCount: (args: { count: number; focus: string; path: string }) => string;
  MaxCount: (args: { count: number; focus: string; path: string }) => string;
  Datatype: (args: { focus: string; datatype: string }) => string;
}> = {
  MinCount: ({ count, focus, path }) =>
    `Less than ${count} values on ${focus}->${path}`,
  MaxCount: ({ count, focus, path }) =>
    `More than ${count} values on ${focus}->${path}`,
  Datatype: ({ datatype }) => `Value is not Literal with datatype ${datatype}`,
};

/** Every violation for one page, plus the lookup the form renders from. */
export interface ValidationReport {
  /** The page these results are about. */
  focusNode: string;
  violations: Violation[];
  /** The same results keyed by the IRI of the property they are about. */
  byIri: Map<string, Violation[]>;
  /**
   * True when no shape constrains this page at all. A vault with no shapes has
   * no errors and is not itself an error, and the form says so rather than
   * showing a page of green ticks it did not check.
   */
  unconstrained: boolean;
}

/**
 * Evaluate every field of a model.
 *
 * `focusNode` is the page's IRI, not its path: it is what the report names, so
 * a result that quotes it — which every fallback message does — comes out with
 * the same string the build produces. `documentIri` in `src/wiki_config.ts`
 * derives it the way the graph does.
 */
export function validate(
  model: FieldModel,
  resolver: TermResolver,
  focusNode: string,
): ValidationReport {
  const violations: Violation[] = [];
  const byIri = new Map<string, Violation[]>();
  let constrained = 0;

  for (const group of model.groups) {
    for (const field of group.fields) {
      for (const constraint of field.constraints) {
        constrained += 1;
        for (
          const violation of checkField(field, constraint, resolver, focusNode)
        ) {
          violations.push(violation);
          const key = constraint.iri ?? constraint.path;
          const list = byIri.get(key);
          if (list === undefined) byIri.set(key, [violation]);
          else list.push(violation);
        }
      }
    }
  }

  return {
    focusNode,
    violations,
    byIri,
    unconstrained: constrained === 0,
  };
}

/** Every violation one field's constraints produce. */
function checkField(
  field: FrontmatterField,
  constraint: FieldConstraint,
  resolver: TermResolver,
  focusNode: string,
): Violation[] {
  const out: Violation[] = [];
  const count = countValues(field.entry);
  // The report prints both terms with the graph's bound prefixes, so a
  // fallback message quoting the raw IRI would differ from `wiki check`'s for
  // the spelling alone.
  const focus = resolver.curie(focusNode) ?? focusNode;
  const path = resolver.curie(constraint.iri) ?? constraint.path;

  const report = (
    component: ConstraintComponent,
    message: string,
    messageFrom: "shape" | "default",
  ) => {
    out.push({
      focusNode,
      resultPath: constraint.path,
      resultPathIri: constraint.iri,
      // Every constraint this evaluator reads is a `sh:Violation` in SHACL
      // terms; `sh:Warning` is carried through so a shape that later declares
      // one renders as a warning rather than as an error.
      severity: "Violation",
      message,
      messageFrom,
      component,
      shape: constraint.shape,
    });
  };

  if (constraint.minCount !== null && count < constraint.minCount) {
    const message = constraint.message ??
      DEFAULT_MESSAGES.MinCount({ count: constraint.minCount, focus, path });
    report("MinCount", message, constraint.message ? "shape" : "default");
  }

  if (constraint.maxCount !== null && count > constraint.maxCount) {
    const message = constraint.message ??
      DEFAULT_MESSAGES.MaxCount({ count: constraint.maxCount, focus, path });
    report("MaxCount", message, constraint.message ? "shape" : "default");
  }

  if (constraint.datatype !== null && field.entry !== null) {
    // The shape writes `xsd:string` and rdflib compares against the IRI, so
    // the two have to meet before they can be equal.
    const expected = resolver.datatype(constraint.datatype);
    if (expected !== null) {
      for (const value of literalTypes(field.entry.value)) {
        if (value === expected) continue;
        const message = constraint.message ??
          DEFAULT_MESSAGES.Datatype({
            focus,
            datatype: resolver.curie(expected) ?? expected,
          });
        report("Datatype", message, constraint.message ? "shape" : "default");
      }
    }
  }

  return out;
}

/**
 * How many values a key carries, in the sense SHACL counts them.
 *
 * SHACL counts triples, and the graph loader adds none for a key with no
 * value: `resolve_object` falls through every branch for `None`. So `count: 0`
 * is a violation of `sh:minCount: 1`, which is the case #8's first acceptance
 * criterion is about, and it is why a key present but empty is not the same as
 * a key absent.
 */
export function countValues(entry: YamlEntry | null): number {
  if (entry === null) return 0;
  return valueCount(entry.value);
}

function valueCount(value: YamlValue): number {
  if (value.kind === "scalar") return value.style === "empty" ? 0 : 1;
  if (value.kind === "sequence") {
    return value.items.reduce(
      (total, item) => total + valueCount(item.value),
      0,
    );
  }
  // A mapping becomes a blank node, which is one value however many keys it has.
  return 1;
}

/**
 * The datatype the graph loader would give each of a value's scalars.
 *
 * The rule is in `resolve_object` in `src/wiki/graph.py`: a Python `str`
 * becomes `Literal(value)`, which rdflib leaves as `xsd:string` whatever it
 * contains; a `bool` becomes `xsd:boolean`; an `int` or `float` becomes a
 * numeric literal; a date or datetime becomes `xsd:date` or `xsd:dateTime`.
 * YAML is what decides which of those a plain scalar parses to, and a quoted
 * scalar is always a string — which is why `age: "3"` is a datatype violation
 * against `sh:datatype xsd:integer` and `age: 3` is not.
 */
export function literalTypes(value: YamlValue): string[] {
  if (value.kind === "scalar") {
    if (value.style === "empty") return [];
    return [literalTypeOf(value.text, value.style)];
  }
  if (value.kind === "sequence") {
    return value.items.flatMap((item) => literalTypes(item.value));
  }
  // A blank node has no literal datatype, so no `sh:datatype` applies to it.
  return [];
}

const XSD = "http://www.w3.org/2001/XMLSchema#";

/** The datatype a single scalar becomes, given how it was written. */
export function literalTypeOf(
  text: string,
  style: string,
): string {
  if (style === "single" || style === "double" || style === "flow") {
    // A quoted scalar is a Python `str` however much of a number it looks like.
    return `${XSD}string`;
  }
  const value = text.trim();
  if (value === "true" || value === "false") return `${XSD}boolean`;
  if (/^[+-]?\d+$/.test(value)) return `${XSD}integer`;
  if (
    /^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(value) &&
    /[.eE]/.test(value)
  ) {
    return `${XSD}double`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${XSD}date`;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) return `${XSD}dateTime`;
  return `${XSD}string`;
}

/** What a page's field state is, as the form renders it. */
export type FieldState =
  /** At least one result, at violation severity. */
  | "invalid"
  /** Checked, and nothing to report. */
  | "valid"
  /** Not yet checked: the validator has not answered, or has gone away. */
  | "unknown"
  /** No shape constrains this field, so nothing was checked. */
  | "undeclared";

/**
 * A field's state, and the results behind it.
 *
 * A field with two results is one field, not two, and this is where the form's
 * answer to #8's fourth criterion lives: the state is the worst of the results
 * and the list is all of them, so the row can say which shapes raised them
 * rather than picking one.
 *
 * A `null` report is the case the issue calls out by name: an unreachable
 * validator must be a visible state, and the only way to tell "nothing was
 * wrong" from "nothing was checked" is to not pass an empty report where a
 * real one belongs. `unknown` is that state, and it is not a green tick.
 */
export function stateOf(
  field: FrontmatterField,
  report: ValidationReport | null,
): { state: FieldState; results: Violation[] } {
  if (field.constraints.length === 0) {
    return { state: "undeclared", results: [] };
  }
  if (report === null) return { state: "unknown", results: [] };
  const key = field.iri ?? field.key;
  const results = report.byIri.get(key) ?? [];
  if (results.length === 0) return { state: "valid", results };
  return {
    state: results.some((result) => result.severity === "Violation")
      ? "invalid"
      : "valid",
    results,
  };
}
