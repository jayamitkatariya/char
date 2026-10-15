// "Tidy": turns loose lines of plain text into checklists, bullets and small headings.
// Deterministic and offline. Only plain paragraphs change; lists, headings, code, tables and
// @charlie lines are left alone, and it's a single undo step.

import { charlieTask, type CharEditor } from "./editorSchema";

type Styled = { type: "text"; text: string; styles: Record<string, unknown> };
type Inline = Styled | { type: string; [k: string]: unknown };
type Line = Inline[];
type NewBlock = { type: "paragraph" | "checkListItem" | "bulletListItem" | "numberedListItem" | "heading"; props?: Record<string, unknown>; content: Line };

const VERBS = [
  "add", "apply", "ask", "back up", "backup", "bill", "book", "bring", "build", "buy", "call", "cancel", "change", "charge", "check", "clean", "collect",
  "commit", "complete", "confirm", "contact", "cook", "create", "declutter", "deploy", "deposit", "design", "do", "download", "draft", "drop off", "email",
  "feed", "file", "fill out", "finish", "fix", "follow up", "get", "grab", "install", "invite", "invoice", "learn", "make", "meet", "merge", "message",
  "move", "order", "organize", "pack", "pay", "pick up", "plan", "post", "practice", "prepare", "print", "publish", "push", "read", "refactor", "register",
  "release", "remind", "remove", "renew", "repair", "replace", "reply", "research", "reserve", "respond", "return", "review", "schedule", "send", "set up",
  "setup", "share", "ship", "sign", "sort", "start", "study", "submit", "take", "test", "text", "tidy", "transfer", "try", "update", "upload", "visit",
  "wash", "watch", "water", "write",
];
const VERB_START = new RegExp(`^(?:please\\s+)?(?:${VERBS.join("|")})\\b`, "i");
const INTENT = /\b(?:need(?:s)? to|have to|has to|gotta|got to|must|should|remember to|don'?t forget to|remind me to|asap|deadline|due (?:on|by)|by (?:mon|tue|wed|thu|fri|sat|sun)\w*|by (?:tomorrow|tonight|today|eod|eow|end of))\b/i;
// "I need to call mom" reads better on a checklist as "Call mom".
const LEAD_IN = /^(?:(?:i|we)\s+)?(?:really\s+)?(?:need(?:s)? to|have to|has to|gotta|got to|must|should|remember to|don'?t forget to|remind me to)\s+/i;
const TASKY_LABEL = /^(?:to-?dos?|tasks?|action items?|next steps?|errands|groceries|shopping(?: list)?|to buy|buy|packing(?: list)?|checklist|chores)$/i;

// Leading markers people type by hand, and what they mean.
const MARKERS: [RegExp, "done" | "todo" | "bullet" | "number"][] = [
  [/^\s*(?:[-*]\s*)?\[[xX✓✔]\]\s*/, "done"],
  [/^\s*(?:☑|✅|✓|✔|done:)\s*/i, "done"],
  [/^\s*(?:[-*]\s*)?\[\s?\]\s*/, "todo"],
  [/^\s*(?:☐|□|◻)\s*/, "todo"],
  [/^\s*(?:todo|to-do|task):\s*/i, "todo"],
  [/^\s*(?:[-*•–·▪◦>])\s+/, "bullet"],
  [/^\s*\d{1,3}[.)]\s+/, "number"],
];

const plain = (line: Line): string =>
  line
    .map((i) => {
      if (i.type === "text") return (i as Styled).text;
      if (i.type === "link") return plain(((i as { content?: Line }).content ?? []) as Line);
      return i.type === "noteLink" ? "link" : "";
    })
    .join("");

function splitLines(content: Inline[]): Line[] {
  const lines: Line[] = [[]];
  for (const item of content) {
    if (item.type !== "text") {
      lines[lines.length - 1].push(item);
      continue;
    }
    const s = item as Styled;
    s.text.split("\n").forEach((piece, i) => {
      if (i > 0) lines.push([]);
      if (piece) lines[lines.length - 1].push({ ...s, text: piece });
    });
  }
  return lines.filter((l) => plain(l).trim() || l.some((i) => i.type !== "text"));
}

/** Rewrites the start of a line (markers, lead-ins, capitalisation) without touching later styling. */
function editStart(line: Line, edit: (s: string) => string): Line {
  const [first, ...rest] = line;
  if (!first || first.type !== "text") return line;
  const text = edit((first as Styled).text);
  return text ? [{ ...(first as Styled), text }, ...rest] : rest;
}

const capitalise = (s: string) => s.replace(/^(\s*)(\p{Ll})/u, (_m, sp: string, c: string) => sp + c.toUpperCase());
const trimEnd = (line: Line): Line => {
  const last = line[line.length - 1];
  if (!last || last.type !== "text") return line;
  const text = (last as Styled).text.replace(/[\s.;]+$/, "");
  return text ? [...line.slice(0, -1), { ...(last as Styled), text }] : line.slice(0, -1);
};

export function looksLikeTask(text: string) {
  const t = text.trim();
  if (!t || t.length > 140 || /\?$/.test(t)) return false;
  // "Also email Sam" is still a task; the connecting word is only skipped for the check.
  const core = t.replace(/^(?:also|and|then|plus|todo|to-do)\s+/i, "").replace(LEAD_IN, "");
  return VERB_START.test(core) || INTENT.test(t);
}

const task = (line: Line, checked = false): NewBlock => ({
  type: "checkListItem",
  props: { checked },
  content: trimEnd(editStart(line, (s) => capitalise(s.replace(/^\s*(?:todo|to-do)\s+/i, "").replace(LEAD_IN, "")))),
});

function classify(line: Line, inList: boolean): NewBlock {
  const text = plain(line);
  for (const [re, kind] of MARKERS) {
    if (!re.test(text)) continue;
    const body = editStart(line, (s) => s.replace(re, ""));
    if (kind === "done") return task(body, true);
    if (kind === "todo") return task(body);
    if (kind === "number") return { type: "numberedListItem", content: body };
    return looksLikeTask(plain(body)) ? task(body) : { type: "bulletListItem", content: body };
  }
  if (looksLikeTask(text)) return task(line);
  return inList ? { type: "bulletListItem", content: trimEnd(line) } : { type: "paragraph", content: line };
}

/** "Groceries: milk, eggs and bread" → a small heading and one item per thing. */
function inlineList(line: Line): NewBlock[] | null {
  if (line.length !== 1 || line[0].type !== "text") return null;
  // A label, a colon and a space: "Groceries: …" but not "10:30" or "https://".
  const m = /^\s*([^:]{1,39}[^\d\s:]):\s+(.+)$/.exec((line[0] as Styled).text);
  if (!m) return null;
  const items = m[2].split(/\s*,\s*|\s+and\s+(?=[^,]+$)/).map((s) => s.trim().replace(/\.$/, "")).filter(Boolean);
  if (items.length < 3 || items.some((s) => s.length > 60)) return null;
  const styles = (line[0] as Styled).styles;
  const checklist = TASKY_LABEL.test(m[1].trim()) || items.every((s) => looksLikeTask(s));
  return [
    { type: "heading", props: { level: 3 }, content: [{ type: "text", text: m[1].trim(), styles }] },
    ...items.map<NewBlock>((s) => (checklist ? task([{ type: "text", text: s, styles }]) : { type: "bulletListItem", content: [{ type: "text", text: capitalise(s), styles }] })),
  ];
}

// Words that end in a period without ending the sentence.
const ABBREVIATION = /\b(?:dr|mr|mrs|ms|st|jr|sr|vs|etc|approx|no|e\.g|i\.e|a\.m|p\.m)\.$/i;

/** "Call mom. Fix the sink. Buy milk." → three to-dos, when most sentences are tasks. */
function sentences(line: Line): Line[] | null {
  if (line.length !== 1 || line[0].type !== "text") return null;
  const text = (line[0] as Styled).text;
  // Split after . ! or ; only where the next sentence starts with a capital letter or digit.
  const parts: string[] = [];
  let start = 0;
  for (const m of text.matchAll(/[.!;]\s+(?=[\p{Lu}\d])/gu)) {
    const end = m.index + 1;
    if (ABBREVIATION.test(text.slice(start, end))) continue;
    parts.push(text.slice(start, end).trim());
    start = m.index + m[0].length;
  }
  parts.push(text.slice(start).trim());
  const clean = parts.filter(Boolean);
  if (clean.length < 2 || clean.filter(looksLikeTask).length < Math.ceil(clean.length * 0.6)) return null;
  return clean.map((p) => [{ ...(line[0] as Styled), text: p }]);
}

function tidyParagraph(content: Inline[]): NewBlock[] | null {
  const lines = splitLines(content);
  if (!lines.length) return null;

  const out: NewBlock[] = [];
  const multi = lines.length > 1;
  for (const line of lines) {
    const listed = inlineList(line);
    if (listed) {
      out.push(...listed);
      continue;
    }
    const split = sentences(line);
    if (split) {
      out.push(...split.map((l) => classify(l, true)));
      continue;
    }
    // A short line ending in ":" followed by more lines is a label for what comes next.
    const text = plain(line).trim();
    if (multi && /:$/.test(text) && text.length <= 50 && line.length === 1) {
      out.push({ type: "heading", props: { level: 3 }, content: editStart(line, (s) => s.replace(/:\s*$/, "")) });
      continue;
    }
    // In a block of several short lines, every line is a list item.
    out.push(classify(line, multi && text.length <= 120));
  }
  const unchanged = out.length === 1 && out[0].type === "paragraph";
  return unchanged ? null : out;
}

export type TidyResult = { tasks: number; bullets: number; changed: number };

type Block = CharEditor["document"][number];

export function tidy(editor: CharEditor): TidyResult {
  const selected = editor.getSelection()?.blocks as Block[] | undefined;
  const scope = selected && selected.length > 1 ? selected : (editor.document as Block[]);
  const result: TidyResult = { tasks: 0, bullets: 0, changed: 0 };
  editor.transact(() => {
    for (const block of scope) {
      if (block.type !== "paragraph" || block.children.length || !Array.isArray(block.content) || charlieTask(block)) continue;
      const next = tidyParagraph(block.content as Inline[]);
      if (!next) continue;
      result.changed++;
      for (const b of next) {
        if (b.type === "checkListItem") result.tasks++;
        else if (b.type === "bulletListItem" || b.type === "numberedListItem") result.bullets++;
      }
      editor.replaceBlocks([block], next as Parameters<CharEditor["replaceBlocks"]>[1]);
    }
  });
  return result;
}
