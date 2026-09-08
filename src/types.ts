export interface WikiPage {
  /** Route path, e.g. "people/ada-lovelace" */
  route: string;
  title: string;
  children?: WikiPage[];
}

export interface FrontmatterEntry {
  key: string;
  value: string;
}

export interface Backlink {
  /** Route of the page linking here */
  from: string;
  /** Link text as written */
  text: string;
  /** Sentence fragment around the link */
  context: string;
}

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
}

export interface WikiDoc {
  route: string;
  frontmatter: FrontmatterEntry[];
  body: string;
  backlinks: Backlink[];
  diagnostics: Diagnostic[];
}
