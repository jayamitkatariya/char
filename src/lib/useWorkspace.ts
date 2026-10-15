"use client";

import { useEffect, useRef, useState } from "react";
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
- Type **@** to link another note or folder. Linked notes show this one under *Linked from*.
- Press **⌘K** to jump to anything, **⌘N** for a new note.
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

// Tolerates files written by older versions or exported from the web app.
function normalize(d: Partial<WorkspaceData>): WorkspaceData {
  return {
    folders: (d.folders ?? []).map((f) => ({ id: f.id, name: f.name ?? "Untitled folder", parentId: f.parentId ?? null })),
    notes: (d.notes ?? []).map((n) => ({ ...n, title: n.title ?? "", content: n.content ?? "", pinned: !!n.pinned })),
  };
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
        const initial = stored ? normalize(stored) : starter();
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

  const deleteNote = async (id: string) => {
    await commit((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) }));
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

  // Removes the folder, its subfolders, and every note inside them.
  const deleteFolder = async (id: string) => {
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
      return { folders: d.folders.filter((f) => !doomed.has(f.id)), notes: d.notes.filter((n) => !doomed.has(n.folderId)) };
    });
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

  return {
    loaded: data !== null,
    folders: data?.folders ?? [],
    notes: data?.notes ?? [],
    error,
    clearError: () => setError(null),
    createNote,
    updateNote,
    deleteNote,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    importData,
    /** The latest stored copy, including changes made since the last render. */
    getNote: (id: string) => current.current?.notes.find((n) => n.id === id),
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
