"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Folder, Note } from "@/lib/types";
import { IconFolder, IconMove, IconNote, IconPlus } from "../icons";
import { fuzzy, Highlight } from "./fuzzy";

type Props = {
  note: Note;
  folders: Folder[];
  /** Pages it may go inside (not itself, its own subpages, or where it already is). */
  pages: Note[];
  isTopLevel: boolean;
  folderPath: (id: string) => string;
  notePath: (n: Note) => string;
  onPickFolder: (folderId: string) => void;
  onPickPage: (pageId: string) => void;
  /** Makes a top-level folder with this name and moves the note into it. */
  onCreate: (name: string) => void;
  onClose: () => void;
};

type Row = { key: string; group: string; title: string; hits?: number[]; sub?: string; icon: React.ReactNode; run: () => void };

// "Move to…": type part of a folder's or page's name, then Enter.
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
    const rank = <T,>(list: T[], name: (x: T) => string, path: (x: T) => string) =>
      list
        .map((x) => {
          const m = fuzzy(name(x), q);
          const byPath = m ? null : fuzzy(path(x), q);
          return { x, m, score: !q ? 0 : (m?.score ?? 0) + (byPath ? byPath.score / 2 : 0) };
        })
        .filter((r) => !q || r.score > 0);

    const folders = rank(
      // Its own folder is a destination only for a subpage (to bring it back to the top level).
      p.folders.filter((f) => f.id !== p.note.folderId || !p.isTopLevel),
      (f) => f.name,
      (f) => p.folderPath(f.id),
    )
      .sort((a, b) => b.score - a.score || p.folderPath(a.x.id).localeCompare(p.folderPath(b.x.id)))
      .map<Row>(({ x: f, m }) => {
        const path = p.folderPath(f.id);
        return {
          key: f.id,
          group: "Folders",
          title: f.name,
          hits: m?.hits,
          sub: path === f.name ? undefined : path,
          icon: <IconFolder size={15} />,
          run: done(() => p.onPickFolder(f.id)),
        };
      });
    const pages = rank(p.pages, (n) => n.title.trim() || "Untitled", p.notePath)
      .sort((a, b) => b.score - a.score || b.x.updatedAt.localeCompare(a.x.updatedAt))
      .slice(0, q ? 20 : 8)
      .map<Row>(({ x: n, m }) => ({
        key: n.id,
        group: "Inside a page",
        title: n.title.trim() || "Untitled",
        hits: m?.hits,
        sub: p.notePath(n),
        icon: <IconNote size={15} />,
        run: done(() => p.onPickPage(n.id)),
      }));
    const out = [...folders, ...pages];
    const exact = p.folders.some((f) => f.name.trim().toLowerCase() === q);
    if (q && !exact)
      out.push({ key: "__new", group: "Create", title: `New folder “${query.trim()}”`, icon: <IconPlus size={15} />, run: done(() => p.onCreate(query.trim())) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query, p.folders, p.pages, p.note, p.isTopLevel]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="scrim fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]" onMouseDown={p.onClose}>
      <div className="card pop-in w-full max-w-[480px] overflow-hidden !rounded-2xl !shadow-[var(--shadow-lg)]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="label hairline-b flex items-center gap-1.5 px-4 pb-2 pt-3">
          <IconMove size={11} /> move <span className="truncate normal-case">“{p.note.title.trim() || "Untitled"}”</span> to
        </div>
        <div className="hairline-b flex items-center gap-3 px-4">
          <IconFolder size={16} />
          <input
            autoFocus
            className="field py-3 text-[15px]"
            placeholder="Find a folder or page…"
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
          {rows.length === 0 && <p className="px-3 py-3 text-[13px] text-[var(--ink-faint)]">Nowhere else to put it yet. Type a name to make a folder.</p>}
          {rows.map((r, i) => (
            <div key={r.key}>
              {r.group !== rows[i - 1]?.group && <div className={`label px-3 pb-1 ${i ? "pt-3" : "pt-1.5"}`}>{r.group}</div>}
              <button
                data-i={i}
                className="row flex w-full items-center gap-3 px-3 py-2 text-left"
                data-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={r.run}
              >
                <span className="text-[var(--ink-soft)]">{r.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">
                    <Highlight text={r.title} hits={r.hits} />
                  </span>
                  {r.sub && <span className="block truncate text-[12px] text-[var(--ink-faint)]">{r.sub}</span>}
                </span>
                {i === active && <span className="kbd">↵</span>}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
