import type { Note } from "./types";

// Every checklist item across the notes, for the Tasks view and the count on Today.

export type Task = {
  noteId: string;
  /** The checklist block, when the note has blocks (so it can be ticked from the Tasks view). */
  blockId: string | null;
  text: string;
  checked: boolean;
};

type Inline = { type?: string; text?: string; props?: { title?: string }; content?: Inline[] };
type Block = { id?: string; type?: string; props?: { checked?: boolean }; content?: Inline[] | unknown; children?: Block[] };

const inlineText = (list: Inline[]): string =>
  list
    .map((i) => (i.type === "text" ? (i.text ?? "") : i.type === "link" ? inlineText(i.content ?? []) : i.type === "noteLink" ? (i.props?.title ?? "") : ""))
    .join("");

const cache = new WeakMap<Note, Task[]>();

export function tasksIn(note: Note): Task[] {
  const hit = cache.get(note);
  if (hit) return hit;
  const out: Task[] = [];
  let blocks: Block[] | null = null;
  if (note.blocks) {
    try {
      blocks = JSON.parse(note.blocks);
    } catch {}
  }
  if (Array.isArray(blocks)) {
    const walk = (list: Block[]) => {
      for (const b of list) {
        if (b.type === "checkListItem") {
          const text = Array.isArray(b.content) ? inlineText(b.content as Inline[]).trim() : "";
          if (text) out.push({ noteId: note.id, blockId: b.id ?? null, text, checked: !!b.props?.checked });
        }
        if (b.children?.length) walk(b.children);
      }
    };
    walk(blocks);
  } else {
    // Older notes only have markdown.
    for (const m of note.content.matchAll(/^\s*[-*] \[( |x|X)\] (.+)$/gm)) {
      out.push({ noteId: note.id, blockId: null, text: m[2].trim(), checked: m[1] !== " " });
    }
  }
  cache.set(note, out);
  return out;
}

export const allTasks = (notes: Note[]) => notes.flatMap(tasksIn);
