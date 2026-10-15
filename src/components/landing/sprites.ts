// 16×16 pixel-art frames for <PixelSprite />, ported from the portfolio.
// `#` = ink (currentColor), `o` = accent, `.` = empty.

const N = 16;
type Cell = "#" | "o" | ".";
type Grid = Cell[][];

const blank = (): Grid => Array.from({ length: N }, () => Array<Cell>(N).fill("."));
const toFrame = (g: Grid) => g.map((row) => row.join(""));

/** stamp a string pattern with its top-left at (r, c); `.` leaves the cell alone */
function stamp(g: Grid, r: number, c: number, pattern: string[]): Grid {
  pattern.forEach((line, dy) =>
    [...line].forEach((ch, dx) => {
      if (ch === "#" || ch === "o") g[r + dy][c + dx] = ch;
    }),
  );
  return g;
}

function dots(g: Grid, pts: [number, number][], ch: Cell = "#"): Grid {
  pts.forEach(([r, c]) => (g[r][c] = ch));
  return g;
}

// ── waver (front view, waves with its right hand) ──
function waverBase(): Grid {
  const g = blank();
  stamp(g, 3, 5, [".####.", "######", "#.##.#", "######", ".####."]);
  stamp(g, 8, 5, ["######", "######", "######", "######"]);
  stamp(g, 12, 5, ["##..##", "##..##"]);
  dots(g, [[9, 4], [10, 4], [11, 4]]);
  return g;
}
const waveUp = () => {
  const g = waverBase();
  dots(g, [[9, 11], [8, 11], [7, 12], [6, 12]]);
  dots(g, [[5, 12], [4, 12]], "o");
  return g;
};
const waveOut = () => {
  const g = waverBase();
  dots(g, [[9, 11], [8, 12], [7, 13], [6, 14]]);
  dots(g, [[5, 14], [4, 14]], "o");
  return g;
};
export const waver: string[][] = [waveUp, waveOut, waveUp, waveOut].map((f) => toFrame(f()));

// ── thinker (idea → lightbulb) ──
function thinker(extra: (g: Grid) => void): Grid {
  const g = blank();
  stamp(g, 6, 5, [".####.", "######", "#.##.#", "######", ".####."]);
  stamp(g, 11, 5, ["######", "######", "######"]);
  stamp(g, 14, 5, ["##..##", "##..##"]);
  dots(g, [[12, 4], [13, 4]]);
  dots(g, [[13, 11], [12, 11], [11, 11], [10, 10]]);
  extra(g);
  return g;
}
const bulbOff = (g: Grid) => stamp(g, 0, 5, [".####.", "#....#", "#....#", ".####.", "..##.."]);
const bulbOn = (g: Grid) => {
  stamp(g, 0, 5, [".oooo.", "oooooo", "oooooo", ".oooo."]);
  stamp(g, 4, 5, ["..##.."]);
};
const thinkA = () => thinker((g) => dots(g, [[5, 11]]));
const thinkB = () => thinker((g) => dots(g, [[5, 11], [3, 12]]));
const ideaOff = () => thinker(bulbOff);
const ideaOn = () =>
  thinker((g) => {
    bulbOn(g);
    dots(g, [[1, 3], [1, 12]], "o");
  });
const ideaGlow = () =>
  thinker((g) => {
    bulbOn(g);
    dots(g, [[1, 2], [1, 3], [1, 12], [1, 13], [0, 4], [0, 11], [3, 4], [3, 11]], "o");
  });
export const thinkerIdea: string[][] = [thinkA, thinkB, ideaOff, ideaOn, ideaGlow, ideaOn, ideaGlow, ideaOn].map((f) =>
  toFrame(f()),
);
