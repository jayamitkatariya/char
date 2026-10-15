"use client";

import { useEffect, useState } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, type BlockNoteEditor } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { stopRun, useRun } from "@/lib/charlie";
import { IconFolder, IconNote, IconRetry, IconStop, IconTerminal, IconX } from "../icons";
import { openLink, useLinkTitle, type LinkKind } from "./linkStore";

/* ---------- @-links: an inline chip pointing at a note or folder ---------- */

function LinkChip({ id, kind, title }: { id: string; kind: LinkKind; title: string }) {
  const live = useLinkTitle(id);
  const missing = live === undefined;
  return (
    <span
      className="note-link"
      data-missing={missing}
      contentEditable={false}
      title={missing ? "This was deleted" : kind === "folder" ? "Open folder" : "Open note"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => !missing && openLink(kind, id)}
    >
      {kind === "folder" ? <IconFolder size={13} /> : <IconNote size={13} />}
      {(live ?? title) || "Untitled"}
    </span>
  );
}

const NoteLink = createReactInlineContentSpec(
  {
    type: "noteLink",
    propSchema: { id: { default: "" }, kind: { default: "note" }, title: { default: "" } },
    content: "none",
  },
  {
    render: ({ inlineContent }) => (
      <LinkChip id={inlineContent.props.id} kind={inlineContent.props.kind as LinkKind} title={inlineContent.props.title} />
    ),
    // Markdown/HTML export: a plain link the AI and exports can follow.
    toExternalHTML: ({ inlineContent }) => (
      <a href={`char://${inlineContent.props.kind === "folder" ? "folder" : "note"}/${inlineContent.props.id}`}>
        {inlineContent.props.title || "Untitled"}
      </a>
    ),
  },
);

/* ---------- @charlie: the chip that starts a task line ---------- */

const CharlieChip = createReactInlineContentSpec(
  { type: "charlie", propSchema: {}, content: "none" },
  {
    render: () => (
      <span className="charlie-chip" contentEditable={false} title="Press Enter to send this line to your agent">
        @charlie
      </span>
    ),
    toExternalHTML: () => <span>@charlie</span>,
  },
);

/* ---------- a run: the card charlie works in, replaced by the answer when done ---------- */

export type RunResult =
  | { kind: "inline"; markdown: string }
  | { kind: "link"; noteId: string; title: string; lines: number }
  | { kind: "error" | "stopped"; message: string };

type RunActions = { retry: (runId: string) => void };
const runActions = new Map<string, RunActions>(); // noteId → what the card's buttons call

export const registerRunActions = (noteId: string, actions: RunActions) => {
  runActions.set(noteId, actions);
  return () => {
    if (runActions.get(noteId) === actions) runActions.delete(noteId);
  };
};

function elapsed(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function RunCard({ runId, noteId, task, agent, status, error, onDismiss }: { runId: string; noteId: string; task: string; agent: string; status: string; error: string; onDismiss: () => void }) {
  const live = useRun(runId);
  const [now, setNow] = useState(() => Date.now());
  // A card saved as "running" whose run isn't alive (the app was quit mid-task) was interrupted.
  const state = live?.status === "running" ? "running" : status === "running" ? "interrupted" : status;
  useEffect(() => {
    if (state !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state]);

  const message =
    state === "error" ? error || live?.error || "Something went wrong." : state === "stopped" ? "Stopped." : state === "interrupted" ? "Interrupted when char was closed." : "";

  return (
    <div className="charlie-card" contentEditable={false} data-state={state}>
      <div className="flex items-center gap-2">
        <span className="charlie-badge">
          <IconTerminal size={13} /> charlie
        </span>
        <span className="label truncate">{live?.agent && live.agent !== "charlie" ? live.agent : agent}</span>
        <span className="flex-1" />
        {state === "running" ? (
          <>
            <span className="label tabular-nums">{elapsed(now - (live?.startedAt ?? now))}</span>
            <button className="btn btn-sm" onClick={() => stopRun(runId)}>
              <IconStop size={12} /> Stop
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-sm" onClick={() => runActions.get(noteId)?.retry(runId)}>
              <IconRetry size={12} /> Retry
            </button>
            <button className="icon-btn" onClick={onDismiss} aria-label="Remove" title="Remove">
              <IconX size={14} />
            </button>
          </>
        )}
      </div>
      <p className="charlie-task">{task}</p>
      {state === "running" ? (
        <p className="charlie-line">
          <span className="charlie-dots" aria-hidden />
          {live?.line || "working…"}
        </p>
      ) : (
        <p className="charlie-error">{message}</p>
      )}
    </div>
  );
}

const AgentRun = createReactBlockSpec(
  {
    type: "agentRun",
    propSchema: {
      runId: { default: "" },
      noteId: { default: "" },
      task: { default: "" },
      agent: { default: "" },
      status: { default: "running" },
      error: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <RunCard {...block.props} onDismiss={() => editor.removeBlocks([block])} />
    ),
    toExternalHTML: ({ block }) => (
      <p>
        @charlie {block.props.task} ({block.props.status === "running" ? "working…" : block.props.status})
      </p>
    ),
  },
);

/* ---------- schema ---------- */

export const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, agentRun: AgentRun() },
  inlineContentSpecs: { ...defaultInlineContentSpecs, noteLink: NoteLink, charlie: CharlieChip },
});

export type CharEditor = BlockNoteEditor<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>;
type AnyBlock = CharEditor["document"][number];

export function findBlock(blocks: AnyBlock[], match: (b: AnyBlock) => boolean): AnyBlock | undefined {
  for (const b of blocks) {
    if (match(b)) return b;
    const inner = findBlock(b.children as AnyBlock[], match);
    if (inner) return inner;
  }
  return undefined;
}

export const findRun = (editor: CharEditor, runId: string) =>
  findBlock(editor.document, (b) => b.type === "agentRun" && (b.props as { runId?: string }).runId === runId);

/** Swaps a run's card for its answer (or marks it failed). Works on a mounted or a headless editor. */
export function applyRunResult(editor: CharEditor, runId: string, result: RunResult) {
  const block = findRun(editor, runId);
  if (!block) return false; // the card was deleted while charlie worked
  if (result.kind === "inline") {
    // Whitespace between parsed elements can come back as empty paragraphs (notably headless).
    const parsed = editor.tryParseMarkdownToBlocks(result.markdown).filter(
      (b) => !(b.type === "paragraph" && Array.isArray(b.content) && b.content.every((c) => c.type === "text" && !c.text.trim())),
    );
    editor.replaceBlocks([block], parsed.length ? parsed : [{ type: "paragraph", content: "charlie had nothing to add." }]);
  } else if (result.kind === "link") {
    editor.replaceBlocks(
      [block],
      [
        {
          type: "paragraph",
          content: [
            { type: "noteLink", props: { id: result.noteId, kind: "note", title: result.title } },
            ` charlie's full answer (${result.lines} lines)`,
          ],
        },
      ],
    );
  } else {
    editor.updateBlock(block, { props: { status: result.kind, error: result.message } });
  }
  return true;
}

/* ---------- reading a "@charlie …" line ---------- */

type Inline = { type: string; text?: string; props?: Record<string, string>; content?: Inline[] };

const TASK_BLOCKS = new Set(["paragraph", "bulletListItem", "numberedListItem", "checkListItem"]);

/**
 * The task in a line that starts with the @charlie chip, plus any notes it @-links. Only the chip
 * counts, never typed text, so writing to a person called Charlie can't start an agent.
 */
export function charlieTask(block: { type?: string; content?: unknown }): { task: string; links: string[] } | null {
  if (!TASK_BLOCKS.has(block.type ?? "") || !Array.isArray(block.content)) return null;
  const parts = block.content as Inline[];
  const first = parts.findIndex((p) => !(p.type === "text" && !p.text?.trim()));
  if (first < 0 || parts[first].type !== "charlie") return null;
  const rest = parts.slice(first + 1);

  const links: string[] = [];
  const text = rest
    .map((p) => {
      if (p.type === "noteLink") {
        if (p.props?.id) links.push(p.props.id);
        return `“${p.props?.title || "Untitled"}”`;
      }
      if (p.type === "link") return (p.content ?? []).map((c) => c.text ?? "").join("");
      return p.text ?? "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return { task: text, links };
}
