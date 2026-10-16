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

/** Ticks (or unticks) one checklist item in a note that isn't open, from the Tasks view. */
export function setTaskInStoredNote(note: Note, blockId: string, checked: boolean) {
  const editor = headless(note);
  const block = editor?.getBlock(blockId);
  if (!editor || !block || block.type !== "checkListItem") return null;
  editor.updateBlock(block, { props: { checked } });
  return saved(editor);
}
