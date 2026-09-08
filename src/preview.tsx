import { Fragment, type ReactNode } from "react";

/** Tiny markdown renderer for the mock preview pane.
 *  Handles headings, paragraphs, code fences, lists, inline code,
 *  bold/italic and wikilinks. Real rendering comes from the toolchain later. */

function renderInline(text: string, onOpenLink: (route: string) => void): ReactNode {
  const parts: ReactNode[] = [];
  // Split on wikilinks [[target|label]], inline `code`, **bold**, *italic*
  const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const target = m[1].trim();
      const label = m[2]?.trim() ?? target;
      parts.push(
        <span
          key={key++}
          className="wikilink"
          title={target}
          onClick={() => onOpenLink(target)}
        >
          {label}
        </span>,
      );
    } else if (m[3] !== undefined) {
      parts.push(<code key={key++}>{m[3]}</code>);
    } else if (m[4] !== undefined) {
      parts.push(<strong key={key++}>{m[4]}</strong>);
    } else if (m[5] !== undefined) {
      parts.push(<em key={key++}>{m[5]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment key={`inline-${key}`}>{parts}</Fragment>;
}

export function renderMarkdown(src: string, onOpenLink: (route: string) => void): ReactNode {
  const lines = src.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      out.push(
        <pre key={key++}>
          <code data-lang={lang}>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2], onOpenLink);
      out.push(
        level === 1 ? (
          <h1 key={key++}>{content}</h1>
        ) : level === 2 ? (
          <h2 key={key++}>{content}</h2>
        ) : (
          <h3 key={key++}>{content}</h3>
        ),
      );
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push(
        <ul key={key++}>
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, onOpenLink)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("```") && !/^#{1,3}\s/.test(lines[i]) && !/^[-*]\s/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push(<p key={key++}>{renderInline(para.join(" "), onOpenLink)}</p>);
  }
  return <Fragment key={`md-${key}`}>{out}</Fragment>;
}
