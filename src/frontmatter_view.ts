/// <reference lib="dom" />
/**
 * The frontmatter panel: a form over the same buffer the editor holds.
 *
 * The whole design is that this is a **view**, not a second document. Every
 * value it shows came from a span in the text the editor already has, and every
 * value it writes is a `TextEdit` over that same text — which is what keeps
 * criterion 1 (wazootech/wiki-desktop#6) true for a page whose frontmatter
 * somebody edited through the form. There is no serialiser anywhere in this
 * file, and `src/frontmatter_test.ts` is what proves it by editing a field in
 * every page of a real vault and asserting a one-line diff.
 *
 * Two modes, as #22 frames them. **Raw** is the buffer as it has always been:
 * the escape hatch, and the only mode for a page whose frontmatter does not
 * parse or whose class no shape targets. **Structured** is this panel. The
 * toggle between them is a view state persisted in the app config, not a
 * per-document editing mode, and it is never a parse failure: a page that does
 * not parse opens, shows raw, and saves unchanged.
 *
 * The plan below is separated from the rendering for the same reason
 * `src/format.ts` is its own module: this is the part with the rules in it, and
 * it is pure, so `src/frontmatter_view_test.ts` can read a plan and assert on it
 * with no DOM at all. What is left in the panel is element creation.
 */
import {
  applyEdit,
  endOfMappingAnchor,
  type FrontmatterProblem,
  insertEdit,
  readFrontmatter,
  removeEdit,
  setValueEdit,
  type TextEdit,
  type YamlEntry,
  type YamlItem,
  type YamlValue,
} from "./frontmatter.ts";
import {
  buildFieldModel,
  type FieldModel,
  type FieldOrigin,
} from "./fields.ts";
import { type FieldState, stateOf, validate, type Violation } from "./shacl.ts";
import { documentIri, TermResolver } from "./shapes.ts";
import type { VaultVocabularyPayload } from "./vocabulary.ts";

/** Which view the frontmatter is shown in. */
export type FrontmatterMode = "auto" | "structured" | "raw";

/** The view that is actually on screen, once `auto` has been resolved. */
export type ResolvedMode = "structured" | "raw";

/** One field as the panel will draw it. */
export interface FieldPlan {
  /** The key as the page writes it, or the shape's spelling when it has none. */
  key: string;
  iri: string | null;
  origin: FieldOrigin;
  state: FieldState;
  /** One line of text for a single-line input, or null for a block value. */
  scalar: string | null;
  /**
   * The value as rows, when it is a list of maps or a map. This is the
   * recursion: a shape document's own `sh:property` list renders as a list of
   * field groups, from the same builder, with no per-type code.
   */
  block: BlockPlan | null;
  /** The entry this field edits, or null when the page does not have the key. */
  entry: YamlEntry | null;
  /**
   * The list item this field edits, or null when it is not a list item.
   *
   * An item has no key, so it cannot be written by inserting one: a field with
   * neither an entry nor an item is a key the page has not written yet, and an
   * item is the other thing entirely — a value that exists, under a dash, with
   * its own span to replace.
   */
  item: YamlItem | null;
  /** Every result for this field, each naming the shape that raised it. */
  results: Violation[];
  missing: boolean;
}

/** A value that is a list or a map, rendered as rows rather than as text. */
export interface BlockPlan {
  kind: "sequence" | "mapping";
  /** One entry per list item or map key, labelled for the reader. */
  children: BlockChild[];
}

export interface BlockChild {
  /** `1`, `2` for a list; the key itself for a map. */
  label: string;
  /** The list item's or map key's own entry, which a remove control edits. */
  entry: YamlEntry | null;
  fields: FieldPlan[];
}

export interface GroupPlan {
  id: FieldOrigin;
  label: string;
  /** A line under the label, or null when the label says it all. */
  hint: string | null;
  fields: FieldPlan[];
}

export interface ClassPlan {
  term: string;
  iri: string | null;
  /** The shape targeting this class, or null when none does. */
  shape: { sourcePath: string; label: string | null } | null;
}

/** Everything the panel draws, decided before any element exists. */
export interface FrontmatterPlan {
  mode: ResolvedMode;
  /**
   * Why structured is not on, when it is not: the page has no block, the block
   * does not close, nothing declared a shape for its class, the reader asked
   * for raw, or the vault's config has not been read. The panel shows this
   * rather than an empty form, because an empty form on a page that does parse
   * would be indistinguishable from a page with no fields.
   */
  reason:
    | FrontmatterProblem
    | "no-shape"
    | "no-vocabulary"
    | "off"
    | null;
  classes: ClassPlan[];
  groups: GroupPlan[];
  /** True when no shape constrains this page, so nothing was checked. */
  unconstrained: boolean;
  /** Every result, for the panel's own count in the header. */
  problems: Violation[];
  /** The class row the panel shows read-only, for the header. */
  classHeading: string | null;
}

/**
 * Decide what the panel shows for one document.
 *
 * `auto` resolves to structured when the page parses, the class resolves and
 * some shape targets it, and raw otherwise — which is the answer #22 asks for
 * and the reason 2 of 85 content pages are not a gap in the feature.
 */
export function planFrontmatter(
  text: string,
  path: string,
  vocabulary: VaultVocabularyPayload | null,
  mode: FrontmatterMode,
): FrontmatterPlan {
  const empty: FrontmatterPlan = {
    mode: "raw",
    reason: "no-vocabulary",
    classes: [],
    groups: [],
    unconstrained: true,
    problems: [],
    classHeading: null,
  };
  if (vocabulary === null) return empty;

  const { frontmatter, problem } = readFrontmatter(text);
  if (frontmatter === null) {
    return { ...empty, reason: problem };
  }

  const resolver = new TermResolver(vocabulary.context);
  const model: FieldModel = buildFieldModel(
    frontmatter.mapping,
    {
      context: vocabulary.context,
      shapes: vocabulary.shapes,
      observedKeys: vocabulary.observedKeys,
    },
    resolver,
  );
  const focus = documentIri(path, {
    inputs: vocabulary.inputs,
    context: vocabulary.context,
    baseIri: vocabulary.baseIri,
  });
  // A page with no IRI is a page the build would not name either, and a result
  // with no focus node has nowhere stable to be anchored.
  const report = focus === null ? null : validate(model, resolver, focus);

  const classes: ClassPlan[] = model.classes.map((declared) => ({
    term: declared.term,
    iri: declared.iri,
    shape: declared.shape,
  }));
  const noShape = classes.every((declared) => declared.shape === null);
  // `auto` is the recommendation and it defers to what the vault declares: a
  // class no shape targets has no properties to recommend, so raw is both the
  // honest answer and the escape hatch #22 asks for. An explicit choice is the
  // reader's and is not second-guessed — a shape document, which no shape
  // constrains, is exactly the page somebody wants to see as fields.
  const resolved: ResolvedMode = mode === "raw"
    ? "raw"
    : mode === "structured"
    ? "structured"
    : noShape
    ? "raw"
    : "structured";

  // Nothing is drawn in raw mode, so nothing is built: the rows would be read
  // by nobody, and this runs on every change to the buffer.
  const groups: GroupPlan[] = resolved === "raw" ? [] : model.groups.map((
    group,
  ) => ({
    id: group.id,
    label: group.label,
    hint: group.hint,
    fields: group.fields.map((field) => planField(field, report)),
  }));

  return {
    mode: resolved,
    reason: resolved === "raw"
      ? (mode === "raw" ? "off" : noShape ? "no-shape" : null)
      : null,
    classes,
    groups,
    unconstrained: report?.unconstrained ?? true,
    problems: report?.violations ?? [],
    classHeading: classes.length > 0
      ? classes.map((declared) => declared.term).join(", ")
      : null,
  };
}

/** One field, and anything nested under it. */
function planField(
  field: {
    key: string;
    iri: string | null;
    origin: FieldOrigin;
    entry: YamlEntry | null;
  },
  report: ReturnType<typeof validate> | null,
): FieldPlan {
  const { state, results } = stateOf(
    field as Parameters<typeof stateOf>[0],
    report,
  );
  return {
    key: field.key,
    iri: field.iri,
    origin: field.origin,
    state,
    scalar: scalarOf(field.entry),
    block: blockOf(field.entry?.value ?? null),
    entry: field.entry,
    item: null,
    results,
    missing: field.entry === null,
  };
}

/** The one line of text a single-line input holds, or null for anything else. */
function scalarOf(entry: YamlEntry | null): string | null {
  if (entry === null) return null;
  const { value } = entry;
  if (value.kind === "scalar") {
    return value.style === "empty" ? "" : value.text;
  }
  // A sequence is always rows, never one input. A flow list is not a sequence
  // here: a balanced `[a, b]` on one line parses as a scalar whose style is
  // `flow`, and the case above already returns it, verbatim, as the text the
  // reader wrote. What reaches here is a block list, and joining its items
  // into one line would show a list of maps as `[, ]` and invite an edit that
  // would throw the maps away.
  return null;
}

/** A value rendered as rows, which is what makes the component recursive. */
function blockOf(value: YamlValue | null): BlockPlan | null {
  if (value === null) return null;
  if (value.kind === "mapping") {
    return {
      kind: "mapping",
      children: value.entries.map((entry) => ({
        label: entry.key,
        entry,
        // A key whose value is itself a list or a map gets rows of its own;
        // one whose value is a scalar is a single row. Either way it is this
        // same builder, which is what makes deeper nesting an arrival rather
        // than a rewrite.
        fields: entry.value.kind === "scalar"
          ? [planNested(entry)]
          : blockOf(entry.value)?.children.flatMap((child) => child.fields) ??
            [planNested(entry)],
      })),
    };
  }
  if (value.kind === "sequence") {
    return {
      kind: "sequence",
      children: value.items.map((item, index) => ({
        label: String(index + 1),
        entry: null,
        fields: item.value.kind === "mapping"
          ? item.value.entries.map((nested) => planNested(nested))
          : [planScalarItem(item, String(index + 1))],
      })),
    };
  }
  return null;
}

/**
 * A nested entry.
 *
 * `undeclared` rather than `valid`, and the distinction is the point: no shape
 * constrains a key inside a nested structure, so the panel has checked nothing
 * and says so. Calling it valid would be a green tick for a check that did not
 * happen.
 */
function planNested(entry: YamlEntry): FieldPlan {
  return {
    key: entry.key,
    iri: null,
    origin: "observed",
    state: "undeclared",
    scalar: entry.value.kind === "scalar" && entry.value.style !== "empty"
      ? entry.value.text
      : null,
    block: entry.value.kind === "scalar" ? null : blockOf(entry.value),
    entry,
    item: null,
    results: [],
    missing: false,
  };
}

/** A list item that is a scalar rather than a map. */
function planScalarItem(item: YamlItem, label: string): FieldPlan {
  return {
    key: label,
    iri: null,
    origin: "observed",
    state: "undeclared",
    scalar: item.value.kind === "scalar" && item.value.style !== "empty"
      ? item.value.text
      : "",
    block: null,
    entry: null,
    item,
    results: [],
    missing: false,
  };
}

/**
 * The edit that gives a field the value the reader typed.
 *
 * A field the page has is replaced at its own span; a field the page does not
 * have is a new line inserted after the keys it sits among. Both go through the
 * same minimal-edit path the rest of the app uses, which is why a write from
 * this panel is one line changed and never a reserialised block.
 */
export function editFor(
  text: string,
  field: FieldPlan,
  value: string,
): TextEdit | null {
  const { frontmatter } = readFrontmatter(text);
  if (frontmatter === null) return null;
  if (field.entry !== null) return setValueEdit(text, field.entry, value);
  if (field.item !== null) {
    // An item is written through the same value path as a key, with the dash
    // standing in for the key token: what changes is the one token the item
    // holds, and `- alpha` becomes `- beta` rather than gaining a sibling.
    return setValueEdit(
      text,
      {
        key: field.key,
        keySpan: { from: field.item.span.from, to: field.item.span.from },
        value: field.item.value,
        span: field.item.span,
      },
      value,
    );
  }
  return insertEdit(
    endOfMappingAnchor(text, frontmatter.mapping),
    0,
    field.key,
    value,
  );
}

/** The edit that removes a field the page has, or null when it has none. */
export function removeFor(text: string, field: FieldPlan): TextEdit | null {
  if (field.entry === null) return null;
  return removeEdit(text, field.entry);
}

/** Apply an edit. A null or unchanged edit returns the same text. */
export function editText(text: string, edit: TextEdit | null): string {
  if (edit === null) return text;
  return applyEdit(text, edit);
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

/** What the panel needs from the editor it is docked to. */
export interface FrontmatterHost {
  /** The document as it is now, which may carry unsaved changes. */
  text(): string;
  /** Replace a range, as one undo step, and redraw. */
  apply(edit: TextEdit): void;
  /** The vault path of the document on screen, for its IRI. */
  path(): string;
}

/**
 * A panel that renders a plan and writes edits back.
 *
 * Redrawn whole on every change rather than patched: a field's validity depends
 * on the page's whole class and every shape behind it, and a plan is cheap
 * enough (a few dozen fields over spans) that reconciling it would be a second
 * source of truth about what the panel shows. The editor's own state is the
 * undo stack; the panel holds no state beyond the mode.
 */
export class FrontmatterPanel {
  /** The element the panel draws into, for the editor to dock. */
  readonly root: HTMLElement;
  private readonly host: FrontmatterHost;
  private vocabulary: VaultVocabularyPayload | null = null;
  private mode: FrontmatterMode = "auto";
  private readonly onModeChange: (mode: FrontmatterMode) => void;
  private readonly onDirty: () => void;

  constructor(
    root: HTMLElement,
    host: FrontmatterHost,
    options: {
      onModeChange?: (mode: FrontmatterMode) => void;
      onDirty?: () => void;
    } = {},
  ) {
    this.root = root;
    this.host = host;
    this.onModeChange = options.onModeChange ?? (() => {});
    this.onDirty = options.onDirty ?? (() => {});
    this.root.className = "wiki-frontmatter";
    this.root.hidden = true;
  }

  /** Give the panel the vault's declared vocabulary, and redraw. */
  setVocabulary(vocabulary: VaultVocabularyPayload | null): void {
    this.vocabulary = vocabulary;
    this.render();
  }

  /** Set the mode the reader chose, and redraw. */
  setMode(mode: FrontmatterMode): void {
    this.mode = mode;
    this.render();
  }

  /** The mode the reader chose, which is what the config stores. */
  chosenMode(): FrontmatterMode {
    return this.mode;
  }

  /** The plan for the document on screen. */
  plan(): FrontmatterPlan {
    return planFrontmatter(
      this.host.text(),
      this.host.path(),
      this.vocabulary,
      this.mode,
    );
  }

  /** Redraw from the document as it is now. */
  render(): void {
    const plan = this.plan();
    this.root.replaceChildren();
    if (plan.mode === "raw") {
      // Raw is the escape hatch: the panel stands down and leaves the buffer
      // alone, which is the mode every page can be saved in. It collapses to a
      // single line, because in raw the editor below is already showing the
      // frontmatter and a tall panel would only repeat it. What stays is the
      // reason and the toggle, and the toggle is the only way back: a page
      // that `auto` stood down on — a shape document, say — should not have to
      // be argued with through the command menu to be shown.
      this.root.hidden = plan.reason === null;
      if (plan.reason !== null) {
        this.root.classList.add("wiki-frontmatter-collapsed");
        this.root.append(this.renderCollapsed(plan));
      }
      return;
    }
    this.root.classList.remove("wiki-frontmatter-collapsed");
    this.root.hidden = false;
    this.root.append(this.renderHeader(plan));
    for (const group of plan.groups) {
      this.root.append(this.renderGroup(group, 0));
    }
  }

  /** One line: why the panel is standing down, and the way back. */
  private renderCollapsed(plan: FrontmatterPlan): HTMLElement {
    const bar = el("div", "wiki-frontmatter-bar");
    // The reason alone reads as a fragment once the panel is one line tall —
    // "you asked for raw" wants its subject — so the label is kept, and the
    // reason is the short one, because this bar has a toggle to sit beside and
    // no room for a sentence that says the same thing at greater length.
    bar.append(
      el(
        "span",
        "wiki-frontmatter-bar-text",
        `Raw frontmatter — ${reasonBarText(plan.reason)}.`,
      ),
      this.renderToggle(plan),
    );
    return bar;
  }

  /** The Structured / Raw choice, which is the panel's one piece of chrome. */
  private renderToggle(plan: FrontmatterPlan): HTMLElement {
    const toggle = el("div", "wiki-frontmatter-modes");
    for (const choice of ["structured", "raw"] as const) {
      const on = this.mode === choice ||
        (this.mode === "auto" && choice === "structured");
      const button = buttonEl(
        `wiki-frontmatter-mode${on ? " is-on" : ""}`,
        choice === "structured" ? "Structured" : "Raw",
      );
      button.setAttribute("aria-pressed", String(plan.mode === choice));
      button.addEventListener("click", () => {
        this.setMode(choice);
        this.onModeChange(choice);
      });
      toggle.append(button);
    }
    return toggle;
  }

  /** The class row and the toggle, which is the panel's one piece of chrome. */
  private renderHeader(plan: FrontmatterPlan): HTMLElement {
    const header = el("div", "wiki-frontmatter-head");
    const heading = el("div", "wiki-frontmatter-class");
    heading.append(
      el("span", "wiki-frontmatter-class-label", "Class"),
      el(
        "span",
        "wiki-frontmatter-class-value",
        plan.classHeading ?? "none",
      ),
    );
    /*
     * Which shape speaks for this class. It used to name the class a second
     * time beside the answer, and then carry a third line saying nothing had
     * been checked; the reader wants one row here and the fields below it, not
     * a paragraph about the fields below it.
     */
    const parts = plan.classes.map((declared) =>
      declared.shape === null
        ? "no shape targets this class"
        : (declared.shape.label ?? declared.shape.sourcePath)
    );
    const where = parts.length === 1 ? parts[0] : parts.join(" · ");
    if (where !== "") {
      heading.append(el("p", "wiki-frontmatter-class-where", where));
    }
    header.append(heading, this.renderToggle(plan));
    // A status rather than a fact about the class, so it gets its own line: it
    // is the sentence a reader needs before reading any row below, and folding
    // it into the class line left it wrapping around a single orphan word.
    const top = el("div", "wiki-frontmatter-top");
    top.append(header);
    if (plan.unconstrained) {
      top.append(note("Nothing here has been checked."));
    }
    return top;
  }

  /**
   * One group of fields, at whatever depth the value nesting put it.
   *
   * The offered group is folded by default and the others are not, and the
   * reason is what each one is for. Declared, observed and structural fields are
   * facts about this page, and a reader opening a page expects to see them.
   * Suggested fields are a list of things other pages happen to use: useful,
   * advisory, and — measured on the toolchain's own vault — nine rows of empty
   * inputs standing between the reader and their document. A `details` element
   * is the whole implementation, which also means it is keyboard-operable and
   * announces its state without any of this module's help.
   */
  private renderGroup(group: GroupPlan, depth: number): HTMLElement {
    const section = el("section", `wiki-fm-group wiki-fm-depth-${depth}`);
    const hint = group.hint === null
      ? null
      : el("p", "wiki-fm-group-hint", group.hint);
    if (group.id !== "suggested") {
      section.append(el("h3", "wiki-fm-group-label", group.label));
      if (hint !== null) section.append(hint);
      for (const field of group.fields) {
        section.append(this.renderField(field, depth));
      }
      return section;
    }
    const details = document.createElement("details");
    details.className = "wiki-fm-details";
    const summary = document.createElement("summary");
    summary.className = "wiki-fm-group-label";
    summary.textContent = `${group.label} (${group.fields.length})`;
    details.append(summary);
    if (hint !== null) details.append(hint);
    for (const field of group.fields) {
      details.append(this.renderField(field, depth));
    }
    section.append(details);
    return section;
  }

  /** One field, and its block's rows when it has a block value. */
  private renderField(field: FieldPlan, depth: number): HTMLElement {
    const row = el("div", `wiki-fm-field wiki-fm-${field.state}`);
    const label = el("label", "wiki-fm-label");
    label.append(el("span", "wiki-fm-key", field.key));
    const state = el("span", `wiki-fm-state wiki-fm-state-${field.state}`);
    state.setAttribute("role", "img");
    state.setAttribute("aria-label", STATE_LABELS[field.state]);
    label.append(state);
    row.append(label);

    if (field.scalar !== null || field.entry === null) {
      const input = inputEl("wiki-fm-input");
      input.value = field.scalar ?? "";
      input.spellcheck = false;
      input.placeholder = field.missing ? `add ${field.key}` : "";
      input.setAttribute(
        "aria-label",
        `${field.key}${field.missing ? " (not set)" : ""}`,
      );
      // An input commits on blur, so between keystrokes and the commit the
      // row is showing a verdict and spans computed from text the reader has
      // already superseded. Say so rather than assert a stale one.
      let pending = false;
      const setPending = (next: boolean) => {
        if (pending === next) return;
        pending = next;
        row.classList.toggle("wiki-fm-pending", next);
        state.className = `wiki-fm-state wiki-fm-state-${
          next ? "unknown" : field.state
        }`;
        state.setAttribute(
          "aria-label",
          next ? "Not checked" : STATE_LABELS[field.state],
        );
      };
      input.addEventListener("input", () => {
        setPending(input.value !== (field.scalar ?? ""));
      });
      input.addEventListener("change", () => {
        this.write(field, input.value);
        // A write that redraws leaves this row detached; one that changes
        // nothing would otherwise leave it stuck saying "not checked".
        setPending(false);
      });
      row.append(input);
    }

    for (const result of field.results) {
      const message = el("p", "wiki-fm-message");
      message.append(
        el("span", "wiki-fm-message-text", result.message),
        el(
          "span",
          "wiki-fm-message-shape",
          result.shape.label ?? result.shape.sourcePath,
        ),
      );
      if (result.messageFrom === "default") {
        message.append(
          el(
            "span",
            "wiki-fm-message-origin",
            "no sh:message on this constraint",
          ),
        );
      }
      row.append(message);
    }

    if (field.entry !== null) {
      const remove = buttonEl("wiki-fm-remove", "Remove");
      remove.addEventListener("click", () => {
        const edit = removeFor(this.host.text(), field);
        if (edit !== null && edit.changed) this.host.apply(edit);
      });
      row.append(remove);
    }

    if (field.block !== null) {
      const kind = field.block.kind === "sequence" ? "Item" : "Key";
      for (const child of field.block.children) {
        const group = el("div", `wiki-fm-child wiki-fm-depth-${depth + 1}`);
        group.append(el("h4", "wiki-fm-child-label", `${kind} ${child.label}`));
        for (const nested of child.fields) {
          group.append(this.renderField(nested, depth + 1));
        }
        row.append(group);
      }
    }

    return row;
  }

  /** Write a value through the minimal-edit path, and let the editor redraw. */
  private write(field: FieldPlan, value: string): void {
    const edit = editFor(this.host.text(), field, value);
    if (edit !== null && edit.changed) this.host.apply(edit);
    this.onDirty();
  }
}

/** What a field's marker says, read aloud, for each verdict. */
const STATE_LABELS: Record<string, string> = {
  valid: "Valid",
  invalid: "Invalid",
  unknown: "Not checked",
  undeclared: "No shape declares this",
};

/** Why structured is not on, short enough to sit beside a toggle. */
function reasonBarText(reason: FrontmatterPlan["reason"]): string {
  switch (reason) {
    case "absent":
      return "this page has no frontmatter block";
    case "unterminated":
      return "the frontmatter block is never closed";
    case "no-shape":
      return "no shape targets this class";
    case "no-vocabulary":
      return "the vault's wiki.yml has not been read yet";
    case "off":
      return "you asked for raw";
    default:
      return "structured view is off";
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A text input, typed as one so `.value` is not a cast. */
function inputEl(className: string): HTMLInputElement {
  const node = document.createElement("input");
  node.className = className;
  node.type = "text";
  return node;
}

/** A button, typed as one so `.type` is not a cast. */
function buttonEl(className: string, text: string): HTMLButtonElement {
  const node = document.createElement("button");
  node.className = className;
  node.type = "button";
  node.textContent = text;
  return node;
}

function note(text: string): HTMLElement {
  return el("p", "wiki-fm-note", text);
}
