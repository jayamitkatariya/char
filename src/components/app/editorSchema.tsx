"use client";

import { useEffect, useState } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, type BlockNoteEditor } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { elapsed, stopRun, useRun, type Run } from "@/lib/charlie";
import { agentBridge, type AgentStep, type TranscriptEntry } from "@/lib/desktop";
import { IconFolder, IconNote, IconRetry, IconStop, IconTerminal, IconX } from "../icons";
import { linkTitle, openLink, useLinkTitle, type LinkKind } from "./linkStore";

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
        {linkTitle(inlineContent.props.id) || inlineContent.props.title || "Untitled"}
      </a>
    ),
  },
);

/* ---------- /page: a subpage, shown as a row you click to open ---------- */

function PageRow({ pageId, title }: { pageId: string; title: string }) {
  const live = useLinkTitle(pageId);
  const missing = live === undefined;
  return (
    <div
      className="page-block"
      data-missing={missing}
      contentEditable={false}
      role="link"
      title={missing ? "This page was deleted" : "Open page"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => !missing && openLink("note", pageId)}
    >
      <IconNote size={16} />
      <span className="page-block-title">{missing ? "Deleted page" : (live ?? title) || "Untitled"}</span>
    </div>
  );
}

const Subpage = createReactBlockSpec(
  { type: "subpage", propSchema: { pageId: { default: "" }, title: { default: "" } }, content: "none" },
  {
    render: ({ block }) => <PageRow pageId={block.props.pageId} title={block.props.title} />,
    toExternalHTML: ({ block }) => (
      <p>
        <a href={`char://note/${block.props.pageId}`}>{linkTitle(block.props.pageId) || block.props.title || "Untitled"}</a>
      </p>
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

/* ---------- a run: the card charlie works in, then a slim footer under its answer ---------- */

/** What the footer under an answer remembers: who answered, how long it took, and how to follow up. */
export type RunFooter = { agent: string; agentId: string; sessionId: string; durationMs: number; notice: string };

export type RunResult = (
  | { kind: "inline"; markdown: string }
  | { kind: "link"; noteId: string; title: string; lines: number }
  | { kind: "error" | "stopped"; message: string }
) & { footer?: RunFooter };

type RunActions = { retry: (runId: string) => void; followUp: (runId: string, text: string) => void };
const runActions = new Map<string, RunActions>(); // noteId → what the card's buttons call

export const registerRunActions = (noteId: string, actions: RunActions) => {
  runActions.set(noteId, actions);
  return () => {
    if (runActions.get(noteId) === actions) runActions.delete(noteId);
  };
};

type CardProps = {
  runId: string;
  noteId: string;
  task: string;
  agent: string;
  status: string;
  error: string;
  sessionId: string;
  durationMs: number;
  notice: string;
  onDismiss: () => void;
};

const stepLine = (s: AgentStep) => (
  <>
    <span className="charlie-step-tool">{s.tool}</span>
    {s.detail && <span className="charlie-step-detail">{s.detail}</span>}
  </>
);

/** A run's steps: live from the run while it works, from its saved transcript afterwards. */
function Steps({ runId, live, all }: { runId: string; live?: Run; all: boolean }) {
  const [saved, setSaved] = useState<TranscriptEntry[] | null>(null);
  const fromLog = !live || live.status !== "running";
  useEffect(() => {
    if (!all || !fromLog) return;
    let on = true;
    agentBridge()
      .transcript(runId)
      .then((t) => on && setSaved(t))
      .catch(() => on && setSaved([]));
    return () => {
      on = false;
    };
  }, [all, fromLog, runId]);

  if (!fromLog) {
    const steps = all ? live.steps : live.steps.slice(-3);
    if (!steps.length) return null;
    return (
      <ol className="charlie-steps" data-all={all}>
        {all ? null : live.steps.length > 3 && <li className="charlie-step-more">{live.steps.length - 3} earlier steps</li>}
        {steps.map((s, i) => (
          <li key={i}>{stepLine(s)}</li>
        ))}
      </ol>
    );
  }
  if (!all) return null;
  if (!saved) return <p className="charlie-line">Loading steps…</p>;
  const rows = saved.filter((e) => e.type === "step" || e.type === "error" || e.type === "start");
  if (!rows.length) return <p className="charlie-line">No steps were recorded for this run{live ? "" : " (it may be from before char 1.1)"}.</p>;
  return (
    <ol className="charlie-steps" data-all>
      {rows.map((e, i) => (
        <li key={i} data-kind={e.type}>
          {e.type === "start"
            ? stepLine({ tool: String(e.agent ?? "agent"), detail: `${e.resume ? "continued the conversation" : "started"} · ${e.level ?? ""} access · ${e.cwd ?? ""}` })
            : e.type === "error"
              ? stepLine({ tool: "error", detail: String(e.message ?? "") })
              : stepLine({ tool: String(e.tool ?? ""), detail: String(e.detail ?? "") })}
        </li>
      ))}
    </ol>
  );
}

function FollowUp({ noteId, runId, agent, onClose }: { noteId: string; runId: string; agent: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t) return;
    runActions.get(noteId)?.followUp(runId, t);
    onClose();
  };
  return (
    <form
      className="charlie-followup"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <input
        autoFocus
        value={text}
        placeholder={`Follow up with ${agent}…`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
      />
      <button className="btn btn-sm btn-primary" type="submit" disabled={!text.trim()}>
        Send
      </button>
      <button className="icon-btn" type="button" onClick={onClose} aria-label="Cancel" title="Cancel">
        <IconX size={13} />
      </button>
    </form>
  );
}

function RunCard({ runId, noteId, task, agent, status, error, sessionId, durationMs, notice, onDismiss }: CardProps) {
  const live = useRun(runId);
  const [now, setNow] = useState(() => Date.now());
  const [showAll, setShowAll] = useState(false);
  const [asking, setAsking] = useState(false);

  // A card saved as "running" whose run isn't alive was interrupted (char was quit mid-task), or
  // its answer landed and was then undone. Just after finishing, the answer is still landing.
  let state = status;
  if (status === "running") {
    if (live?.status === "running") state = live.queued ? "queued" : "running";
    else if (!live) state = "interrupted";
    else state = live.finishedAt && now - live.finishedAt < 3000 ? "running" : "undone";
  }
  useEffect(() => {
    if (state !== "running" && state !== "queued") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state]);

  const who = live?.agent && live.agent !== "charlie" ? live.agent : agent;

  if (state === "done") {
    return (
      <div className="charlie-footer" contentEditable={false} data-state="done">
        <div className="flex items-center gap-1.5">
          <span className="charlie-badge">
            <IconTerminal size={12} /> charlie
          </span>
          <span className="label truncate" title={task}>
            {who}
            {durationMs ? ` · ${elapsed(durationMs)}` : ""}
          </span>
          <span className="flex-1" />
          <button className="btn btn-ghost btn-sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            Steps
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setAsking((v) => !v)} title={sessionId ? "Continues the same conversation" : "Asks again with this note as context"}>
            <IconRetry size={12} /> Follow up
          </button>
          <button className="icon-btn" onClick={onDismiss} aria-label="Remove footer" title="Remove (the answer stays)">
            <IconX size={13} />
          </button>
        </div>
        {notice && <p className="charlie-notice">{notice}</p>}
        {showAll && <Steps runId={runId} live={live} all />}
        {asking && <FollowUp noteId={noteId} runId={runId} agent={who} onClose={() => setAsking(false)} />}
      </div>
    );
  }

  const busy = state === "running" || state === "queued";
  const quiet = live?.quietSince ? elapsed(now - live.quietSince) : null;
  const message =
    state === "error"
      ? error || live?.error || "Something went wrong."
      : state === "stopped"
        ? "Stopped."
        : state === "interrupted"
          ? "Interrupted when char was closed."
          : state === "undone"
            ? "The answer was removed. Retry to ask again."
            : "";

  return (
    <div className="charlie-card" contentEditable={false} data-state={state}>
      <div className="flex items-center gap-2">
        <span className="charlie-badge">
          <IconTerminal size={13} /> charlie
        </span>
        <span className="label truncate">
          {who}
          {live?.resumed ? " · follow-up" : ""}
        </span>
        <span className="flex-1" />
        {busy ? (
          <>
            {state === "running" && <span className="label tabular-nums">{elapsed(now - (live?.startedAt ?? now))}</span>}
            {!!live?.steps.length && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? "Fewer" : `${live.steps.length} step${live.steps.length === 1 ? "" : "s"}`}
              </button>
            )}
            <button className="btn btn-sm" onClick={() => stopRun(runId)}>
              <IconStop size={12} /> Stop
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
              Steps
            </button>
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
      {busy && <Steps runId={runId} live={live} all={showAll} />}
      {!busy && showAll && <Steps runId={runId} live={live} all />}
      {state === "queued" ? (
        <p className="charlie-line">
          <span className="charlie-dots" aria-hidden />
          Waiting for another charlie run to finish…
        </p>
      ) : busy ? (
        <p className="charlie-line">
          <span className="charlie-dots" aria-hidden />
          {quiet ? `No output for ${quiet}. It may be waiting on something; Stop it if it's stuck.` : live?.line || (live?.steps.length ? "working…" : `starting ${who}…`)}
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
      // Set on the footer an answer leaves behind.
      agentId: { default: "" },
      sessionId: { default: "" },
      durationMs: { default: 0 },
      notice: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => <RunCard {...block.props} onDismiss={() => editor.removeBlocks([block])} />,
    toExternalHTML: ({ block }) =>
      block.props.status === "done" ? (
        <span />
      ) : (
        <p>
          @charlie {block.props.task} ({block.props.status === "running" ? "working…" : block.props.status})
        </p>
      ),
  },
);

/* ---------- schema ---------- */

export const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, agentRun: AgentRun(), subpage: Subpage() },
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

/** Swaps a run's card for its answer and a footer (or marks it failed). Works on a mounted or a headless editor. */
export function applyRunResult(editor: CharEditor, runId: string, result: RunResult) {
  const block = findRun(editor, runId);
  if (!block) return false; // the card was deleted while charlie worked
  const footer = result.footer
    ? [{ type: "agentRun" as const, props: { ...(block.props as Record<string, unknown>), status: "done", error: "", ...result.footer } }]
    : [];
  if (result.kind === "inline") {
    // Whitespace between parsed elements can come back as empty paragraphs (notably headless).
    const parsed = editor.tryParseMarkdownToBlocks(result.markdown).filter(
      (b) => !(b.type === "paragraph" && Array.isArray(b.content) && b.content.every((c) => c.type === "text" && !c.text.trim())),
    );
    editor.replaceBlocks([block], [...(parsed.length ? parsed : [{ type: "paragraph" as const, content: "charlie had nothing to add." }]), ...footer]);
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
        ...footer,
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
 * The task on a line with the @charlie chip, plus any notes it @-links. Only the chip counts, never
 * typed text, so writing to a person called Charlie can't start an agent. The task is what follows
 * the chip; text before it is context ("for the launch: @charlie draft a plan"), or the task itself
 * when nothing follows ("summarise this @charlie").
 */
export function charlieTask(block: { type?: string; content?: unknown }): { task: string; links: string[]; context: string } | null {
  if (!TASK_BLOCKS.has(block.type ?? "") || !Array.isArray(block.content)) return null;
  const parts = block.content as Inline[];
  const at = parts.findIndex((p) => p.type === "charlie");
  if (at < 0) return null;

  const links: string[] = [];
  const read = (list: Inline[]) =>
    list
      .map((p) => {
        if (p.type === "noteLink") {
          if (p.props?.id && p.props.kind !== "folder") links.push(p.props.id);
          return `“${p.props?.title || "Untitled"}”`;
        }
        if (p.type === "link") return (p.content ?? []).map((c) => c.text ?? "").join("");
        if (p.type === "charlie") return "";
        return p.text ?? "";
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  const before = read(parts.slice(0, at)).replace(/[:,–—-]\s*$/, "").trim();
  const after = read(parts.slice(at + 1));
  return after ? { task: after, links, context: before } : { task: before, links, context: "" };
}
