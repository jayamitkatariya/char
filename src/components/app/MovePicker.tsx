"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Folder } from "@/lib/types";
import { IconFolder, IconMove, IconPlus } from "../icons";
import { fuzzy, Highlight } from "./fuzzy";

type Props = {
  noteTitle: string;
  folders: Folder[];
  currentFolderId: string;
  folderPath: (id: string) => string;
  onPick: (folderId: string) => void;
  /** Makes a top-level folder with this name and moves the note into it. */
  onCreate: (name: string) => void;
  onClose: () => void;
};

type Row = { key: string; title: string; hits?: number[]; sub?: string; create?: boolean; run: () => void };

// "Move to…": type part of a folder's name or path, then Enter.
export function MovePicker(p: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();

  const rows = useMemo<Row[]>(() => {
    const done = (fn: () => void) => () => {
      p.onClose();
      fn();
    };
    const hits = p.folders
      .filter((f) => f.id !== p.currentFolderId)
      .map((f) => {
        const path = p.folderPath(f.id);
        const byName = fuzzy(f.name, q);
        const byPath = byName ? null : fuzzy(path, q);
        return { f, path, byName, score: !q ? 0 : (byName?.score ?? 0) + (byPath ? byPath.score / 2 : 0) };
      })
      .filter((x) => !q || x.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .map<Row>(({ f, path, byName }) => ({
        key: f.id,
        title: f.name,
        hits: byName?.hits,
        sub: path === f.name ? undefined : path,
        run: done(() => p.onPick(f.id)),
      }));
    const exact = p.folders.some((f) => f.name.trim().toLowerCase() === q);
    if (q && !exact) hits.push({ key: "__new", title: `New folder “${query.trim()}”`, create: true, run: done(() => p.onCreate(query.trim())) });
    return hits;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query, p.folders, p.currentFolderId]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(43,38,32,0.18)] px-4 pt-[14vh] backdrop-blur-[2px]" onMouseDown={p.onClose}>
      <div className="card pop-in w-full max-w-[480px] overflow-hidden !rounded-2xl !shadow-[var(--shadow-lg)]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="label hairline-b flex items-center gap-1.5 px-4 pb-2 pt-3">
          <IconMove size={11} /> move <span className="truncate normal-case">“{p.noteTitle.trim() || "Untitled"}”</span> to
        </div>
        <div className="hairline-b flex items-center gap-3 px-4">
          <IconFolder size={16} />
          <input
            autoFocus
            className="field py-3 text-[15px]"
            placeholder="Find a folder…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(rows.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                rows[active]?.run();
              } else if (e.key === "Escape") p.onClose();
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div ref={listRef} className="scroll-soft max-h-[46vh] overflow-y-auto p-1.5">
          {rows.length === 0 && <p className="px-3 py-3 text-[13px] text-[var(--ink-faint)]">No other folders yet. Type a name to make one.</p>}
          {rows.map((r, i) => (
            <button
              key={r.key}
              data-i={i}
              className="row flex w-full items-center gap-3 px-3 py-2 text-left"
              data-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={r.run}
            >
              <span className="text-[var(--ink-soft)]">{r.create ? <IconPlus size={15} /> : <IconFolder size={15} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">
                  <Highlight text={r.title} hits={r.hits} />
                </span>
                {r.sub && <span className="block truncate text-[12px] text-[var(--ink-faint)]">{r.sub}</span>}
              </span>
              {i === active && <span className="kbd">↵</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
