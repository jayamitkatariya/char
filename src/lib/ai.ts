"use client";

import Anthropic from "@anthropic-ai/sdk";
import type { Folder, Note } from "./types";

/* ---------- settings (bring your own key) ---------- */

export type Provider = "anthropic" | "openai";

export type AISettings = {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export const PRESETS: { id: string; label: string; provider: Provider; baseUrl: string; model: string; hint?: string }[] = [
  { id: "anthropic", label: "Anthropic", provider: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5" },
  { id: "openai", label: "OpenAI", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "" },
  { id: "openrouter", label: "OpenRouter", provider: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "" },
  { id: "groq", label: "Groq", provider: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "" },
  {
    id: "ollama",
    label: "Ollama (local)",
    provider: "openai",
    baseUrl: "http://localhost:11434/v1",
    model: "",
    hint: "Start Ollama with OLLAMA_ORIGINS=* so char can reach it. No key needed.",
  },
  { id: "custom", label: "Custom (OpenAI-compatible)", provider: "openai", baseUrl: "", model: "" },
];

// Keys stay on this Mac and go only to the provider you choose.
const settingsKey = (uid: string) => `char:ai:${uid}`;
export const chatHistoryKey = (uid: string) => `char:chat:${uid}`;

export function loadAISettings(uid: string): AISettings | null {
  try {
    const raw = window.localStorage.getItem(settingsKey(uid));
    return raw ? (JSON.parse(raw) as AISettings) : null;
  } catch {
    return null;
  }
}

export function saveAISettings(uid: string, s: AISettings | null) {
  try {
    if (s) window.localStorage.setItem(settingsKey(uid), JSON.stringify(s));
    else window.localStorage.removeItem(settingsKey(uid));
  } catch {
    // Storage blocked: settings last for this session only.
  }
}

export const isConfigured = (s: AISettings | null): s is AISettings => !!s && !!s.baseUrl && !!s.model;

const trimSlash = (u: string) => u.trim().replace(/\/+$/, "");

function anthropicClient(s: AISettings) {
  return new Anthropic({
    apiKey: s.apiKey,
    baseURL: trimSlash(s.baseUrl) || undefined,
    // BYOK: the key belongs to the person using the app, on their own machine.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  });
}

function openaiHeaders(s: AISettings): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (s.apiKey) h.Authorization = `Bearer ${s.apiKey}`;
  return h;
}

async function readError(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    return j.error?.message ?? j.message ?? text;
  } catch {
    return text || `${res.status} ${res.statusText}`;
  }
}

export async function listModels(s: AISettings): Promise<string[]> {
  if (s.provider === "anthropic") {
    const ids: string[] = [];
    for await (const m of anthropicClient(s).models.list()) ids.push(m.id);
    return ids;
  }
  const res = await fetch(`${trimSlash(s.baseUrl)}/models`, { headers: openaiHeaders(s) });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { data?: { id: string }[]; models?: { name?: string; id?: string }[] };
  const ids = (json.data ?? json.models ?? []).map((m) => ("id" in m && m.id ? m.id : (m as { name?: string }).name ?? ""));
  return ids.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/* ---------- chat ---------- */

export type ChatMessage = { role: "user" | "assistant"; content: string };

// Models that accept Anthropic's server-side refusal fallback.
const FALLBACK_MODELS = /^claude-(opus-5|fable-5-1|sonnet-5-5)/;

export async function streamChat(
  s: AISettings,
  system: string,
  messages: ChatMessage[],
  onText: (delta: string) => void,
  signal: AbortSignal,
): Promise<void> {
  if (s.provider === "anthropic") {
    const client = anthropicClient(s);
    const officialEndpoint = !s.baseUrl || /api\.anthropic\.com/.test(s.baseUrl);
    // Opus/Fable/Sonnet 5.x on Anthropic's own API: if a safety check declines, the API retries on a fallback model.
    const final =
      officialEndpoint && FALLBACK_MODELS.test(s.model)
        ? await client.beta.messages
            .stream(
              { model: s.model, max_tokens: 16000, system, messages, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" },
              { signal },
            )
            .on("text", onText)
            .finalMessage()
        : await client.messages.stream({ model: s.model, max_tokens: 16000, system, messages }, { signal }).on("text", onText).finalMessage();
    if (final.stop_reason === "refusal") onText("\n\n*The model declined to answer this one.*");
    return;
  }

  const res = await fetch(`${trimSlash(s.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: openaiHeaders(s),
    signal,
    body: JSON.stringify({
      model: s.model,
      stream: true,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!res.ok || !res.body) throw new Error(await readError(res));

  // Server-sent events: `data: {json}` lines, ending with `data: [DONE]`.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, "");
      if (!data || data === "[DONE]" || !line.trim().startsWith("data:")) continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) onText(delta);
      } catch {
        // A partial or keep-alive line; the next chunk completes it.
      }
    }
  }
}

/* ---------- context: let the model read the notes ---------- */

// ~50k tokens of note text. Everything else still appears in the index by title.
const CONTEXT_BUDGET = 200_000;

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];

export function buildSystemPrompt(opts: {
  folders: Folder[];
  notes: Note[];
  currentNoteId: string | null;
  question: string;
  username: string | null;
}): string {
  const { folders, notes, currentNoteId, question, username } = opts;
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path = (id: string) => {
    const parts: string[] = [];
    let f = byId.get(id);
    while (f) {
      parts.unshift(f.name);
      f = f.parentId ? byId.get(f.parentId) : undefined;
    }
    return parts.join(" / ") || "Notes";
  };

  // Rank notes: the open one first, then keyword overlap with the question, then recency.
  const terms = new Set(words(question));
  const scored = notes.map((n) => {
    let score = n.id === currentNoteId ? 1e6 : 0;
    const title = n.title.toLowerCase();
    for (const t of terms) {
      if (title.includes(t)) score += 50;
      score += Math.min(20, n.content.toLowerCase().split(t).length - 1) * 3;
    }
    score += Date.parse(n.updatedAt) / 1e12; // tiny tiebreak toward recent notes
    return { n, score };
  });
  scored.sort((a, b) => b.score - a.score);

  let used = 0;
  const full: string[] = [];
  const indexOnly: string[] = [];
  for (const { n } of scored) {
    const title = n.title.trim() || "Untitled";
    const block = `<note title="${title.replace(/"/g, "'")}" folder="${path(n.folderId)}" updated="${n.updatedAt.slice(0, 10)}"${
      n.id === currentNoteId ? ' open="true"' : ""
    }>\n${n.content.trim()}\n</note>`;
    if (used + block.length <= CONTEXT_BUDGET) {
      full.push(block);
      used += block.length;
    } else {
      indexOnly.push(`- ${title} (${path(n.folderId)}, ${n.updatedAt.slice(0, 10)})`);
    }
  }

  const folderList = folders.map((f) => `- ${path(f.id)}`).join("\n") || "- Notes";

  return `You are char, the assistant built into ${username ? `${username}'s` : "the user's"} notepad. You can read their notes below. Help them find things, connect ideas across notes, summarize, plan, and draft.

Rules:
- Answer from the notes when the question is about them. If the notes don't say, say so plainly instead of guessing.
- When you use a note, cite it as [[Exact Note Title]] so the user can click through.
- Be concise. Use short paragraphs, lists, and checklists ("- [ ] item") where they help.
- Today is ${new Date().toDateString()}.

Folders:
${folderList}

${notes.length} notes in total. ${full.length} included in full below${indexOnly.length ? `; ${indexOnly.length} more listed by title only (ask the user to open one if you need it)` : ""}.

${full.join("\n\n")}
${indexOnly.length ? `\nOther notes (titles only):\n${indexOnly.join("\n")}` : ""}`;
}
