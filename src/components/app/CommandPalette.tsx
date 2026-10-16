"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Folder, Note } from "@/lib/types";
import { agentLabel } from "@/lib/charlie";
import { isDesktop } from "@/lib/desktop";
import { IconClock, IconFolder, IconMonitor, IconMoon, IconMove, IconNote, IconPin, IconPlus, IconSearch, IconSettings, IconSparkle, IconSun, IconTerminal, IconTrash, IconWand } from "../icons";
import { setThemeMode, themeMode } from "@/lib/theme";
import { fuzzy, Highlight } from "./fuzzy";
import { plainText } from "./Markdown";
import type { View } from "./Sidebar";

type Group = "Recent" | "Pinned" | "Notes" | "Folders" | "Actions";
type Item = {
  key: string;
  group: Group;
  icon: React.ReactNode;
  title: string;
  hits?: number[];
  sub?: string;
  subHits?: number[];
  hint?: string;
  run: () => void;
};

type Props = {
  notes: Note[];
  folders: Folder[];
  folderPath: (id: string) => string;
  notePath: (n: Note) => string;
  onClose: () => void;
  onNavigate: (v: View) => void;
  onNewNote: (title?: string) => void;
  onNewFolder: () => void;
  onAsk: (question: string) => void;
  onSettings: () => void;
  onAgentSettings: () => void;
  /** The open note, if any: @charlie, Tidy, pin and move work on it. */
  current: { title: string; pinned: boolean } | null;
  onTogglePin: () => void;
  onMoveNote: () => void;
  onNewSubpage: () => void;
};

const RECENT = 8;

// A window of the note's text around the first hit, with the hit marked.
function snippet(text: string, q: string): { text: string; hits?: number[] } {
  const plain = plainText(text);
  const at = plain.toLowerCase().indexOf(q);
  if (at < 0) return { text: plain.slice(0, 90) };
  const start = Math.max(0, at - 30);
  const lead = start > 0 ? "…" : "";
  const from = lead.length + at - start;
  return { text: lead + plain.slice(start, at + q.length + 60), hits: Array.from({ length: q.length }, (_, i) => from + i) };
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
    const open = (n: Note) => close(() => p.onNavigate({ kind: "note", id: n.id }));
    const noteItem = (group: Group, n: Note, icon = <IconNote size={15} />): Item => ({
      key: `${group}-${n.id}`,
      group,
      icon,
      title: n.title.trim() || "Untitled",
      sub: p.notePath(n),
      run: open(n),
    });

    const has = p.current !== null && isDesktop();
    const actions: (Omit<Item, "group"> & { when?: boolean })[] = [
      { key: "new", icon: <IconPlus size={15} />, title: q ? `New note “${query.trim()}”` : "New note", hint: "⌘N", run: close(() => p.onNewNote(query.trim() || undefined)) },
      ...(q ? [{ key: "ask", icon: <IconSparkle size={15} />, title: `Ask char: “${query.trim()}”`, run: close(() => p.onAsk(query.trim())) }] : []),
      ...(has
        ? [
            {
              key: "charlie",
              icon: <IconTerminal size={15} />,
              title: q ? `@charlie: “${query.trim()}”` : "Ask charlie…",
              sub: q ? `Sends it to ${agentLabel()} from “${p.current!.title || "Untitled"}”` : `Type a task first; it goes to ${agentLabel()} from this note`,
              // Without a task this just puts the chip at the end of the note to type into.
              run: close(() => window.dispatchEvent(new CustomEvent("char:charlie", { detail: { task: query.trim() } }))),
            },
          ]
        : []),
    ];
    // Fixed commands: always listed when the box is empty, matched by name once you type.
    const commands: Omit<Item, "group">[] = [
      ...(p.current
        ? [
            { key: "tidy", icon: <IconWand size={15} />, title: "Tidy this note", sub: "Loose lines into to-dos and bullets", hint: "⌘⇧T", run: close(() => window.dispatchEvent(new Event("char:tidy"))) },
            { key: "subpage", icon: <IconPlus size={15} />, title: "New page inside this one", sub: "Or type /page in the note", run: close(p.onNewSubpage) },
            { key: "pin", icon: <IconPin size={15} />, title: p.current.pinned ? "Unpin this note" : "Pin this note", hint: "⌘⇧P", run: close(p.onTogglePin) },
            { key: "move", icon: <IconMove size={15} />, title: "Move this note…", run: close(p.onMoveNote) },
          ]
        : []),
      { key: "today", icon: <IconSun size={15} />, title: "Go to Today", hint: "⌘⇧H", run: close(() => p.onNavigate({ kind: "home" })) },
      { key: "all", icon: <IconNote size={15} />, title: "Go to All notes", run: close(() => p.onNavigate({ kind: "all" })) },
      { key: "pinned", icon: <IconPin size={15} />, title: "Go to Pinned", run: close(() => p.onNavigate({ kind: "pinned" })) },
      { key: "trash", icon: <IconTrash size={15} />, title: "Go to Trash", run: close(() => p.onNavigate({ kind: "trash" })) },
      { key: "folder", icon: <IconFolder size={15} />, title: "New folder", run: close(p.onNewFolder) },
      ...(
        [
          ["dark", "Dark mode", <IconMoon key="d" size={15} />],
          ["light", "Light mode", <IconSun key="l" size={15} />],
          ["system", "Appearance: match system", <IconMonitor key="s" size={15} />],
        ] as const
      )
        .filter(([m]) => m !== themeMode())
        .map(([m, title, icon]) => ({ key: `theme-${m}`, icon, title, sub: "Appearance", run: close(() => setThemeMode(m)) })),
      { key: "settings", icon: <IconSettings size={15} />, title: "Settings & AI key", hint: "⌘,", run: close(p.onSettings) },
      ...(isDesktop() ? [{ key: "agents", icon: <IconTerminal size={15} />, title: "charlie's agent settings", run: close(p.onAgentSettings) }] : []),
    ];

    if (!q) {
      const byEdit = [...p.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return [
        ...byEdit.filter((n) => !n.pinned).slice(0, RECENT).map((n) => noteItem("Recent", n, <IconClock size={15} />)),
        ...byEdit.filter((n) => n.pinned).slice(0, 6).map((n) => noteItem("Pinned", n, <IconPin size={15} />)),
        ...[...actions, ...commands].map((a) => ({ ...a, group: "Actions" as const })),
      ];
    }

    const noteHits = p.notes
      .map((n) => {
        const title = n.title.trim() || "Untitled";
        const t = fuzzy(title, q);
        if (t) return { n, score: t.score + 100, hits: t.hits, inBody: false };
        const path = p.notePath(n).toLowerCase();
        if (path.includes(q)) return { n, score: 40, inBody: false };
        if (n.content.toLowerCase().includes(q)) return { n, score: 20, inBody: true };
        return null;
      })
      .filter((x) => x !== null)
      .sort((a, b) => b.score - a.score || b.n.updatedAt.localeCompare(a.n.updatedAt))
      .slice(0, 12)
      .map<Item>(({ n, hits, inBody }) => {
        const s = inBody ? snippet(n.content, q) : null;
        return { ...noteItem("Notes", n), hits, sub: s ? s.text : p.notePath(n), subHits: s?.hits };
      });
    const folderHits = p.folders
      .map((f) => ({ f, m: fuzzy(f.name, q) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m!.score - a.m!.score)
      .slice(0, 6)
      .map<Item>(({ f, m }) => ({
        key: f.id,
        group: "Folders",
        icon: <IconFolder size={15} />,
        title: f.name,
        hits: m!.hits,
        sub: p.folderPath(f.id),
        run: close(() => p.onNavigate({ kind: "folder", id: f.id })),
      }));
    const commandHits = commands
      .map((c) => ({ c, m: fuzzy(c.title, q) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m!.score - a.m!.score)
      .map(({ c, m }) => ({ ...c, hits: m!.hits }));
    return [...noteHits, ...folderHits, ...[...commandHits, ...actions].map((a) => ({ ...a, group: "Actions" as const }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query, p.notes, p.folders, p.current]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="scrim fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" onMouseDown={p.onClose}>
      <div className="card pop-in w-full max-w-[600px] overflow-hidden !rounded-2xl !shadow-[var(--shadow-lg)]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="hairline-b flex items-center gap-3 px-4">
          <IconSearch size={17} />
          <input
            autoFocus
            className="field py-4 text-[16px]"
            placeholder="Search notes, folders, commands, or ask char…"
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
        <div ref={listRef} className="scroll-soft max-h-[56vh] overflow-y-auto p-1.5">
          {items.map((it, i) => (
            <div key={it.key}>
              {it.group !== items[i - 1]?.group && <div className={`label px-3 pb-1 ${i ? "pt-3" : "pt-1.5"}`}>{it.group}</div>}
              <button
                data-i={i}
                className="row flex w-full items-start gap-3 px-3 py-2 text-left"
                data-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={it.run}
              >
                <span className="mt-0.5 text-[var(--ink-soft)]">{it.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">
                    <Highlight text={it.title} hits={it.hits} />
                  </span>
                  {it.sub && (
                    <span className="block truncate text-[12px] text-[var(--ink-faint)]">
                      <Highlight text={it.sub} hits={it.subHits} />
                    </span>
                  )}
                </span>
                {i === active ? <span className="kbd mt-0.5">↵</span> : it.hint && <span className="kbd mt-0.5 opacity-70">{it.hint}</span>}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
