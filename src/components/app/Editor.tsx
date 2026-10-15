"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { useEffect, useMemo, useRef } from "react";
import { BlockNoteSchema, defaultInlineContentSpecs, type PartialBlock } from "@blocknote/core";
import { BlockNoteView, type Theme } from "@blocknote/mantine";
import {
  createReactInlineContentSpec,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import type { Folder, Note } from "@/lib/types";
import { IconFolder, IconNote, IconPlus } from "../icons";
import { collectLinks, openLink, useLinkTitle, type LinkKind } from "./linkStore";

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
      <a href={`/notes?${inlineContent.props.kind === "folder" ? "f" : "n"}=${inlineContent.props.id}`}>
        {inlineContent.props.title || "Untitled"}
      </a>
    ),
  },
);

const schema = BlockNoteSchema.create({
  inlineContentSpecs: { ...defaultInlineContentSpecs, noteLink: NoteLink },
});

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

type Props = {
  note: Note;
  notes: Note[];
  folders: Folder[];
  folderPath: (id: string) => string;
  onChange: (change: EditorChange) => void;
  onCreateNote: (title: string) => Note | Promise<Note>;
  /** Lets the parent push text in (e.g. "insert AI answer"). */
  registerInsert?: (fn: ((markdown: string) => void) | null) => void;
};

export default function Editor({ note, notes, folders, folderPath, onChange, onCreateNote, registerInsert }: Props) {
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

  const editor = useCreateBlockNote({ schema, initialContent: initial }, []);
  const silent = useRef(false);

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
    window.addEventListener("char:focus-editor", focus);
    return () => window.removeEventListener("char:focus-editor", focus);
  }, [editor]);

  const emit = () => {
    if (silent.current) return;
    const doc = editor.document;
    onChange({ content: editor.blocksToMarkdownLossy(doc), blocks: JSON.stringify(doc), links: collectLinks(doc) });
  };

  const insertLink = (kind: LinkKind, id: string, title: string) => {
    editor.insertInlineContent([{ type: "noteLink", props: { id, kind, title } }, " "]);
  };

  const getLinkItems = async (query: string): Promise<DefaultReactSuggestionItem[]> => {
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
    return [...noteItems, ...folderItems, ...create];
  };

  return (
    <div className="char-editor -mx-[54px]">
      <BlockNoteView editor={editor} theme={theme} onChange={emit}>
        <SuggestionMenuController triggerCharacter="@" getItems={getLinkItems} />
      </BlockNoteView>
    </div>
  );
}
