"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { setThemeMode, useTheme } from "@/lib/theme";
import { NoteIcon } from "./NoteIcon";
import type { Folder, Note } from "@/lib/types";
import {
  IconChevron,
  IconClock,
  IconCollapse,
  IconCopy,
  IconFolder,
  IconLink,
  IconMonitor,
  IconMoon,
  IconMore,
  IconMove,
  IconNote,
  IconPin,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconSparkle,
  IconSun,
  IconTasks,
  IconTrash,
} from "../icons";

export type View =
  | { kind: "home" }
  | { kind: "all" }
  | { kind: "pinned" }
  | { kind: "trash" }
  | { kind: "tasks" }
  | { kind: "folder"; id: string }
  | { kind: "note"; id: string };

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
  onTogglePin: (noteId: string) => void;
  onDuplicate: (noteId: string) => void;
  onCopyLink: (noteId: string) => void;
  onPickFolder: (noteId: string) => void;
  onDeleteNote: (noteId: string) => void;
  onNewSubpage: (parentId: string) => void;
  onNestNote: (noteId: string, parentId: string) => void;
  trashCount: number;
  openTasks: number;
  onSearch: () => void;
  onAsk: () => void;
  onSettings: () => void;
  onCollapse: () => void;
};

const EXPANDED_KEY = "char:expanded";
const RECENT_KEY = "char:recent-closed";
const DRAG_NOTE = "application/x-char-note";
const DRAG_FOLDER = "application/x-char-folder";
const RECENT = 5;

type OpenMenu = { kind: "note" | "folder"; id: string; at: { x: number; y: number } };

const readSet = (key: string) => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(key) ?? "[]"));
  } catch {
    return new Set<string>();
  }
};

// Right-click opens the menu at the cursor; the ⋯ button opens it just below itself.
const menuAt = (e: React.MouseEvent) => {
  e.preventDefault(); // also keeps Electron's native menu away
  e.stopPropagation();
  if (e.type === "contextmenu") return { x: e.clientX, y: e.clientY };
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return { x: r.left, y: r.bottom + 4 };
};

export function Sidebar(props: Props) {
  const { folders, notes, view, activeFolderId, onNavigate } = props;
  const [expanded, setExpanded] = useState<Set<string>>(() => readSet(EXPANDED_KEY));
  const [recentOpen, setRecentOpen] = useState(() => !readSet(RECENT_KEY).has("recent"));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

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
  const toggleRecent = () => {
    setRecentOpen(!recentOpen);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recentOpen ? ["recent"] : []));
    } catch {}
  };

  // Opening a note reveals its folder, the folders above it, and the pages it sits inside.
  const parentOf = useMemo(() => new Map(folders.map((f) => [f.id, f.parentId])), [folders]);
  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const openNoteId = view.kind === "note" ? view.id : null;
  useEffect(() => {
    if (!activeFolderId) return;
    const chain: string[] = [];
    let cur: string | null | undefined = activeFolderId;
    while (cur && chain.length < 64) {
      chain.push(cur);
      cur = parentOf.get(cur);
    }
    let page = openNoteId ? noteById.get(openNoteId)?.parentId : null;
    while (page && noteById.has(page) && chain.length < 128) {
      chain.push(page);
      page = noteById.get(page)?.parentId;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows navigation that can come from anywhere (links, ⌘K, chat)
    if (chain.some((id) => !expanded.has(id))) persist(new Set([...expanded, ...chain]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolderId, parentOf, openNoteId, noteById]);

  const childFolders = useMemo(() => {
    const m = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const key = f.parentId && parentOf.has(f.parentId) ? f.parentId : null;
      m.set(key, [...(m.get(key) ?? []), f]);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [folders, parentOf]);

  // Pages directly in each folder (newest first, stable while typing), and each page's subpages
  // (oldest first, the order they were added in).
  const { notesIn, subpages } = useMemo(() => {
    const top = new Map<string, Note[]>();
    const kids = new Map<string, Note[]>();
    for (const n of notes) {
      if (n.parentId && noteById.has(n.parentId)) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
      else top.set(n.folderId, [...(top.get(n.folderId) ?? []), n]);
    }
    for (const list of top.values()) list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const list of kids.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { notesIn: top, subpages: kids };
  }, [notes, noteById]);

  const allIn = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) m.set(n.folderId, (m.get(n.folderId) ?? 0) + 1);
    return m;
  }, [notes]);

  const isUnder = (id: string, ancestor: string) => {
    let cur = noteById.get(id)?.parentId;
    for (let i = 0; cur && i < 128; i++) {
      if (cur === ancestor) return true;
      cur = noteById.get(cur)?.parentId;
    }
    return false;
  };

  // A folder's count includes the notes in its subfolders.
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    const count = (id: string, seen: Set<string>): number => {
      if (m.has(id)) return m.get(id)!;
      if (seen.has(id)) return 0;
      seen.add(id);
      const n = (allIn.get(id) ?? 0) + (childFolders.get(id) ?? []).reduce((s, k) => s + count(k.id, seen), 0);
      m.set(id, n);
      return n;
    };
    for (const f of folders) count(f.id, new Set());
    return m;
  }, [folders, allIn, childFolders]);

  const isDescendant = (id: string, maybeAncestor: string) => {
    let cur: string | null | undefined = id;
    while (cur) {
      if (cur === maybeAncestor) return true;
      cur = parentOf.get(cur);
    }
    return false;
  };

  const dragProps = (type: string, id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(type, id);
      e.dataTransfer.effectAllowed = "move";
      setDragging(true);
    },
    onDragEnd: () => {
      setDragging(false);
      setDropTarget(null);
    },
  });

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
      setDragging(false);
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
  const recent = useMemo(
    () => notes.filter((n) => !n.pinned).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, RECENT),
    [notes],
  );

  // Dropping a note on a page puts it inside that page.
  const noteDrop = (target: Note) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_NOTE)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setDropTarget(`n:${target.id}`);
    },
    onDragLeave: () => setDropTarget((t) => (t === `n:${target.id}` ? null : t)),
    onDrop: (e: React.DragEvent) => {
      const noteId = e.dataTransfer.getData(DRAG_NOTE);
      if (!noteId) return;
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      setDragging(false);
      if (noteId === target.id || isUnder(target.id, noteId) || noteById.get(noteId)?.parentId === target.id) return;
      props.onNestNote(noteId, target.id);
      toggle(target.id, true);
    },
  });

  /** A note row. In the folder tree (`nested`), a page with subpages can be opened to show them. */
  const renderNote = (n: Note, indent: number, keyPrefix = "", nested = false): React.ReactNode => {
    const selected = view.kind === "note" && view.id === n.id;
    const menuOpen = menu?.kind === "note" && menu.id === n.id;
    const kids = nested ? (subpages.get(n.id) ?? []) : [];
    const open = kids.length > 0 && expanded.has(n.id);
    return (
      <li key={keyPrefix + n.id}>
        <div
          {...dragProps(DRAG_NOTE, n.id)}
          {...noteDrop(n)}
          className={`row group flex items-center pr-1 ${dropTarget === `n:${n.id}` ? "!bg-[var(--highlight)]" : ""}`}
          data-selected={selected || menuOpen}
          onContextMenu={(e) => setMenu({ kind: "note", id: n.id, at: menuAt(e) })}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: indent }}>
            {kids.length > 0 ? (
              // The page icon turns into a chevron on hover, like Notion.
              <button
                className="group/tw relative flex h-[14px] w-[14px] shrink-0 items-center justify-center text-[var(--ink-faint)] hover:text-[var(--ink)]"
                onClick={() => toggle(n.id)}
                aria-label={open ? "Hide subpages" : "Show subpages"}
                aria-expanded={open}
              >
                <span className="group-hover:hidden">
                  <NoteIcon icon={n.icon} size={14} />
                </span>
                <span className="hidden group-hover:inline">
                  <IconChevron size={12} open={open} />
                </span>
              </button>
            ) : (
              <span className="shrink-0 text-[var(--ink-faint)]">
                <NoteIcon icon={n.icon} size={14} />
              </span>
            )}
            <button className="min-w-0 flex-1 truncate py-[5px] text-left text-[13.5px]" onClick={() => onNavigate({ kind: "note", id: n.id })}>
              <span className={selected ? "font-medium text-[var(--ink)]" : "text-[var(--ink-soft)]"}>{n.title.trim() || "Untitled"}</span>
            </button>
          </div>
          <span className={`shrink-0 items-center ${menuOpen ? "flex" : "hidden group-hover:flex"}`}>
            {nested && (
              <button className="icon-btn !h-6 !w-6" title="Add a page inside" aria-label="Add subpage" onClick={() => props.onNewSubpage(n.id)}>
                <IconPlus size={13} />
              </button>
            )}
            <button
              className="icon-btn !h-6 !w-6"
              title="More"
              aria-label="Note actions"
              onClick={(e) => setMenu(menuOpen ? null : { kind: "note", id: n.id, at: menuAt(e) })}
            >
              <IconMore size={13} />
            </button>
          </span>
        </div>
        {open && <ul>{kids.map((k) => renderNote(k, indent + 14, keyPrefix, true))}</ul>}
      </li>
    );
  };

  const renderFolder = (f: Folder, depth: number): React.ReactNode => {
    const open = expanded.has(f.id);
    const kids = childFolders.get(f.id) ?? [];
    const own = notesIn.get(f.id) ?? [];
    const selected = view.kind === "folder" && view.id === f.id;
    const menuOpen = menu?.kind === "folder" && menu.id === f.id;
    const total = totals.get(f.id) ?? 0;
    return (
      <li key={f.id}>
        <div
          {...dropProps(f.id)}
          {...(renaming === f.id ? {} : dragProps(DRAG_FOLDER, f.id))}
          className={`row group relative flex items-center gap-1 pr-1 ${
            dropTarget === f.id ? "!bg-[var(--highlight)]" : dragging ? "outline-dashed outline-1 -outline-offset-1 outline-[var(--hairline)]" : ""
          }`}
          style={{ paddingLeft: 4 + depth * 14 }}
          data-selected={selected || menuOpen}
          onContextMenu={(e) => renaming !== f.id && setMenu({ kind: "folder", id: f.id, at: menuAt(e) })}
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
              <span className={`ml-auto pr-1 font-mono text-[10.5px] text-[var(--ink-faint)] ${menuOpen ? "hidden" : "group-hover:hidden"}`}>{total || ""}</span>
            </button>
          )}
          <div className={`items-center ${menuOpen ? "flex" : "hidden group-hover:flex"}`}>
            <button className="icon-btn !h-6 !w-6" title="New note here" onClick={() => props.onNewNote(f.id)}>
              <IconPlus size={13} />
            </button>
            <button
              className="icon-btn !h-6 !w-6"
              title="More"
              aria-label="Folder actions"
              onClick={(e) => setMenu(menuOpen ? null : { kind: "folder", id: f.id, at: menuAt(e) })}
            >
              <IconMore size={13} />
            </button>
          </div>
        </div>
        {open && (
          <ul>
            {kids.map((k) => renderFolder(k, depth + 1))}
            {own.map((n) => renderNote(n, 8 + depth * 14 + 18, "", true))}
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

  const noteMenu = (n: Note) => (
    <>
      <MenuItem icon={<IconNote size={14} />} onClick={() => onNavigate({ kind: "note", id: n.id })}>
        Open
      </MenuItem>
      <MenuItem icon={<IconPlus size={14} />} onClick={() => props.onNewSubpage(n.id)}>
        Add subpage
      </MenuItem>
      <MenuItem icon={<IconPin size={14} />} onClick={() => props.onTogglePin(n.id)}>
        {n.pinned ? "Unpin" : "Pin"}
      </MenuItem>
      <MenuItem icon={<IconCopy size={14} />} onClick={() => props.onDuplicate(n.id)}>
        Duplicate
      </MenuItem>
      <MenuItem icon={<IconLink size={14} />} onClick={() => props.onCopyLink(n.id)}>
        Copy link
      </MenuItem>
      <MenuItem icon={<IconMove size={14} />} onClick={() => props.onPickFolder(n.id)}>
        Move to…
      </MenuItem>
      <MenuSep />
      <MenuItem
        danger
        icon={<IconTrash size={14} />}
        onClick={() => props.onDeleteNote(n.id)}
      >
        Move to Trash
      </MenuItem>
    </>
  );

  const folderMenu = (f: Folder) => {
    const count = totals.get(f.id) ?? 0;
    return (
      <>
        <MenuItem icon={<IconPlus size={14} />} onClick={() => props.onNewNote(f.id)}>
          New note here
        </MenuItem>
        <MenuItem icon={<IconFolder size={14} />} onClick={() => newFolder(f.id)}>
          New subfolder
        </MenuItem>
        <MenuItem onClick={() => setRenaming(f.id)}>Rename</MenuItem>
        {f.parentId && <MenuItem onClick={() => props.onMoveFolder(f.id, null)}>Move to top level</MenuItem>}
        <MenuSep />
        <MenuItem
          danger
          icon={<IconTrash size={14} />}
          onClick={() => {
            if (window.confirm(`Delete “${f.name}”${count ? ` and its subfolders? Its ${count} note${count === 1 ? "" : "s"} will go to the Trash.` : " and its subfolders?"}`))
              props.onDeleteFolder(f.id);
          }}
        >
          Delete folder
        </MenuItem>
      </>
    );
  };

  const openMenuNote = menu?.kind === "note" ? notes.find((n) => n.id === menu.id) : undefined;
  const openMenuFolder = menu?.kind === "folder" ? folders.find((f) => f.id === menu.id) : undefined;

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
      {/* lights-top leaves room for the window's traffic lights above the logo */}
      <div className="drag lights-top flex items-center justify-between px-4 pb-2">
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
          {nav(
            "Tasks",
            { kind: "tasks" },
            <IconTasks size={15} />,
            props.openTasks ? <span className="font-mono text-[10.5px] text-[var(--ink-faint)]">{props.openTasks}</span> : undefined,
          )}
        </div>

        {pinned.length > 0 && (
          <>
            <button
              className="label mt-5 flex w-full items-center gap-1.5 rounded-md px-2 pb-1 text-left hover:text-[var(--ink)]"
              title="Show all pinned notes"
              onClick={() => onNavigate({ kind: "pinned" })}
            >
              <IconPin size={11} /> pinned
            </button>
            <ul>{pinned.map((n) => renderNote(n, 8, "p-"))}</ul>
          </>
        )}

        {recent.length > 0 && (
          <>
            <button
              className="label mt-5 flex w-full items-center gap-1.5 rounded-md px-2 pb-1 text-left hover:text-[var(--ink)]"
              aria-expanded={recentOpen}
              onClick={toggleRecent}
            >
              <IconClock size={11} /> recent
              <span className="ml-auto">
                <IconChevron size={10} open={recentOpen} />
              </span>
            </button>
            {recentOpen && <ul>{recent.map((n) => renderNote(n, 8, "r-"))}</ul>}
          </>
        )}

        <div
          {...dropProps(null)}
          className={`label mt-5 flex items-center justify-between rounded-md px-2 pb-1 ${dropTarget === "__root" ? "bg-[var(--highlight)]" : ""}`}
        >
          <span>folders</span>
          <span className="flex items-center gap-0.5">
            {expanded.size > 0 && (
              <button className="icon-btn !h-5 !w-5" title="Collapse all" aria-label="Collapse all folders" onClick={() => persist(new Set())}>
                <IconCollapse size={12} />
              </button>
            )}
            <button className="icon-btn !h-5 !w-5" title="New folder" onClick={() => newFolder(null)}>
              <IconPlus size={12} />
            </button>
          </span>
        </div>
        <ul>{(childFolders.get(null) ?? []).map((f) => renderFolder(f, 0))}</ul>
        {folders.length === 0 && <p className="px-2 py-2 text-[12.5px] text-[var(--ink-faint)]">No folders yet.</p>}

        <div className="mt-4">
          {nav(
            "Trash",
            { kind: "trash" },
            <IconTrash size={15} />,
            props.trashCount ? <span className="font-mono text-[10.5px] text-[var(--ink-faint)]">{props.trashCount}</span> : undefined,
          )}
        </div>
      </nav>

      <div className="hairline-t flex items-center gap-2 px-3 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] font-mono text-[12px] font-bold uppercase text-[var(--on-accent)]">
          {(props.username ?? "?").slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{props.username}</span>
        <ThemeButton />
        <button className="icon-btn" title="Settings (⌘,)" aria-label="Settings" onClick={props.onSettings}>
          <IconSettings size={15} />
        </button>
      </div>

      {menu && (openMenuNote || openMenuFolder) && (
        <Menu at={menu.at} onClose={() => setMenu(null)}>
          {openMenuNote ? noteMenu(openMenuNote) : folderMenu(openMenuFolder!)}
        </Menu>
      )}
    </aside>
  );
}

// One click flips light and dark (leaving Match System); the full choice is in Settings → Appearance.
function ThemeButton() {
  const { mode, resolved } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      className="icon-btn"
      title={`${next === "dark" ? "Dark" : "Light"} mode${mode === "system" ? " (now matching macOS)" : ""}`}
      aria-label={next === "dark" ? "Switch to dark mode" : "Switch to light mode"}
      onClick={() => setThemeMode(next)}
    >
      {mode === "system" ? <IconMonitor size={15} /> : resolved === "dark" ? <IconMoon size={15} /> : <IconSun size={15} />}
    </button>
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

/**
 * A dropdown menu. Anchored below its parent by default; with `at`, it floats at that point
 * (a right-click or a button's corner) and stays inside the window.
 */
export function Menu({
  children,
  onClose,
  align = "right",
  at,
}: {
  children: React.ReactNode;
  onClose: () => void;
  align?: "left" | "right";
  at?: { x: number; y: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    if (at) window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, at]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!at || !el) return;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(at.x, window.innerWidth - width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(at.y, window.innerHeight - height - 8))}px`;
  }, [at]);

  const menu = (
    <div
      ref={ref}
      role="menu"
      className={`card pop-in z-[70] min-w-[180px] p-1 ${at ? "fixed" : `absolute top-full mt-1 ${align === "right" ? "right-0" : "left-0"}`}`}
      style={at ? { left: at.x, top: at.y } : undefined}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        // Picking an item closes the menu.
        if ((e.target as HTMLElement).closest("button")) onClose();
      }}
    >
      {children}
    </div>
  );
  // Floating menus live on <body> so a scrolling or transformed parent can't clip them.
  return at ? createPortal(menu, document.body) : menu;
}

export function MenuItem({
  children,
  onClick,
  danger,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      role="menuitem"
      className={`row flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${danger ? "text-[var(--danger)]" : ""}`}
      onClick={onClick}
    >
      {icon && <span className={`shrink-0 ${danger ? "" : "text-[var(--ink-soft)]"}`}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export const MenuSep = () => <div className="hairline-t my-1" role="separator" />;
