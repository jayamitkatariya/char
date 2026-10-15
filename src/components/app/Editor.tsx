"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { useEffect, useMemo, useRef } from "react";
import { filterSuggestionItems, type PartialBlock } from "@blocknote/core";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { BlockNoteView, type Theme } from "@blocknote/mantine";
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { agentId, agentLabel, buildPrompt, isRunning, startRun, stopRun } from "@/lib/charlie";
import type { Folder, Note } from "@/lib/types";
import { newId } from "@/lib/useWorkspace";
import { IconFolder, IconNote, IconPlus, IconTerminal, IconWand } from "../icons";
import { charlieTask, findRun, registerRunActions, schema, type CharEditor } from "./editorSchema";
import { registerEditor } from "./editorRegistry";
import { collectLinks, type LinkKind } from "./linkStore";
import { tidy } from "./tidy";

const theme: Theme = {
  colors: {
    editor: { text: "#2b2620", background: "transparent" },
    menu: { text: "#2b2620", background: "#ffffff" },
    tooltip: { text: "#ffffff", background: "#2e2a23" },
    hovered: { text: "#2b2620", background: "#f7f5f0" },
    selected: { text: "#2b2620", background: "#efece5" },
    disabled: { text: "#a29c92", background: "#f7f5f0" },
    shadow: "rgba(43, 38, 32, 0.14)",
    border: "rgba(43, 38, 32, 0.09)",
    sideMenu: "#b8b2a8",
    highlights: { yellow: { text: "#2b2620", background: "#fdeec0" }, green: { text: "#2b2620", background: "#d9ead0" } },
  },
  borderRadius: 10,
  fontFamily: "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
};

export type EditorChange = { content: string; blocks: string; links: string[] };

type Block = CharEditor["document"][number];

type Props = {
  note: Note;
  notes: Note[];
  folders: Folder[];
  folderPath: (id: string) => string;
  onChange: (change: EditorChange) => void;
  onCreateNote: (title: string) => Note | Promise<Note>;
  onToast: (msg: string) => void;
  /** Lets the parent push text in (e.g. "insert AI answer"). */
  registerInsert?: (fn: ((markdown: string) => void) | null) => void;
};

export default function Editor({ note, notes, folders, folderPath, onChange, onCreateNote, onToast, registerInsert }: Props) {
  const initial = useMemo(() => {
    if (!note.blocks) return undefined;
    try {
      const parsed = JSON.parse(note.blocks) as PartialBlock<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>[];
      return parsed.length ? parsed : undefined;
    } catch {
      return undefined;
    }
    // Only on mount: the editor owns the document after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editor = useCreateBlockNote({ schema, initialContent: initial }, []) as CharEditor;
  const silent = useRef(false);

  // What a run started from this note needs to know; refreshed every render, read when Enter is pressed.
  const latest = useRef({ note, notes, onToast });
  useEffect(() => {
    latest.current = { note, notes, onToast };
  });

  // Notes from before the block editor only have markdown: convert once.
  useEffect(() => {
    if (initial || !note.content.trim()) return;
    const blocks = editor.tryParseMarkdownToBlocks(note.content);
    if (!blocks.length) return;
    silent.current = true;
    editor.replaceBlocks(editor.document, blocks);
    silent.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    if (!registerInsert) return;
    registerInsert((markdown) => {
      const blocks = editor.tryParseMarkdownToBlocks(markdown);
      const last = editor.document[editor.document.length - 1];
      editor.insertBlocks(blocks, last, "after");
    });
    return () => registerInsert(null);
  }, [editor, registerInsert]);

  // The title's Enter key hands the cursor to the body (needs a real ProseMirror selection, not just DOM focus).
  useEffect(() => {
    const focus = () => {
      const first = editor.document[0];
      if (first) editor.setTextCursorPosition(first, "start");
      editor.focus();
    };
    const runTidy = () => {
      const r = tidy(editor);
      latest.current.onToast(
        r.changed
          ? `Tidied into ${[r.tasks && `${r.tasks} to-do${r.tasks === 1 ? "" : "s"}`, r.bullets && `${r.bullets} bullet${r.bullets === 1 ? "" : "s"}`].filter(Boolean).join(" and ") || "sections"} · ⌘Z to undo`
          : "Nothing to tidy: no loose lines of plain text",
      );
    };
    window.addEventListener("char:focus-editor", focus);
    window.addEventListener("char:tidy", runTidy);
    return () => {
      window.removeEventListener("char:focus-editor", focus);
      window.removeEventListener("char:tidy", runTidy);
    };
  }, [editor]);

  /* ---------- @charlie ---------- */

  type StartOpts = { context?: string; followUp?: { previousTask: string; resume?: string } };

  const startCharlie = (task: string, links: string[], at: { after: Block } | { replace: Block }, opts: StartOpts = {}) => {
    const { note, notes } = latest.current;
    const runId = newId("run");
    const card = { type: "agentRun" as const, props: { runId, noteId: note.id, task, agent: agentLabel(), status: "running" } };
    if ("replace" in at) editor.replaceBlocks([at.replace], [card]);
    else editor.insertBlocks([card], at.after, "after");

    // Leave the cursor on a fresh line below the card, so writing can go on while charlie works.
    const placed = findRun(editor, runId);
    if (placed && "after" in at) {
      const next = editor.getNextBlock(placed);
      const empty = next && next.type === "paragraph" && Array.isArray(next.content) && next.content.length === 0;
      if (!empty) editor.insertBlocks([{ type: "paragraph" }], placed, "after");
      const target = editor.getNextBlock(placed);
      if (target) editor.setTextCursorPosition(target, "start");
    }

    const body = editor.blocksToMarkdownLossy(editor.document.filter((b) => b.type !== "agentRun"));
    const linked = links.map((id) => notes.find((n) => n.id === id)).filter((n): n is Note => !!n && n.id !== note.id);
    const prompt = buildPrompt({
      task,
      title: note.title,
      note: body,
      linked: linked.map((n) => ({ title: n.title, content: n.content })),
      context: opts.context,
      followUp: opts.followUp && { previousTask: opts.followUp.previousTask, resumed: !!opts.followUp.resume },
    });
    startRun({ id: runId, noteId: note.id, task }, prompt, { resume: opts.followUp?.resume });
  };

  // From ⌘K: a "@charlie <task>" line at the end of the note, sent at once if there's a task.
  // Subscribed every render, so it always starts runs with the current note.
  useEffect(() => {
    const charlie = (e: Event) => {
      const task = ((e as CustomEvent<{ task?: string }>).detail?.task ?? "").trim();
      const last = editor.document[editor.document.length - 1];
      const lastEmpty = last && last.type === "paragraph" && Array.isArray(last.content) && last.content.length === 0;
      const line = { type: "paragraph" as const, content: [{ type: "charlie" as const, props: {} }, ` ${task}`] };
      if (lastEmpty) editor.replaceBlocks([last], [line]);
      else editor.insertBlocks([line], last, "after");
      const block = editor.document[editor.document.length - 1];
      editor.setTextCursorPosition(block, "end");
      editor.focus();
      if (task) startCharlie(task, [], { after: block });
    };
    window.addEventListener("char:charlie", charlie);
    return () => window.removeEventListener("char:charlie", charlie);
  });

  useEffect(
    () =>
      registerRunActions(note.id, {
        retry: (runId) => {
          const card = findRun(editor, runId);
          if (!card) return;
          const prev = editor.getPrevBlock(card);
          const ask = prev ? charlieTask(prev) : null;
          startCharlie((card.props as { task: string }).task, ask?.links ?? [], { replace: card }, { context: ask?.context });
        },
        // From the footer under an answer: continue that agent's conversation if it's still the
        // agent charlie uses (sessions belong to one agent), otherwise ask afresh with the note.
        followUp: (runId, text) => {
          const footer = findRun(editor, runId);
          if (!footer) return;
          const p = footer.props as { task: string; sessionId?: string; agentId?: string };
          const resume = p.sessionId && p.agentId === agentId() ? p.sessionId : undefined;
          startCharlie(text, [], { after: footer }, { followUp: { previousTask: p.task, resume } });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, note.id],
  );

  useEffect(() => registerEditor(note.id, editor), [editor, note.id]);

  const menuOpen = () => !!editor.getExtension(SuggestionMenu)?.shown();

  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    // Typing in a card's own fields (the follow-up box) isn't typing in the note.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    // Enter on a "@charlie …" line sends it instead of starting a new line.
    if (e.key === "Enter" && !e.shiftKey && !menuOpen()) {
      const block = editor.getTextCursorPosition().block;
      const ask = charlieTask(block);
      if (!ask) return;
      e.preventDefault();
      e.stopPropagation();
      if (!ask.task) return latest.current.onToast("Write what charlie should do after @charlie, then press Enter");
      startCharlie(ask.task, ask.links, { after: block }, { context: ask.context });
      return;
    }
    if (e.key === " " && !menuOpen()) {
      const { block } = editor.getTextCursorPosition();
      if (!["paragraph", "bulletListItem", "numberedListItem", "checkListItem"].includes(block.type) || !Array.isArray(block.content) || block.content.length !== 1) return;
      const only = block.content[0] as { type: string; text?: string };
      const text = only.type === "text" ? (only.text ?? "") : "";
      // The cursor must sit right after the text (ProseMirror's own selection, not the DOM's).
      const sel = editor.prosemirrorState.selection;
      if (!text || !sel.empty || sel.$from.parentOffset !== text.length) return;
      // "todo: " at the start of a line makes it a checkbox, like "[] " already does.
      if (/^(?:todo|to-do|task):$/i.test(text)) {
        e.preventDefault();
        editor.updateBlock(block, { type: "checkListItem", props: { checked: false }, content: [] });
        editor.setTextCursorPosition(block, "start");
      }
      // A typed "@charlie " (lowercase, with the @ menu dismissed) becomes the chip, so a line only
      // goes to the agent when you can see it will.
      else if (text === "@charlie") {
        e.preventDefault();
        editor.updateBlock(block, { content: [{ type: "charlie", props: {} }, " "] });
        editor.setTextCursorPosition(block, "end");
      }
    }
  };

  /* ---------- saving ---------- */

  // Runs whose card is in this note right now. A card that disappears while its run is still
  // working (deleted, cut, undone) stops the run: the answer would have nowhere to go.
  const liveCards = useRef(new Set<string>());
  const watchCards = (doc: Block[]) => {
    const now = new Set<string>();
    const walk = (blocks: Block[]) => {
      for (const b of blocks) {
        if (b.type === "agentRun" && (b.props as { status: string }).status === "running") now.add((b.props as { runId: string }).runId);
        walk(b.children as Block[]);
      }
    };
    walk(doc);
    for (const id of liveCards.current) if (!now.has(id) && isRunning(id)) void stopRun(id);
    liveCards.current = now;
  };

  const emit = () => {
    if (silent.current) return;
    const doc = editor.document;
    watchCards(doc);
    onChange({ content: editor.blocksToMarkdownLossy(doc), blocks: JSON.stringify(doc), links: collectLinks(doc) });
  };

  /* ---------- menus ---------- */

  const insertLink = (kind: LinkKind, id: string, title: string) => {
    editor.insertInlineContent([{ type: "noteLink", props: { id, kind, title } }, " "]);
  };

  const charlieItems = (query: string): DefaultReactSuggestionItem[] => {
    const q = query.trimStart();
    const [word, ...rest] = q.split(/\s+/);
    if (!"charlie".startsWith((word ?? "").toLowerCase())) return [];
    const task = rest.join(" ").trim();
    if (word.toLowerCase() === "charlie" && task) {
      return [
        {
          title: `charlie: ${task}`,
          subtext: `Then press Enter to send it to ${agentLabel()}`,
          group: "Agent",
          icon: <IconTerminal size={16} />,
          // Puts the chip and the task in the line; sending stays a separate, deliberate Enter.
          onItemClick: () => editor.insertInlineContent([{ type: "charlie", props: {} }, ` ${task}`]),
        },
      ];
    }
    return [
      {
        title: "charlie",
        subtext: `Hand a task to ${agentLabel()}: type it, then press Enter`,
        group: "Agent",
        icon: <IconTerminal size={16} />,
        onItemClick: () => editor.insertInlineContent([{ type: "charlie", props: {} }, " "]),
      },
    ];
  };

  const getLinkItems = async (query: string): Promise<DefaultReactSuggestionItem[]> => {
    const agent = charlieItems(query);
    const q = query.trim().toLowerCase();
    const noteItems = notes
      .filter((n) => n.id !== note.id && (n.title || "Untitled").toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8)
      .map<DefaultReactSuggestionItem>((n) => ({
        title: n.title || "Untitled",
        subtext: folderPath(n.folderId),
        group: "Link a note",
        icon: <IconNote size={16} />,
        onItemClick: () => insertLink("note", n.id, n.title),
      }));
    const folderItems = folders
      .filter((f) => f.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map<DefaultReactSuggestionItem>((f) => ({
        title: f.name,
        subtext: folderPath(f.id),
        group: "Link a folder",
        icon: <IconFolder size={16} />,
        onItemClick: () => insertLink("folder", f.id, f.name),
      }));
    const create: DefaultReactSuggestionItem[] = q
      ? [
          {
            title: `New note “${query.trim()}”`,
            subtext: "Create it and link it here",
            group: "Create",
            icon: <IconPlus size={16} />,
            onItemClick: async () => {
              const created = await onCreateNote(query.trim());
              insertLink("note", created.id, created.title);
            },
          },
        ]
      : [];
    return [...agent, ...noteItems, ...folderItems, ...create];
  };

  const getSlashItems = async (query: string) =>
    filterSuggestionItems(
      [
        {
          title: "Tidy into to-dos",
          subtext: "Turn loose lines into checklists and bullets (⌘⇧T)",
          aliases: ["tidy", "tasks", "todo", "checklist", "bullets", "format", "clean"],
          group: "char",
          icon: <IconWand size={18} />,
          onItemClick: () => window.dispatchEvent(new Event("char:tidy")),
        },
        {
          title: "Ask charlie",
          subtext: `Hand a task to ${agentLabel()}`,
          aliases: ["charlie", "agent", "claude", "codex", "opencode", "hermes", "run"],
          group: "char",
          icon: <IconTerminal size={18} />,
          onItemClick: () => editor.insertInlineContent([{ type: "charlie", props: {} }, " "]),
        },
        ...getDefaultReactSlashMenuItems(editor),
      ],
      query,
    );

  return (
    <div className="char-editor -mx-[54px]" onKeyDownCapture={onKeyDownCapture}>
      <BlockNoteView editor={editor} theme={theme} onChange={emit} slashMenu={false}>
        <SuggestionMenuController triggerCharacter="/" getItems={getSlashItems} />
        <SuggestionMenuController triggerCharacter="@" getItems={getLinkItems} />
      </BlockNoteView>
    </div>
  );
}
