"use client";

import { useSyncExternalStore } from "react";
import { agentBridge, type AgentEvent } from "./desktop";

// @charlie runs: what the editor cards show while an agent works, and the hand-off of the
// result back to the note it was called from (see the finisher in the notes page).

export type RunStatus = "running" | "done" | "error" | "stopped";
export type Run = { id: string; noteId: string; task: string; agent: string; status: RunStatus; startedAt: number; line: string; error?: string };
type Finished = Extract<AgentEvent, { type: "done" | "error" | "stopped" }>;

const runs = new Map<string, Run>();
const listeners = new Set<() => void>();
let finisher: ((run: Run, e: Finished) => void) | null = null;
let listening = false;

const changed = () => listeners.forEach((l) => l());

function patch(id: string, next: Partial<Run>) {
  const run = runs.get(id);
  if (!run) return;
  runs.set(id, { ...run, ...next });
  changed();
}

function finish(id: string, e: Finished) {
  const run = runs.get(id);
  if (!run || run.status !== "running") return;
  patch(id, { status: e.type === "done" ? "done" : e.type, error: e.type === "error" ? e.message : undefined });
  finisher?.(runs.get(id)!, e);
}

function listen() {
  if (listening) return;
  listening = true;
  agentBridge().onEvent((e) => {
    if (e.type === "start") patch(e.runId, { agent: e.agent });
    else if (e.type === "progress") patch(e.runId, { line: e.line });
    else finish(e.runId, e);
  });
}

/** The notes page decides where a finished run's output goes. */
export function setRunFinisher(fn: (run: Run, e: Finished) => void) {
  finisher = fn;
  return () => {
    if (finisher === fn) finisher = null;
  };
}

export function startRun(run: { id: string; noteId: string; task: string }, prompt: string) {
  listen();
  runs.set(run.id, { ...run, agent: "charlie", status: "running", startedAt: Date.now(), line: "" });
  changed();
  agentBridge()
    .run(run.id, prompt)
    .catch((e: Error) => finish(run.id, { runId: run.id, type: "error", message: e.message }));
}

export const stopRun = (id: string) => agentBridge().stop(id);

export const isRunning = (id: string) => runs.get(id)?.status === "running";

export function useRun(id: string): Run | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => runs.get(id),
    () => undefined,
  );
}

/* ---------- what charlie is told ---------- */

// Agents get the prompt as a command-line argument; macOS caps those at about 1 MB in total.
const PROMPT_BUDGET = 180_000;

export function buildPrompt(opts: { task: string; title: string; note: string; linked: { title: string; content: string }[] }) {
  const head = `You are charlie, an agent the user called from a note in char, their notepad, by writing "@charlie" followed by a task.

Task: ${opts.task}

If the task involves files, code or commands, do it in the current directory. When you're done, reply with ONLY what should be added to the note, in Markdown (lists, "- [ ]" to-dos, headings and code blocks are all fine). Your reply is pasted into the note as-is, so don't describe what you're doing or what you're adding: no preamble, no sign-off.`;
  let budget = PROMPT_BUDGET - head.length;
  const part = (tag: string, title: string, body: string) => {
    const text = body.length > budget ? `${body.slice(0, Math.max(0, budget - 200))}\n…(cut for length)` : body;
    budget -= text.length + title.length + 40;
    return `<${tag} title="${title.replace(/"/g, "'")}">\n${text}\n</${tag}>`;
  };
  const sections = [part("note", opts.title || "Untitled", opts.note)];
  for (const l of opts.linked) if (budget > 500) sections.push(part("linked-note", l.title || "Untitled", l.content));
  return `${head}\n\nThe note it was called from${opts.linked.length ? ", and notes it links to" : ""}:\n\n${sections.join("\n\n")}`;
}

/** Long answers get their own note, linked from where charlie was asked. */
export const isLongOutput = (output: string) => output.length > 4000 || output.split("\n").length > 60;

/* ---------- which agent charlie is right now (for labels) ---------- */

const LABELS: Record<string, string> = { claude: "Claude Code", opencode: "OpenCode", hermes: "Hermes", codex: "Codex" };
let label = "your agent";

export const agentLabel = () => label;

export function labelFor(config: { agent: string; custom: string }) {
  return config.agent === "custom" ? config.custom.split(/\s+/)[0]?.split("/").pop() || "custom agent" : (LABELS[config.agent] ?? "your agent");
}

/** Called at startup and whenever Settings → Agents saves. */
export async function refreshAgentLabel(config?: { agent: string; custom: string }) {
  try {
    label = labelFor(config ?? (await agentBridge().getConfig()));
  } catch {}
  return label;
}
