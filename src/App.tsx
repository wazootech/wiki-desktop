import { useMemo, useState } from "react";
import { getDoc, pageTree } from "./mockData";
import { renderMarkdown } from "./preview";
import type { WikiPage } from "./types";

function PageTreeItem({
  page,
  depth,
  activeRoute,
  onSelect,
}: {
  page: WikiPage;
  depth: number;
  activeRoute: string;
  onSelect: (route: string) => void;
}) {
  const hasChildren = !!page.children?.length;
  const [open, setOpen] = useState(depth < 1);
  const active = activeRoute === page.route;
  return (
    <li>
      <button
        className={active ? "active" : ""}
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() => {
          onSelect(page.route);
          if (hasChildren) setOpen(true);
        }}
      >
        <span className="caret">{hasChildren ? (open ? "▾" : "▸") : ""}</span>
        <span className="page-icon">{hasChildren ? "▤" : "□"}</span>
        {page.title}
      </button>
      {hasChildren && open && (
        <ul className="branch">
          {page.children!.map((child) => (
            <PageTreeItem
              key={child.route}
              page={child}
              depth={depth + 1}
              activeRoute={activeRoute}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function App() {
  const [route, setRoute] = useState("concepts/linked-markdown");
  const [source, setSource] = useState<string | null>(null);
  const [tab, setTab] = useState<"split" | "source" | "preview">("split");

  const doc = useMemo(() => getDoc(route), [route]);
  const text = source ?? doc.body;
  const errorCount = doc.diagnostics.filter((d) => d.severity === "error").length;
  const warnCount = doc.diagnostics.length - errorCount;

  const openLink = (target: string) => {
    setSource(null);
    setRoute(target);
  };

  return (
    <div className="app">
      <header className="titlebar">
        <span className="mark">W</span>
        <span className="name">
          Wazoo <em>Wiki</em>
        </span>
        <span className="spacer" />
        <span className="root-path">~/wikis/demo</span>
      </header>

      <div className="main">
        <nav className="sidebar">
          <div className="panel-title">Pages</div>
          <ul className="tree">
            {pageTree.map((page) => (
              <PageTreeItem
                key={page.route}
                page={page}
                depth={0}
                activeRoute={route}
                onSelect={(r) => {
                  setSource(null);
                  setRoute(r);
                }}
              />
            ))}
          </ul>
        </nav>

        <section className="editor-area">
          <div className="tabbar">
            {(["split", "source", "preview"] as const).map((t) => (
              <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div
            className="split"
            style={{
              gridTemplateColumns:
                tab === "source" ? "1fr 0" : tab === "preview" ? "0 1fr" : "1fr 1fr",
            }}
          >
            <div className="source-pane">
              <textarea
                value={text}
                onChange={(e) => setSource(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="preview-pane">{renderMarkdown(text, openLink)}</div>
          </div>
        </section>

        <aside className="rail">
          <div className="panel-title">Frontmatter</div>
          <table className="fm-table">
            <tbody>
              {doc.frontmatter.map((entry) => (
                <tr key={entry.key}>
                  <td className="key">{entry.key}</td>
                  <td className="val">{entry.value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="panel-title">Backlinks</div>
          {doc.backlinks.length === 0 ? (
            <div className="empty">No backlinks yet.</div>
          ) : (
            doc.backlinks.map((bl) => (
              <button key={bl.from} className="backlink" onClick={() => openLink(bl.from)}>
                {bl.text}
                <span className="ctx">{bl.context}</span>
              </button>
            ))
          )}

          <div className="panel-title">Diagnostics</div>
          {doc.diagnostics.length === 0 ? (
            <div className="empty">Clean.</div>
          ) : (
            <div style={{ padding: "4px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              {doc.diagnostics.map((d, i) => (
                <span key={i} className={`diagnostic ${d.severity}`}>
                  {d.severity === "error" ? "✖" : "▲"} {d.message}
                </span>
              ))}
            </div>
          )}
        </aside>
      </div>

      <footer className="statusbar">
        <span>
          {errorCount} errors · {warnCount} warnings
        </span>
        <span className={errorCount > 0 ? "warn" : "ok"}>
          {errorCount > 0 ? "check failed" : "check passed"}
        </span>
        <span className="spacer" />
        <span>Linked Markdown · mock bridge</span>
      </footer>
    </div>
  );
}
