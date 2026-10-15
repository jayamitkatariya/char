// Lands a finished @charlie run in a note that isn't open, using a headless editor so the
// stored blocks and markdown stay exactly what the visible editor would have produced.
// Loaded with import() because BlockNote can't be imported during the static build.

import { BlockNoteEditor } from "@blocknote/core";
import type { Note } from "@/lib/types";
import { applyRunResult, schema, type CharEditor, type RunResult } from "./editorSchema";
import { collectLinks } from "./linkStore";

export function applyRunToStoredNote(note: Note, runId: string, result: RunResult) {
  if (!note.blocks) return null;
  let initialContent;
  try {
    initialContent = JSON.parse(note.blocks);
  } catch {
    return null;
  }
  if (!Array.isArray(initialContent) || !initialContent.length) return null;
  const editor = BlockNoteEditor.create({ schema, initialContent }) as unknown as CharEditor;
  if (!applyRunResult(editor, runId, result)) return null;
  const doc = editor.document;
  return { blocks: JSON.stringify(doc), content: editor.blocksToMarkdownLossy(doc), links: collectLinks(doc) };
}
