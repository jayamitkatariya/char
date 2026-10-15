"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Folder, Note } from "@/lib/types";
import {
  IconChevron,
  IconFolder,
  IconMore,
  IconNote,
  IconPin,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconSparkle,
  IconSun,
} from "../icons";

export type View = { kind: "home" } | { kind: "all" } | { kind: "pinned" } | { kind: "folder"; id: string } | { kind: "note"; id: string };

type Props = {
  folders: Folder[];
  notes: Note[];
  view: View;
  activeFolderId: string | null;
  username: string | null;
  aiReady: boolean;
  onNavigate: (v: View) => void;
  onNewNote: (folderId?: string) => void;
  onNewFolder: (parentId: string | null) => Promise<Folder>;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveNote: (noteId: string, folderId: string) => void;
  onMoveFolder: (folderId: string, parentId: string | null) => void;
  onSearch: () => void;
  onAsk: () => void;
  onSettings: () => void;
  onCollapse: () => void;
};

const EXPANDED_KEY = "char:expanded";
const DRAG_NOTE = "application/x-char-note";
const DRAG_FOLDER = "application/x-char-folder";

export function Sidebar(props: Props) {
  const { folders, notes, view, activeFolderId, onNavigate } = props;
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const persist = (next: Set<string>) => {
    setExpanded(next);
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {}
  };
  const toggle = (id: string, open?: boolean) => {
    const next = new Set(expanded);
    if (open ?? !next.has(id)) next.add(id);
    else next.delete(id);
    persist(next);
  };

  // Opening a note reveals its folder and the folders above it.
  const parentOf = useMemo(() => new Map(folders.map((f) => [f.id, f.parentId])), [folders]);
  useEffect(() => {
    if (!activeFolderId) return;
    const chain: string[] = [];
    let cur: string | null | undefined = activeFolderId;
    while (cur) {
      chain.push(cur);
      cur = parentOf.get(cur);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows navigation that can come from anywhere (links, ⌘K, chat)
    if (chain.some((id) => !expanded.has(id))) persist(new Set([...expanded, ...chain]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolderId, parentOf]);

  const childFolders = useMemo(() => {
    const m = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const key = f.parentId && parentOf.has(f.parentId) ? f.parentId : null;
      m.set(key, [...(m.get(key) ?? []), f]);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [folders, parentOf]);

  const notesIn = useMemo(() => {
    const m = new Map<string, Note[]>();
    for (const n of notes) m.set(n.folderId, [...(m.get(n.folderId) ?? []), n]);
    // Newest first, but stable while typing (createdAt, not updatedAt).
    for (const list of m.values()) list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return m;
  }, [notes]);

  const isDescendant = (id: string, maybeAncestor: string) => {
    let cur: string | null | undefined = id;
    while (cur) {
      if (cur === maybeAncestor) return true;
      cur = parentOf.get(cur);
    }
    return false;
  };

  const dropProps = (folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_NOTE) && !e.dataTransfer.types.includes(DRAG_FOLDER)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTarget(folderId ?? "__root");
    },
    onDragLeave: () => setDropTarget((t) => (t === (folderId ?? "__root") ? null : t)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const noteId = e.dataTransfer.getData(DRAG_NOTE);
      const draggedFolder = e.dataTransfer.getData(DRAG_FOLDER);
      if (noteId && folderId) {
        props.onMoveNote(noteId, folderId);
        toggle(folderId, true);
      } else if (draggedFolder && draggedFolder !== folderId && !(folderId && isDescendant(folderId, draggedFolder))) {
        props.onMoveFolder(draggedFolder, folderId);
      }
    },
  });

  const newFolder = async (parentId: string | null) => {
    const f = await props.onNewFolder(parentId);
    if (parentId) toggle(parentId, true);
    setRenaming(f.id);
  };

  const pinned = notes.filter((n) => n.pinned).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const renderNote = (n: Note, depth: number) => {
    const selected = view.kind === "note" && view.id === n.id;
    return (
      <li key={n.id}>
        <button
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_NOTE, n.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          className="row flex w-full items-center gap-2 py-[5px] pr-2 text-left text-[13.5px]"
          style={{ paddingLeft: 8 + depth * 14 + 18 }}
          data-selected={selected}
          onClick={() => onNavigate({ kind: "note", id: n.id })}
        >
          <span className="shrink-0 text-[var(--ink-faint)]">
            <IconNote size={14} />
          </span>
          <span className={`truncate ${selected ? "font-medium text-[var(--ink)]" : "text-[var(--ink-soft)]"}`}>
            {n.title.trim() || "Untitled"}
          </span>
        </button>
      </li>
    );
  };

  const renderFolder = (f: Folder, depth: number): React.ReactNode => {
    const open = expanded.has(f.id);
    const kids = childFolders.get(f.id) ?? [];
    const own = notesIn.get(f.id) ?? [];
    const selected = view.kind === "folder" && view.id === f.id;
    return (
      <li key={f.id}>
        <div
          {...dropProps(f.id)}
          className={`row group relative flex items-center gap-1 pr-1 ${dropTarget === f.id ? "!bg-[var(--highlight)]" : ""}`}
          style={{ paddingLeft: 4 + depth * 14 }}
          data-selected={selected}
          draggable={renaming !== f.id}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_FOLDER, f.id);
            e.dataTransfer.effectAllowed = "move";
          }}
        >
          <button className="icon-btn !h-6 !w-6 text-[var(--ink-faint)]" onClick={() => toggle(f.id)} aria-label={open ? "Collapse" : "Expand"}>
            <IconChevron size={12} open={open} />
          </button>
          {renaming === f.id ? (
            <RenameInput
              initial={f.name}
              onDone={(name) => {
                setRenaming(null);
                if (name && name !== f.name) props.onRenameFolder(f.id, name);
              }}
            />
          ) : (
            <button
              className="flex min-w-0 flex-1 items-center gap-2 py-[5px] text-left text-[13.5px]"
              onClick={() => onNavigate({ kind: "folder", id: f.id })}
              onDoubleClick={() => setRenaming(f.id)}
            >
              <span className="shrink-0 text-[var(--ink-soft)]">
                <IconFolder size={15} />
              </span>
              <span className={`truncate ${selected ? "font-medium" : ""}`}>{f.name}</span>
              <span className="ml-auto pr-1 font-mono text-[10.5px] text-[var(--ink-faint)] group-hover:hidden">{own.length || ""}</span>
            </button>
          )}
          <div className="hidden items-center group-hover:flex">
            <button className="icon-btn !h-6 !w-6" title="New note here" onClick={() => props.onNewNote(f.id)}>
              <IconPlus size={13} />
            </button>
            <button className="icon-btn !h-6 !w-6" title="More" onClick={() => setMenu(menu === f.id ? null : f.id)}>
              <IconMore size={13} />
            </button>
          </div>
          {menu === f.id && (
            <Menu onClose={() => setMenu(null)}>
              <MenuItem onClick={() => newFolder(f.id)}>New subfolder</MenuItem>
              <MenuItem onClick={() => setRenaming(f.id)}>Rename</MenuItem>
              {f.parentId && <MenuItem onClick={() => props.onMoveFolder(f.id, null)}>Move to top level</MenuItem>}
              <MenuItem
                danger
                onClick={() => {
                  const count = own.length;
                  if (window.confirm(`Delete “${f.name}”${count ? `, its subfolders and ${count} note${count === 1 ? "" : "s"}` : " and its subfolders"}?`))
                    props.onDeleteFolder(f.id);
                }}
              >
                Delete folder
              </MenuItem>
            </Menu>
          )}
        </div>
        {open && (
          <ul>
            {kids.map((k) => renderFolder(k, depth + 1))}
            {own.map((n) => renderNote(n, depth))}
            {!kids.length && !own.length && (
              <li className="py-1 text-[12.5px] italic text-[var(--ink-faint)]" style={{ paddingLeft: 8 + depth * 14 + 18 }}>
                Empty
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const nav = (label: string, v: View, icon: React.ReactNode, extra?: React.ReactNode) => (
    <button
      className="row flex w-full items-center gap-2.5 px-2 py-[6px] text-left text-[13.5px]"
      data-selected={view.kind === v.kind && (view.kind !== "folder" && view.kind !== "note")}
      onClick={() => onNavigate(v)}
    >
      <span className="text-[var(--ink-soft)]">{icon}</span>
      <span className="flex-1">{label}</span>
      {extra}
    </button>
  );

  return (
    <aside className="flex h-full w-full flex-col bg-[var(--paper-2)]">
      {/* pt-11 leaves room for the window's traffic lights above the logo */}
      <div className="drag flex items-center justify-between px-4 pb-2 pt-11">
        <button className="logo text-[20px] transition-opacity hover:opacity-70" title="Today" onClick={() => onNavigate({ kind: "home" })}>
          {"{char}"}
        </button>
        <button className="icon-btn" onClick={props.onCollapse} title="Hide sidebar (⌘\)" aria-label="Hide sidebar">
          <IconSidebar size={16} />
        </button>
      </div>

      <div className="space-y-0.5 px-2 pb-2">
        <button className="row flex w-full items-center gap-2.5 px-2 py-[6px] text-left text-[13.5px] text-[var(--ink-soft)]" onClick={props.onSearch}>
          <IconSearch size={15} />
          <span className="flex-1">Search</span>
          <span className="kbd">⌘K</span>
        </button>
        <button className="row flex w-full items-center gap-2.5 px-2 py-[6px] text-left text-[13.5px] text-[var(--ink-soft)]" onClick={props.onAsk}>
          <span className="text-[var(--sun)]">
            <IconSparkle size={15} />
          </span>
          <span className="flex-1">Ask char</span>
          {props.aiReady ? <span className="kbd">⌘J</span> : <span className="label">byok</span>}
        </button>
        <button className="row flex w-full items-center gap-2.5 px-2 py-[6px] text-left text-[13.5px] text-[var(--ink-soft)]" onClick={() => props.onNewNote()}>
          <IconPlus size={15} />
          <span className="flex-1">New note</span>
          <span className="kbd">⌘N</span>
        </button>
      </div>

      <nav className="scroll-soft flex-1 overflow-y-auto px-2 pb-4">
        <div className="space-y-0.5">
          {nav("Today", { kind: "home" }, <IconSun size={15} />)}
          {nav("All notes", { kind: "all" }, <IconNote size={15} />, <span className="font-mono text-[10.5px] text-[var(--ink-faint)]">{notes.length}</span>)}
        </div>

        {pinned.length > 0 && (
          <>
            <div className="label mt-5 flex items-center gap-1.5 px-2 pb-1">
              <IconPin size={11} /> pinned
            </div>
            <ul>
              {pinned.map((n) => (
                <li key={n.id}>
                  <button
                    className="row flex w-full items-center gap-2 px-2 py-[5px] text-left text-[13.5px]"
                    data-selected={view.kind === "note" && view.id === n.id}
                    onClick={() => onNavigate({ kind: "note", id: n.id })}
                  >
                    <span className="text-[var(--ink-faint)]">
                      <IconNote size={14} />
                    </span>
                    <span className="truncate text-[var(--ink-soft)]">{n.title.trim() || "Untitled"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <div
          {...dropProps(null)}
          className={`label mt-5 flex items-center justify-between rounded-md px-2 pb-1 ${dropTarget === "__root" ? "bg-[var(--highlight)]" : ""}`}
        >
          <span>folders</span>
          <button className="icon-btn !h-5 !w-5" title="New folder" onClick={() => newFolder(null)}>
            <IconPlus size={12} />
          </button>
        </div>
        <ul>{(childFolders.get(null) ?? []).map((f) => renderFolder(f, 0))}</ul>
        {folders.length === 0 && <p className="px-2 py-2 text-[12.5px] text-[var(--ink-faint)]">No folders yet.</p>}
        <p className="label mt-4 px-2 leading-relaxed opacity-70">drag notes onto folders to move them</p>
      </nav>

      <div className="hairline-t flex items-center gap-2 px-3 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] font-mono text-[12px] font-bold uppercase text-white">
          {(props.username ?? "?").slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{props.username}</span>
        <button className="icon-btn" title="Settings" onClick={props.onSettings}>
          <IconSettings size={15} />
        </button>
      </div>
    </aside>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (v: string) => {
    if (done.current) return;
    done.current = true;
    onDone(v.trim());
  };
  return (
    <input
      autoFocus
      className="input !my-0.5 !rounded-md !px-2 !py-1 !text-[13.5px]"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") finish(initial);
      }}
    />
  );
}

export function Menu({ children, onClose, align = "right" }: { children: React.ReactNode; onClose: () => void; align?: "left" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className={`card pop-in absolute top-full z-40 mt-1 min-w-[180px] p-1 ${align === "right" ? "right-0" : "left-0"}`}
      onClick={(e) => {
        e.stopPropagation();
        // Picking an item closes the menu.
        if ((e.target as HTMLElement).closest("button")) onClose();
      }}
    >
      {children}
    </div>
  );
}

export function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      className={`row block w-full px-3 py-1.5 text-left text-[13px] ${danger ? "text-[var(--danger)]" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
