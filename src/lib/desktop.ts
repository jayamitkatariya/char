"use client";

import type { Folder, Note } from "./types";

export type WorkspaceData = { folders: Folder[]; notes: Note[] };

export type AgentId = "claude" | "opencode" | "hermes" | "codex" | "custom";
export type BuiltInAgent = Exclude<AgentId, "custom">;
/** What charlie may do in its folder: look only, also edit files, or anything without asking. */
export type AgentLevel = "read" | "edit" | "full";
export type AgentConfig = { agent: AgentId; custom: string; cwd: string; level: AgentLevel; models: Partial<Record<BuiltInAgent, string>> };
export type DetectedAgents = Record<BuiltInAgent, { label: string; path: string | null; version: string | null; levels: AgentLevel[] }>;
export type AgentStatus = { installed: boolean; signedIn: boolean | null; detail: string; defaultModel: string | null; signIn: string };
export type AgentStep = { tool: string; detail: string };
export type TranscriptEntry = { t: number; type: string; [k: string]: unknown };
export type AgentEvent = { runId: string } & (
  | { type: "queued" }
  | { type: "start"; agent: string; level?: AgentLevel; resumed?: boolean }
  | { type: "session"; id: string }
  | { type: "step"; step: AgentStep }
  | { type: "progress"; line: string }
  | { type: "quiet"; since: number }
  | { type: "done"; output: string; sessionId?: string; notice?: string }
  | { type: "error"; message: string }
  | { type: "stopped" }
);
export type ThemeMode = "system" | "light" | "dark";
export type CliRequest = { id: string; cmd: string; args: Record<string, unknown> };
export type MenuAction = "settings" | "new-note" | "new-folder" | "search" | "ask" | "toggle-sidebar" | "home" | "shortcuts" | `theme-${ThemeMode}`;

// Exposed by electron/preload.js. The notepad only runs inside the Mac app; a plain browser has no bridge.
type Bridge = {
  userName: string;
  dataPath: string;
  version: string;
  load: () => Promise<WorkspaceData | null>;
  save: (data: WorkspaceData) => Promise<void>;
  revealData: () => void;
  /** The appearance saved on this Mac, and setting it (window chrome and native menus follow). */
  theme?: ThemeMode;
  setTheme?: (theme: ThemeMode) => Promise<void>;
  onMenu: (cb: (action: MenuAction) => void) => () => void;
  onOpen: (cb: (target: { kind: "note" | "folder"; id: string }) => void) => () => void;
  onUpdate: (cb: (update: { version: string; url: string }) => void) => () => void;
  allowAI: (baseUrl: string) => Promise<void>;
  cli?: {
    onRequest: (cb: (req: CliRequest) => void) => () => void;
    ready: () => void;
    respond: (res: { id: string; ok: boolean; result?: unknown; error?: string }) => void;
    status: () => Promise<{ installedAt: string | null }>;
    install: () => Promise<{ installedAt: string; onPath: boolean }>;
  };
  agent: {
    detect: () => Promise<DetectedAgents>;
    status: (agentId: BuiltInAgent) => Promise<AgentStatus | null>;
    models: (agentId: BuiltInAgent) => Promise<string[]>;
    mcpList: (agentId: BuiltInAgent) => Promise<string>;
    transcript: (runId: string) => Promise<TranscriptEntry[]>;
    signIn: (agentId: BuiltInAgent) => Promise<boolean>;
    getConfig: () => Promise<AgentConfig>;
    setConfig: (config: AgentConfig) => Promise<AgentConfig>;
    pickFolder: () => Promise<string | null>;
    run: (runId: string, prompt: string, opts?: { resume?: string; task?: string }) => Promise<void>;
    /** Asks the agent to set up a connector for itself, at full access, after a native confirm. */
    setup: (runId: string, name: string, prompt: string) => Promise<boolean>;
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

export const savedTheme = (): ThemeMode | null => bridge()?.theme ?? null;
export const setNativeTheme = (theme: ThemeMode) => bridge()?.setTheme?.(theme);

export const onMenu = (cb: (action: MenuAction) => void) => bridge()?.onMenu(cb) ?? (() => {});

export const onOpenLink = (cb: (target: { kind: "note" | "folder"; id: string }) => void) => bridge()?.onOpen(cb) ?? (() => {});

export const onUpdate = (cb: (update: { version: string; url: string }) => void) => bridge()?.onUpdate(cb) ?? (() => {});

/** Lets this AI endpoint answer the app even if it doesn't send CORS headers (local servers). */
export const allowAI = async (baseUrl: string) => {
  await bridge()?.allowAI(baseUrl);
};

export const agentBridge = () => need().agent;

/** The `char` command line: requests to answer, and installing the command. */
export const cliBridge = () => bridge()?.cli ?? null;
