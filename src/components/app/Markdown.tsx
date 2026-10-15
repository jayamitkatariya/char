"use client";

import { Fragment, type ReactNode } from "react";

// A small, safe markdown renderer for chat answers: no HTML injection, just React nodes.
// [[Note Title]] becomes a clickable link into the notepad.

type Props = { text: string; onNoteLink?: (title: string) => void };

export function Markdown({ text, onNoteLink }: Props) {
  return <div className="prose-chat">{renderBlocks(text, onNoteLink)}</div>;
}

function renderBlocks(src: string, onNoteLink?: (t: string) => void): ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const inl = (s: string) => renderInline(s, onNoteLink);

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line.trim())) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) body.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const Tag = h[1].length <= 2 ? "h3" : "h4";
      out.push(<Tag key={key++}>{inl(h[2])}</Tag>);
      i++;
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, "");
        const task = raw.match(/^\[( |x|X)\]\s+(.*)$/);
        items.push(
          <li key={items.length} className={task ? "-ml-4 list-none" : undefined}>
            {task ? (
              <span className="inline-flex items-start gap-2">
                <input type="checkbox" readOnly checked={task[1] !== " "} className="mt-[5px] accent-[var(--accent)]" />
                <span className={task[1] !== " " ? "text-[var(--ink-faint)] line-through" : undefined}>{inl(task[2])}</span>
              </span>
            ) : (
              inl(raw)
            )}
          </li>,
        );
        i++;
      }
      out.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
    out.push(
      <p key={key++}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inl(p)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return out;
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function renderInline(s: string, onNoteLink?: (t: string) => void): ReactNode[] {
  const parts = s.split(INLINE);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (/^(\*\*|__).+(\*\*|__)$/.test(part)) return <strong key={i}>{renderInline(part.slice(2, -2), onNoteLink)}</strong>;
    if (part.startsWith("[[") && part.endsWith("]]")) {
      const title = part.slice(2, -2);
      return (
        <button key={i} type="button" className="note-link mx-px align-baseline text-[13px]" onClick={() => onNoteLink?.(title)}>
          {title}
        </button>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const href = link[2];
      const internal = href.startsWith("/notes?");
      if (!internal && !/^https?:\/\//.test(href)) return <span key={i}>{link[1]}</span>;
      return (
        <a key={i} href={href} target={internal ? undefined : "_blank"} rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    if (/^(\*|_)[^*_].*(\*|_)$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Strip markdown to plain text for previews. */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)]|>)\s+/gm, "")
    .replace(/\[( |x|X)\]\s+/g, "")
    .replace(/[*_`~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
