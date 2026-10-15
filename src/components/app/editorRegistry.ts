// The editor that has a note open right now, so finished @charlie runs can land in it directly.
// Notes that aren't open are updated in storage instead (see offscreen.ts).

import type { CharEditor } from "./editorSchema";

const open = new Map<string, CharEditor>();

export function registerEditor(noteId: string, editor: CharEditor) {
  open.set(noteId, editor);
  return () => {
    if (open.get(noteId) === editor) open.delete(noteId);
  };
}

export const openEditor = (noteId: string) => open.get(noteId);
