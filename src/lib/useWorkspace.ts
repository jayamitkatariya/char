"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadWorkspace, saveWorkspace, type WorkspaceData } from "./desktop";
import type { Folder, Note } from "./types";

// Notes live in one JSON file on this Mac (see electron/main.js). The whole workspace is
// held in memory and written back after every change; the page already debounces typing.

export type { WorkspaceData };

export const DEFAULT_FOLDER = "notes";

export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const WELCOME = `Everything you write here is saved on this Mac as you type.

## The basics

- Type **/** for headings, checklists, tables, quotes and code.
- Type **/page** for a page inside this one. Pages can hold pages, as deep as you like.
- Type **@** to link another note or folder. Linked notes show this one under *Linked from*.
- Press **⌘K** to jump to anything, **⌘N** for a new note, **⌘F** to find in a note, **⌘/** for every shortcut.
- Hover the title to give a page an icon. Right-click anything in the sidebar for more.
- Every checklist shows up in **Tasks**. Deleted notes wait in the **Trash** for 30 days.
- Drag the handle on the left of a block to move it.

- Press **⌘⇧T** to tidy loose lines into to-dos and bullets. Try it on the lines below.

need to water the plants
buy coffee, oat milk and bread
call the dentist about thursday

## Hand work to @charlie

Type **@charlie**, then a task, and press Enter: "@charlie turn this note into a plan". charlie hands the note to a coding agent already on your Mac (Claude Code, Codex, OpenCode or Hermes), shows its steps as it works, and writes the answer right here. Press **Follow up** under an answer to keep the conversation going. Long answers get their own note.

In Settings → Agents, pick the agent, its model, its working folder and how much it may do. **Connectors** there can ask it to set up GitHub, your calendar, the web and more.

## Ask your notes

Open **Ask char** (⌘J) to chat with an AI that can read every note. It's optional: add your own API key (Anthropic, OpenAI, OpenRouter, a local Ollama…) under Settings.`;

// First launch: a home folder and a note that explains the app.
function starter(): WorkspaceData {
  const now = new Date().toISOString();
  return {
    folders: [{ id: DEFAULT_FOLDER, name: "Notes", parentId: null }],
    notes: [
      { id: newId("n"), folderId: DEFAULT_FOLDER, title: "Welcome to char", content: WELCOME, links: [], createdAt: now, updatedAt: now, pinned: true },
    ],
  };
}

export const TRASH_DAYS = 30;

// Tolerates files written by older versions or exported from the web app.
function normalize(d: Partial<WorkspaceData>): WorkspaceData {
  return {
    folders: (d.folders ?? []).map((f) => ({ id: f.id, name: f.name ?? "Untitled folder", parentId: f.parentId ?? null })),
    notes: (d.notes ?? []).map((n) => ({ ...n, title: n.title ?? "", content: n.content ?? "", pinned: !!n.pinned, parentId: n.parentId ?? null, deletedAt: n.deletedAt ?? null })),
  };
}

/** Every subpage below a page, at any depth. */
export function subpagesOf(notes: Note[], id: string): Set<string> {
  const kids = new Map<string, string[]>();
  for (const n of notes) if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n.id]);
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const k of kids.get(pid) ?? []) {
      if (out.has(k) || k === id) continue;
      out.add(k);
      walk(k);
    }
  };
  walk(id);
  return out;
}

export function useWorkspace() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Mutations chain off the latest data, not the last render's.
  const current = useRef<WorkspaceData | null>(null);

  useEffect(() => {
    let live = true;
    loadWorkspace()
      .then((stored) => {
        if (!live) return;
        let initial = stored ? normalize(stored) : starter();
        // The Trash empties itself of anything older than 30 days.
        const cutoff = Date.now() - TRASH_DAYS * 86400 * 1000;
        const expired = initial.notes.filter((n) => n.deletedAt && Date.parse(n.deletedAt) < cutoff);
        if (expired.length) {
          const gone = new Set(expired.map((n) => n.id));
          initial = { ...initial, notes: initial.notes.filter((n) => !gone.has(n.id)) };
          saveWorkspace(initial).catch(() => {});
        }
        current.current = initial;
        setData(initial);
        if (!stored) saveWorkspace(initial);
      })
      .catch((e: Error) => live && setError(`Couldn't open your notes: ${e.message}`));
    return () => {
      live = false;
    };
  }, []);

  const commit = async (change: (d: WorkspaceData) => WorkspaceData) => {
    if (!current.current) throw new Error("Notes haven't loaded yet");
    const next = change(current.current);
    current.current = next;
    setData(next);
    try {
      await saveWorkspace(next);
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : e}`);
      throw e;
    }
  };

  const createNote = async (folderId: string, init: Partial<Note> = {}) => {
    const now = new Date().toISOString();
    const note: Note = { id: newId("n"), folderId, title: "", content: "", links: [], createdAt: now, updatedAt: now, pinned: false, ...init };
    await commit((d) => ({ ...d, notes: [...d.notes, note] }));
    return note;
  };

  const updateNote = async (id: string, patch: Partial<Note>) => {
    const { id: _ignore, ...rest } = patch; // eslint-disable-line @typescript-eslint/no-unused-vars
    const updatedAt = new Date().toISOString();
    await commit((d) => ({ ...d, notes: d.notes.map((n) => (n.id === id ? { ...n, ...rest, updatedAt } : n)) }));
  };

  // To the Trash, with its subpages (like a folder with its notes). Returns the stamp that
  // restoring uses to bring back exactly what went together.
  const deleteNote = async (id: string) => {
    const stamp = new Date().toISOString();
    await commit((d) => {
      const going = subpagesOf(d.notes.filter((n) => !n.deletedAt), id).add(id);
      return { ...d, notes: d.notes.map((n) => (going.has(n.id) && !n.deletedAt ? { ...n, deletedAt: stamp } : n)) };
    });
    return stamp;
  };

  /** Brings a note back from the Trash, with the subpages that went with it. */
  const restoreNote = async (id: string) => {
    await commit((d) => {
      const note = d.notes.find((n) => n.id === id);
      if (!note?.deletedAt) return d;
      const stamp = note.deletedAt;
      const back = new Set([id, ...[...subpagesOf(d.notes, id)].filter((k) => d.notes.find((n) => n.id === k)?.deletedAt === stamp)]);
      let folders = d.folders;
      // Its folder may have been deleted since: it comes back to Notes instead.
      const home = folders.some((f) => f.id === note.folderId) ? note.folderId : DEFAULT_FOLDER;
      if (!folders.some((f) => f.id === home)) folders = [...folders, { id: DEFAULT_FOLDER, name: "Notes", parentId: null }];
      const parent = note.parentId ? d.notes.find((n) => n.id === note.parentId) : undefined;
      const parentLive = parent && !parent.deletedAt;
      return {
        folders,
        notes: d.notes.map((n) => {
          if (!back.has(n.id)) return n;
          const moved = home !== note.folderId ? { folderId: home } : {};
          if (n.id === id) return { ...n, ...moved, deletedAt: null, parentId: parentLive ? n.parentId : null };
          return { ...n, ...moved, deletedAt: null };
        }),
      };
    });
  };

  /**
   * Deletes for good. From the Trash: the note and the subpages trashed with it. A live note (an
   * empty one being cleaned up): it and its live subpages. Anything else under it (say, a subpage
   * trashed earlier on its own) is kept and just loses its parent.
   */
  const purgeNote = async (id: string) => {
    await commit((d) => {
      const byId = new Map(d.notes.map((n) => [n.id, n]));
      const target = byId.get(id);
      if (!target) return d;
      const gone = new Set([id]);
      for (const k of subpagesOf(d.notes, id)) {
        const n = byId.get(k);
        if (n && (target.deletedAt ? n.deletedAt === target.deletedAt : !n.deletedAt)) gone.add(k);
      }
      return {
        ...d,
        notes: d.notes.filter((n) => !gone.has(n.id)).map((n) => (n.parentId && gone.has(n.parentId) ? { ...n, parentId: null } : n)),
      };
    });
  };

  const emptyTrash = async () => {
    await commit((d) => ({ ...d, notes: d.notes.filter((n) => !n.deletedAt) }));
  };

  /** Puts a page in a folder (top level) or inside another page; its subpages come along. */
  const moveNote = async (id: string, to: { folderId: string } | { parentId: string }) => {
    await commit((d) => {
      const below = subpagesOf(d.notes, id);
      let folderId: string;
      let parentId: string | null = null;
      if ("parentId" in to) {
        const parent = d.notes.find((n) => n.id === to.parentId);
        // Never inside itself or one of its own subpages.
        if (!parent || parent.id === id || below.has(parent.id)) return d;
        folderId = parent.folderId;
        parentId = parent.id;
      } else folderId = to.folderId;
      // Moving isn't editing, so "edited" times stay as they were.
      return {
        ...d,
        notes: d.notes.map((n) => (n.id === id ? { ...n, folderId, parentId } : below.has(n.id) ? { ...n, folderId } : n)),
      };
    });
  };

  const createFolder = async (name: string, parentId: string | null) => {
    const folder: Folder = { id: newId("f"), name, parentId };
    await commit((d) => ({ ...d, folders: [...d.folders, folder] }));
    return folder;
  };

  const patchFolder = (id: string, patch: Partial<Folder>) =>
    commit((d) => ({ ...d, folders: d.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));

  const renameFolder = async (id: string, name: string) => {
    await patchFolder(id, { name });
  };

  const moveFolder = async (id: string, parentId: string | null) => {
    await patchFolder(id, { parentId });
  };

  // Removes the folder and its subfolders; the notes inside go to the Trash. Returns what's needed
  // to undo it.
  const deleteFolder = async (id: string) => {
    const stamp = new Date().toISOString();
    let removed: Folder[] = [];
    await commit((d) => {
      const doomed = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const f of d.folders) {
          if (f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) {
            doomed.add(f.id);
            grew = true;
          }
        }
      }
      removed = d.folders.filter((f) => doomed.has(f.id));
      return {
        folders: d.folders.filter((f) => !doomed.has(f.id)),
        notes: d.notes.map((n) => (doomed.has(n.folderId) && !n.deletedAt ? { ...n, deletedAt: stamp } : n)),
      };
    });
    return { stamp, folders: removed };
  };

  /** Puts back folders deleted together, and the notes that went to the Trash with them. */
  const undoDeleteFolder = async ({ stamp, folders: back }: { stamp: string; folders: Folder[] }) => {
    await commit((d) => ({
      folders: [...d.folders, ...back.filter((f) => !d.folders.some((x) => x.id === f.id))],
      notes: d.notes.map((n) => (n.deletedAt === stamp ? { ...n, deletedAt: null } : n)),
    }));
  };

  // Merges a char/jknotes export by ID, so existing notes are kept.
  const importData = async (incoming: WorkspaceData) => {
    const add = normalize(incoming);
    await commit((d) => {
      const folders = new Map(d.folders.map((f) => [f.id, f]));
      const notes = new Map(d.notes.map((n) => [n.id, n]));
      for (const f of add.folders) folders.set(f.id, f);
      for (const n of add.notes) notes.set(n.id, n);
      return { folders: [...folders.values()], notes: [...notes.values()] };
    });
    return add.notes.length;
  };

  const notes = useMemo(() => (data?.notes ?? []).filter((n) => !n.deletedAt), [data]);
  const trash = useMemo(() => (data?.notes ?? []).filter((n) => n.deletedAt), [data]);

  return {
    loaded: data !== null,
    folders: data?.folders ?? [],
    /** Live notes; the Trash is separate. */
    notes,
    trash,
    error,
    clearError: () => setError(null),
    createNote,
    updateNote,
    deleteNote,
    restoreNote,
    purgeNote,
    emptyTrash,
    moveNote,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    undoDeleteFolder,
    importData,
    /** The latest stored copy, including changes made since the last render. */
    getNote: (id: string) => current.current?.notes.find((n) => n.id === id && !n.deletedAt),
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
