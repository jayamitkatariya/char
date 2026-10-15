"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Folder, Note } from "@/lib/types";
import { IconFolder, IconNote, IconPlus, IconSearch, IconSettings, IconSparkle } from "../icons";
import { plainText } from "./Markdown";
import type { View } from "./Sidebar";

type Item = { key: string; icon: React.ReactNode; title: string; sub?: string; run: () => void };

type Props = {
  notes: Note[];
  folders: Folder[];
  folderPath: (id: string) => string;
  onClose: () => void;
  onNavigate: (v: View) => void;
  onNewNote: (title?: string) => void;
  onNewFolder: () => void;
  onAsk: (question: string) => void;
  onSettings: () => void;
};

function snippet(text: string, q: string) {
  const plain = plainText(text);
  const at = plain.toLowerCase().indexOf(q);
  if (at < 0) return plain.slice(0, 90);
  const start = Math.max(0, at - 30);
  return (start > 0 ? "…" : "") + plain.slice(start, at + q.length + 60);
}

export function CommandPalette(p: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();

  const items = useMemo<Item[]>(() => {
    const close = (fn: () => void) => () => {
      p.onClose();
      fn();
    };
    const noteHits = p.notes
      .map((n) => {
        const t = (n.title || "Untitled").toLowerCase();
        const c = n.content.toLowerCase();
        const score = !q ? Date.parse(n.updatedAt) / 1e13 : t.startsWith(q) ? 3 : t.includes(q) ? 2 : c.includes(q) ? 1 : 0;
        return { n, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.n.updatedAt.localeCompare(a.n.updatedAt))
      .slice(0, q ? 12 : 6)
      .map<Item>(({ n }) => ({
        key: n.id,
        icon: <IconNote size={15} />,
        title: n.title || "Untitled",
        sub: q ? snippet(n.content, q) : p.folderPath(n.folderId),
        run: close(() => p.onNavigate({ kind: "note", id: n.id })),
      }));
    const folderHits = p.folders
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .slice(0, q ? 6 : 4)
      .map<Item>((f) => ({
        key: f.id,
        icon: <IconFolder size={15} />,
        title: f.name,
        sub: p.folderPath(f.id),
        run: close(() => p.onNavigate({ kind: "folder", id: f.id })),
      }));
    const actions: Item[] = [
      {
        key: "new",
        icon: <IconPlus size={15} />,
        title: q ? `New note “${query.trim()}”` : "New note",
        run: close(() => p.onNewNote(query.trim() || undefined)),
      },
      ...(q
        ? [{ key: "ask", icon: <IconSparkle size={15} />, title: `Ask char: “${query.trim()}”`, run: close(() => p.onAsk(query.trim())) }]
        : []),
      { key: "folder", icon: <IconFolder size={15} />, title: "New folder", run: close(p.onNewFolder) },
      { key: "settings", icon: <IconSettings size={15} />, title: "Settings & AI key", run: close(p.onSettings) },
    ];
    return [...noteHits, ...folderHits, ...actions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query, p.notes, p.folders]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(43,38,32,0.18)] px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={p.onClose}>
      <div className="card pop-in w-full max-w-[600px] overflow-hidden !rounded-2xl !shadow-[var(--shadow-lg)]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="hairline-b flex items-center gap-3 px-4">
          <IconSearch size={17} />
          <input
            autoFocus
            className="field py-4 text-[16px]"
            placeholder="Search notes, folders, or ask char…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                items[active]?.run();
              } else if (e.key === "Escape") p.onClose();
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div ref={listRef} className="scroll-soft max-h-[50vh] overflow-y-auto p-1.5">
          {items.map((it, i) => (
            <button
              key={it.key}
              data-i={i}
              className="row flex w-full items-start gap-3 px-3 py-2 text-left"
              data-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={it.run}
            >
              <span className="mt-0.5 text-[var(--ink-soft)]">{it.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">{it.title}</span>
                {it.sub && <span className="block truncate text-[12px] text-[var(--ink-faint)]">{it.sub}</span>}
              </span>
              {i === active && <span className="kbd mt-0.5">↵</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
