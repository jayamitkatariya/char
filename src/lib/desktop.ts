"use client";

import type { Folder, Note } from "./types";

export type WorkspaceData = { folders: Folder[]; notes: Note[] };

// Exposed by electron/preload.js. The notepad only runs inside the Mac app; a plain browser has no bridge.
type Bridge = {
  load: () => Promise<WorkspaceData | null>;
  save: (data: WorkspaceData) => Promise<void>;
  userName: string;
  dataPath: string;
  revealData: () => void;
};

const bridge = (): Bridge | null =>
  typeof window !== "undefined" ? ((window as unknown as { char?: Bridge }).char ?? null) : null;

export const isDesktop = () => bridge() !== null;

const need = () => {
  const b = bridge();
  if (!b) throw new Error("char's notepad runs in the Mac app");
  return b;
};

export const loadWorkspace = () => need().load();

// The write is dispatched synchronously, so a save started while the window closes still lands.
export const saveWorkspace = (data: WorkspaceData) => need().save(data);

// First name from the Mac account ("Jay Katariya" → "Jay"), for the greeting and avatar.
export const userName = () => bridge()?.userName || null;

export const dataPath = () => bridge()?.dataPath ?? null;

export const revealData = () => bridge()?.revealData();
