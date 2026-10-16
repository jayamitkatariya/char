// Lands a finished @charlie run in a note that isn't open, using a headless editor so the
// stored blocks and markdown stay exactly what the visible editor would have produced.
// Loaded with import() because BlockNote can't be imported during the static build.

import { BlockNoteEditor } from "@blocknote/core";
import type { Note } from "@/lib/types";
import { applyRunResult, schema, type CharEditor, type RunResult } from "./editorSchema";
import { collectLinks } from "./linkStore";

function headless(note: Note) {
  if (!note.blocks) return null;
  let initialContent;
  try {
    initialContent = JSON.parse(note.blocks);
  } catch {
    return null;
  }
  if (!Array.isArray(initialContent) || !initialContent.length) return null;
  return BlockNoteEditor.create({ schema, initialContent }) as unknown as CharEditor;
}

const saved = (editor: CharEditor) => {
  const doc = editor.document;
  return { blocks: JSON.stringify(doc), content: editor.blocksToMarkdownLossy(doc), links: collectLinks(doc) };
};

export function applyRunToStoredNote(note: Note, runId: string, result: RunResult) {
  const editor = headless(note);
  if (!editor || !applyRunResult(editor, runId, result)) return null;
  return saved(editor);
}

type Blocks = Parameters<CharEditor["replaceBlocks"]>[1];

/** Markdown from outside (the char command) as real blocks: replacing the note, or added at an end. */
export function writeMarkdown(editor: CharEditor, markdown: string, mode: "replace" | "append" | "prepend") {
  const blocks = editor.tryParseMarkdownToBlocks(markdown) as Blocks;
  if (!blocks.length && mode !== "replace") return;
  const doc = editor.document;
  const isEmpty = (b: (typeof doc)[number] | undefined) => !!b && b.type === "paragraph" && Array.isArray(b.content) && b.content.length === 0;
  if (mode === "replace" || (doc.length === 1 && isEmpty(doc[0]))) {
    editor.replaceBlocks(doc, blocks.length ? blocks : [{ type: "paragraph" }]);
  } else if (mode === "append") {
    const last = doc[doc.length - 1];
    if (isEmpty(last)) editor.replaceBlocks([last], blocks);
    else editor.insertBlocks(blocks, last, "after");
  } else {
    editor.insertBlocks(blocks, doc[0], "before");
  }
}

/** The same, for a note that isn't open. Older markdown-only notes are converted first. */
export function writeMarkdownToStoredNote(note: Note, markdown: string, mode: "replace" | "append" | "prepend") {
  let editor = headless(note);
  if (!editor) {
    editor = BlockNoteEditor.create({ schema }) as unknown as CharEditor;
    if (note.content.trim()) editor.replaceBlocks(editor.document, editor.tryParseMarkdownToBlocks(note.content) as Blocks);
  }
  writeMarkdown(editor, markdown, mode);
  return saved(editor);
}

/** Ticks (or unticks) one checklist item in a note that isn't open, from the Tasks view. */
export function setTaskInStoredNote(note: Note, blockId: string, checked: boolean) {
  const editor = headless(note);
  const block = editor?.getBlock(blockId);
  if (!editor || !block || block.type !== "checkListItem") return null;
  editor.updateBlock(block, { props: { checked } });
  return saved(editor);
}
