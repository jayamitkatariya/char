// Small fuzzy matcher for ⌘K and the move picker: a prefix beats a word start, which beats a
// substring, which beats the letters appearing in order ("wlc" finds "Welcome to char").

export type Match = { score: number; hits: number[] };

const boundary = (t: string, i: number) => i === 0 || /[\s\-_/:.,([{]/.test(t[i - 1]);
const span = (from: number, len: number) => Array.from({ length: len }, (_, i) => from + i);

export function fuzzy(text: string, q: string): Match | null {
  if (!q) return null;
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at === 0) return { score: 100, hits: span(0, q.length) };
  if (at > 0) return { score: boundary(t, at) ? 80 : 60, hits: span(at, q.length) };
  if (q.length < 2) return null;

  // Letters in order, preferring the start of each word.
  const hits: number[] = [];
  let from = 0;
  for (const ch of q) {
    let j = -1;
    for (let k = from; k < t.length; k++) {
      if (t[k] !== ch) continue;
      if (j < 0) j = k;
      if (boundary(t, k)) {
        j = k;
        break;
      }
    }
    if (j < 0) return null;
    hits.push(j);
    from = j + 1;
  }
  const starts = hits.filter((h) => boundary(t, h)).length;
  const gaps = hits[hits.length - 1] - hits[0] + 1 - hits.length;
  // Scattered matches across a long title are noise.
  if (gaps > q.length * 6) return null;
  return { score: Math.max(5, Math.min(50, 30 + starts * 4 - gaps)), hits };
}

/** Renders text with the matched characters highlighted. */
export function Highlight({ text, hits }: { text: string; hits?: number[] }) {
  if (!hits?.length) return <>{text}</>;
  const on = new Set(hits);
  const parts: React.ReactNode[] = [];
  for (let i = 0; i < text.length; ) {
    const lit = on.has(i);
    let j = i;
    while (j < text.length && on.has(j) === lit) j++;
    const s = text.slice(i, j);
    parts.push(
      lit ? (
        <mark key={i} className="rounded-[3px] bg-[var(--highlight)] text-[var(--ink)]">
          {s}
        </mark>
      ) : (
        s
      ),
    );
    i = j;
  }
  return <>{parts}</>;
}
