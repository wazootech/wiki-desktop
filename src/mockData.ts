import type { WikiDoc, WikiPage } from "./types";

/** Mock wiki content — stands in for the wazootech-wiki bridge until it lands. */

export const pageTree: WikiPage[] = [
  {
    route: "index",
    title: "Home",
    children: [
      { route: "people/ada-lovelace", title: "Ada Lovelace" },
      { route: "people/grace-hopper", title: "Grace Hopper" },
      {
        route: "concepts",
        title: "Concepts",
        children: [
          { route: "concepts/linked-markdown", title: "Linked Markdown" },
          { route: "concepts/typed-links", title: "Typed Links" },
          { route: "concepts/okf", title: "OKF Trust Stamps" },
        ],
      },
      {
        route: "tools",
        title: "Tools",
        children: [
          { route: "tools/wiki-cli", title: "wiki CLI" },
          { route: "tools/wiki-mcp", title: "wiki MCP" },
        ],
      },
    ],
  },
];

const docs: Record<string, WikiDoc> = {
  "concepts/linked-markdown": {
    route: "concepts/linked-markdown",
    frontmatter: [
      { key: "@context", value: "https://wazoo.dev/wiki/v1" },
      { key: "@id", value: "wiki:concepts/linked-markdown" },
      { key: "@type", value: "wiki:Concept" },
      { key: "status", value: "stable" },
      { key: "see-also", value: "[[concepts/typed-links]]" },
    ],
    body: `# Linked Markdown

Linked Markdown is the authoring format behind Wazoo Wiki: ordinary
Markdown files plus an open-schema frontmatter block that carries
semantic identifiers.

## Wikilinks

Pages reference each other with wikilinks like [[concepts/typed-links]]
and [[tools/wiki-cli]]. Links are typed at the vocabulary level, which
makes the wiki a graph rather than a tree.

## SPARQL blocks

Fenced blocks tagged \`sparql\` are rendered by the toolchain:

\`\`\`sparql
SELECT ?page WHERE { ?page a wiki:Concept }
\`\`\`

The desktop app surfaces staleness from \`wiki render --check\` inline.
`,
    backlinks: [
      {
        from: "index",
        text: "Linked Markdown",
        context: "The wiki format is Linked Markdown end to end.",
      },
      {
        from: "tools/wiki-cli",
        text: "linked markdown",
        context: "The CLI validates Linked Markdown frontmatter on every check.",
      },
    ],
    diagnostics: [
      { severity: "warning", message: "render: SPARQL block is stale (run wiki render)" },
    ],
  },
  "concepts/typed-links": {
    route: "concepts/typed-links",
    frontmatter: [
      { key: "@context", value: "https://wazoo.dev/wiki/v1" },
      { key: "@id", value: "wiki:concepts/typed-links" },
      { key: "@type", value: "wiki:Concept" },
      { key: "status", value: "draft" },
    ],
    body: `# Typed Links

A typed link carries a relationship, not just a target:

- \`[[concepts/linked-markdown|implements]]\`
- \`[[people/ada-lovelace|inspired-by]]\`

Typed links power the backlinks panel and the M2 graph surface.
`,
    backlinks: [
      {
        from: "concepts/linked-markdown",
        text: "Typed Links",
        context: "Links are typed at the vocabulary level.",
      },
    ],
    diagnostics: [],
  },
  "people/ada-lovelace": {
    route: "people/ada-lovelace",
    frontmatter: [
      { key: "@context", value: "https://wazoo.dev/wiki/v1" },
      { key: "@id", value: "wiki:people/ada-lovelace" },
      { key: "@type", value: "wiki:Person" },
      { key: "born", value: "1815-12-10" },
    ],
    body: `# Ada Lovelace

First programmer. Wrote the notes that outgrew the paper they annotated.

See also [[concepts/typed-links]].
`,
    backlinks: [],
    diagnostics: [],
  },
  "people/grace-hopper": {
    route: "people/grace-hopper",
    frontmatter: [
      { key: "@context", value: "https://wazoo.dev/wiki/v1" },
      { key: "@id", value: "wiki:people/grace-hopper" },
      { key: "@type", value: "wiki:Person" },
      { key: "born", value: "1906-12-09" },
    ],
    body: `# Grace Hopper

Compiler pioneer. "It's easier to ask forgiveness than permission."
`,
    backlinks: [],
    diagnostics: [],
  },
  index: {
    route: "index",
    frontmatter: [
      { key: "@context", value: "https://wazoo.dev/wiki/v1" },
      { key: "@id", value: "wiki:index" },
      { key: "@type", value: "wiki:Page" },
    ],
    body: `# Home

Welcome to the **Wazoo Wiki** desktop workspace.

- Start at [[concepts/linked-markdown]]
- Meet the people: [[people/ada-lovelace]], [[people/grace-hopper]]
- Tools: [[tools/wiki-cli]], [[tools/wiki-mcp]]

The wiki format is Linked Markdown end to end.
`,
    backlinks: [],
    diagnostics: [],
  },
  "tools/wiki-cli": {
    route: "tools/wiki-cli",
    frontmatter: [
      { key: "@context", value: "https://wazoo.dev/wiki/v1" },
      { key: "@id", value: "wiki:tools/wiki-cli" },
      { key: "@type", value: "wiki:Tool" },
    ],
    body: `# wiki CLI

The CLI is the source of truth: \`check\`, \`lint\`, \`fmt\`, \`render\`,
\`link\`, \`query\`. The desktop app is a frontend driving it.

The CLI validates linked markdown frontmatter on every check.
`,
    backlinks: [],
    diagnostics: [],
  },
  "tools/wiki-mcp": {
    route: "tools/wiki-mcp",
    frontmatter: [
      { key: "@context", value: "https://wazoo.dev/wiki/v1" },
      { key: "@id", value: "wiki:tools/wiki-mcp" },
      { key: "@type", value: "wiki:Tool" },
    ],
    body: `# wiki MCP

Ships with the app. External harnesses chat with a wiki over a
read-only stdio endpoint — no CLI install required.
`,
    backlinks: [],
    diagnostics: [],
  },
  "concepts/okf": {
    route: "concepts/okf",
    frontmatter: [
      { key: "@context", value: "https://wazoo.dev/wiki/v1" },
      { key: "@id", value: "wiki:concepts/okf" },
      { key: "@type", value: "wiki:Concept" },
      { key: "status", value: "future" },
    ],
    body: `# OKF Trust Stamps

Planned for M3: consumer of wiki#268. Trust metadata rendered inline.
`,
    backlinks: [],
    diagnostics: [],
  },
};

/** Resolve a doc; synthesize a stub for anything not in the mock set. */
export function getDoc(route: string): WikiDoc {
  return (
    docs[route] ?? {
      route,
      frontmatter: [
        { key: "@context", value: "https://wazoo.dev/wiki/v1" },
        { key: "@id", value: `wiki:${route}` },
      ],
      body: `# ${route}\n\nThis page has no mock content yet.\n`,
      backlinks: [],
      diagnostics: [],
    }
  );
}
