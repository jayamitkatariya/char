"use client";

import type { Folder, Note } from "./types";

export type WorkspaceData = { folders: Folder[]; notes: Note[] };

export type AgentId = "claude" | "opencode" | "hermes" | "codex" | "custom";
export type AgentConfig = { agent: AgentId; custom: string; cwd: string; full: boolean; models: Partial<Record<Exclude<AgentId, "custom">, string>> };
export type DetectedAgents = Record<Exclude<AgentId, "custom">, { label: string; path: string | null; version: string | null }>;
export type AgentEvent = { runId: string } & (
  | { type: "start"; agent: string }
  | { type: "progress"; line: string }
  | { type: "done"; output: string }
  | { type: "error"; message: string }
  | { type: "stopped" }
);
export type MenuAction = "settings" | "new-note" | "new-folder" | "search" | "ask" | "toggle-sidebar" | "home";

// Exposed by electron/preload.js. The notepad only runs inside the Mac app; a plain browser has no bridge.
type Bridge = {
  userName: string;
  dataPath: string;
  version: string;
  load: () => Promise<WorkspaceData | null>;
  save: (data: WorkspaceData) => Promise<void>;
  revealData: () => void;
  onMenu: (cb: (action: MenuAction) => void) => () => void;
  onOpen: (cb: (target: { kind: "note" | "folder"; id: string }) => void) => () => void;
  onUpdate: (cb: (update: { version: string; url: string }) => void) => () => void;
  allowAI: (baseUrl: string) => Promise<void>;
  agent: {
    detect: () => Promise<DetectedAgents>;
    models: (agentId: Exclude<AgentId, "custom">) => Promise<string[]>;
    getConfig: () => Promise<AgentConfig>;
    setConfig: (config: AgentConfig) => Promise<AgentConfig>;
    pickFolder: () => Promise<string | null>;
    run: (runId: string, prompt: string) => Promise<void>;
    stop: (runId: string) => Promise<boolean>;
    onEvent: (cb: (e: AgentEvent) => void) => () => void;
  };
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

export const onMenu = (cb: (action: MenuAction) => void) => bridge()?.onMenu(cb) ?? (() => {});

export const onOpenLink = (cb: (target: { kind: "note" | "folder"; id: string }) => void) => bridge()?.onOpen(cb) ?? (() => {});

export const onUpdate = (cb: (update: { version: string; url: string }) => void) => bridge()?.onUpdate(cb) ?? (() => {});

/** Lets this AI endpoint answer the app even if it doesn't send CORS headers (local servers). */
export const allowAI = async (baseUrl: string) => {
  await bridge()?.allowAI(baseUrl);
};

export const agentBridge = () => need().agent;
