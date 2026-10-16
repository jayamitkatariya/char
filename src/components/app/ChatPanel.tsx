"use client";

import { useEffect, useRef, useState } from "react";
import { buildSystemPrompt, chatHistoryKey, streamChat, type AISettings, type ChatMessage } from "@/lib/ai";
import type { Folder, Note } from "@/lib/types";
import { IconCheck, IconCopy, IconInsert, IconNote, IconPlus, IconSend, IconSparkle, IconStop, IconTrash, IconX } from "../icons";
import { Markdown } from "./Markdown";

type Props = {
  uid: string;
  username: string | null;
  settings: AISettings | null;
  folders: Folder[];
  notes: Note[];
  currentNote: Note | null;
  /** A question queued from elsewhere (⌘K "Ask char", the daily brief button). */
  pending: string | null;
  onPendingTaken: () => void;
  onClose: () => void;
  onSetup: () => void;
  onOpenNoteByTitle: (title: string) => void;
  onInsert: ((markdown: string) => void) | null;
  onSaveAsNote: (title: string, markdown: string) => void;
};

export const BRIEF_PROMPT =
  "Write my daily brief from my notes. Lead with one bold sentence summarizing the state of things. Then bullets for: what got done recently, what's waiting or blocked, and what needs me next (with [[note]] links). End with a short to-do list.";

export function ChatPanel(p: Props) {
  // Conversation survives reloads (on this Mac only).
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(chatHistoryKey(p.uid)) ?? "[]");
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (streaming) return;
    try {
      localStorage.setItem(chatHistoryKey(p.uid), JSON.stringify(messages.slice(-40)));
    } catch {}
  }, [messages, streaming, p.uid]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);

  useEffect(() => inputRef.current?.focus(), []);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || streaming || !p.settings) return;
    setError(null);
    setInput("");
    const history: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);
    const controller = new AbortController();
    abort.current = controller;
    const system = buildSystemPrompt({
      folders: p.folders,
      notes: p.notes,
      currentNoteId: p.currentNote?.id ?? null,
      question,
      username: p.username,
    });
    try {
      await streamChat(
        p.settings,
        system,
        history,
        (delta) =>
          setMessages((m) => {
            const next = [...m];
            next[next.length - 1] = { role: "assistant", content: next[next.length - 1].content + delta };
            return next;
          }),
        controller.signal,
      );
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Drop an answer that never started (error or stop) so the question can be retried.
      setMessages((m) => (m[m.length - 1]?.role === "assistant" && !m[m.length - 1].content ? m.slice(0, -1) : m));
      setStreaming(false);
      abort.current = null;
    }
  };

  // Run a question handed over from elsewhere once settings are in place.
  useEffect(() => {
    if (p.pending && p.settings && !streaming) {
      const q = p.pending;
      p.onPendingTaken();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- runs a question handed in from outside the panel
      send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pending, p.settings]);

  const suggestions = [
    p.currentNote ? `Summarize “${p.currentNote.title || "this note"}”` : "What have I been writing about lately?",
    "Turn my recent notes into a to-do list",
    "What ideas connect across my notes?",
    "Daily brief",
  ];

  const lastAnswer = (i: number) => messages[i]?.content ?? "";
  const titleFrom = (md: string) =>
    (md.split("\n").find((l) => l.trim()) ?? "From char").replace(/[#*_`[\]]/g, "").trim().slice(0, 60) || "From char";

  return (
    <aside className="flex h-full w-full flex-col bg-[var(--card)]">
      <header className="drag hairline-b flex h-12 shrink-0 items-center gap-2 px-4">
        <span className="text-[var(--sun)]">
          <IconSparkle size={16} />
        </span>
        <span className="text-[14px] font-medium">Ask char</span>
        {p.settings && (
          <button className="label truncate rounded-md px-1.5 py-0.5 hover:bg-[var(--hover)]" onClick={p.onSetup} title="Change model">
            {p.settings.model}
          </button>
        )}
        <span className="flex-1" />
        {messages.length > 0 && (
          <button className="icon-btn" title="Clear conversation" onClick={() => (abort.current?.abort(), setMessages([]), setError(null))}>
            <IconTrash size={14} />
          </button>
        )}
        <button className="icon-btn" title="Close (⌘J)" onClick={p.onClose}>
          <IconX size={15} />
        </button>
      </header>

      {!p.settings ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <p className="font-hand -rotate-2 text-[26px] text-[var(--ink-soft)]">bring your own brain</p>
          <h3 className="font-serif mt-2 text-[24px] font-semibold leading-tight">Connect an AI model</h3>
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--ink-soft)]">
            char works with Anthropic, OpenAI, OpenRouter, Groq, a local Ollama, or any OpenAI-compatible endpoint. Your key stays on this Mac and is only
            sent to the provider you pick.
          </p>
          <button className="btn btn-primary mt-6" onClick={p.onSetup}>
            Add API key →
          </button>
          <p className="label mt-4">ai is optional · your notes work without it</p>
        </div>
      ) : (
        <>
          <div ref={scroller} className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 py-5">
            {messages.length === 0 ? (
              <div className="pt-6">
                <h3 className="font-serif text-[24px] font-semibold leading-tight">What do you want to know?</h3>
                <p className="mt-2 text-[14px] text-[var(--ink-soft)]">
                  char can read all {p.notes.length} of your notes{p.currentNote ? ", starting with the one that's open" : ""}.
                </p>
                <div className="mt-5 flex flex-col items-start gap-2">
                  {suggestions.map((s) => (
                    <button key={s} className="btn btn-sm !text-[13px]" onClick={() => send(s === "Daily brief" ? BRIEF_PROMPT : s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {messages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--paper-2)] px-3.5 py-2 text-[14px]">
                        {m.content === BRIEF_PROMPT ? "☀ Daily brief" : m.content}
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="group">
                      {m.content ? (
                        <Markdown text={m.content} onNoteLink={p.onOpenNoteByTitle} />
                      ) : (
                        <span className="blink-caret text-[14px] text-[var(--ink-faint)]">reading your notes</span>
                      )}
                      {m.content && !(streaming && i === messages.length - 1) && (
                        <div className="mt-2 flex gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                          <button
                            className="icon-btn !h-7 !w-7"
                            title="Copy"
                            onClick={async () => {
                              await navigator.clipboard.writeText(lastAnswer(i));
                              setCopied(i);
                              setTimeout(() => setCopied(null), 1200);
                            }}
                          >
                            {copied === i ? <IconCheck size={14} /> : <IconCopy size={14} />}
                          </button>
                          {p.onInsert && (
                            <button className="icon-btn !h-7 !w-7" title="Insert into the open note" onClick={() => p.onInsert?.(lastAnswer(i))}>
                              <IconInsert size={14} />
                            </button>
                          )}
                          <button className="icon-btn !h-7 !w-7" title="Save as a new note" onClick={() => p.onSaveAsNote(titleFrom(lastAnswer(i)), lastAnswer(i))}>
                            <IconNote size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  ),
                )}
              </div>
            )}
            {error && (
              <div role="alert" className="mt-4 rounded-xl bg-[var(--danger-bg)] px-3 py-2 text-[13px] text-[var(--danger-ink)]">
                {error}
                <button className="ml-2 underline" onClick={p.onSetup}>
                  Check settings
                </button>
              </div>
            )}
          </div>

          <form
            className="m-3 rounded-2xl border border-[var(--hairline)] bg-[var(--card)] shadow-[var(--shadow)]"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <textarea
              ref={inputRef}
              rows={2}
              className="field resize-none px-4 pt-3 text-[14px]"
              placeholder="Reply to char…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
            />
            <div className="flex items-center gap-2 px-3 pb-2.5">
              <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--ink-faint)]">
                <IconPlus size={13} />
                <span className="truncate">{p.currentNote ? `Reading “${p.currentNote.title || "Untitled"}” + all notes` : "Reading all notes"}</span>
              </span>
              <span className="flex-1" />
              {streaming ? (
                <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--on-accent)]" title="Stop" onClick={() => abort.current?.abort()}>
                  <IconStop size={14} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--on-accent)] transition-opacity disabled:opacity-30"
                  title="Send"
                >
                  <IconSend size={15} />
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </aside>
  );
}
