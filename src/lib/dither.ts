// Small ordered-dither toolkit for the landing page's halftone canvases.
// Ported from the portfolio (bayerAt / prefersReducedMotion), plus a dot-grid
// renderer that paints into a low-res buffer and scales it up crisply, so a
// full-bleed canvas costs a few hundred KB per frame instead of tens of MB.

// 8x8 Bayer matrix, normalised to (0, 1)
const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => (v + 0.5) / 64);

export function bayerAt(x: number, y: number): number {
  return BAYER8[(y & 7) * 8 + (x & 7)];
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type RGBA = [number, number, number, number];

/** Pack an RGBA colour for a little-endian Uint32Array view over ImageData. */
export function pack([r, g, b, a]: RGBA): number {
  return ((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}

export interface DotGrid {
  /** dither cells across / down */
  cols: number;
  rows: number;
  /** css px per cell */
  cell: number;
  /** re-measure the canvas; returns true when the grid size changed */
  resize: () => boolean;
  /**
   * Paint one frame. `shade(x, y)` returns a packed colour (0 = no dot) for
   * the cell at (x, y).
   */
  draw: (shade: (x: number, y: number) => number) => void;
}

/**
 * A grid of square dots: each `cell` css px holds a `dot`/`sub` sized dot in
 * its top-left corner. The buffer is `sub` pixels per cell and is blitted with
 * smoothing off.
 */
export function createDotGrid(
  canvas: HTMLCanvasElement,
  { cell, sub, dot }: { cell: number; sub: number; dot: number },
): DotGrid {
  const ctx = canvas.getContext("2d")!;
  const buf = document.createElement("canvas");
  const bctx = buf.getContext("2d")!;
  let img: ImageData | null = null;
  let px: Uint32Array | null = null;

  const grid: DotGrid = {
    cols: 0,
    rows: 0,
    cell,
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      const cols = Math.max(1, Math.ceil(cw / cell));
      const rows = Math.max(1, Math.ceil(ch / cell));
      canvas.width = Math.max(1, Math.round(cw * dpr));
      canvas.height = Math.max(1, Math.round(ch * dpr));
      if (cols === grid.cols && rows === grid.rows && img) return false;
      grid.cols = cols;
      grid.rows = rows;
      buf.width = cols * sub;
      buf.height = rows * sub;
      img = bctx.createImageData(buf.width, buf.height);
      px = new Uint32Array(img.data.buffer);
      return true;
    },
    draw(shade) {
      if (!img || !px) return;
      px.fill(0);
      const bw = buf.width;
      for (let y = 0; y < grid.rows; y++) {
        for (let x = 0; x < grid.cols; x++) {
          const c = shade(x, y);
          if (!c) continue;
          const base = y * sub * bw + x * sub;
          for (let dy = 0; dy < dot; dy++) {
            const row = base + dy * bw;
            for (let dx = 0; dx < dot; dx++) px[row + dx] = c;
          }
        }
      }
      bctx.putImageData(img, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      const scale = canvas.width / canvas.clientWidth; // device px per css px
      ctx.drawImage(buf, 0, 0, grid.cols * cell * scale, grid.rows * cell * scale);
    },
  };
  return grid;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
