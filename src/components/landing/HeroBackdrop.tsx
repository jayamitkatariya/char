"use client";

import { useEffect, useRef } from "react";
import { bayerAt, createDotGrid, pack, prefersReducedMotion, smoothstep } from "@/lib/dither";

// Halftone glow behind the hero window: a few soft bluish blobs drift slowly
// and lean toward the cursor, over a gray dotted "floor" that fades out at the
// bottom. Ordered (Bayer) dithering turns the smooth field into dots. Runs at
// ~24fps, only while on screen and the tab is visible; static under reduced motion.

const FPS = 24;
const BLUE = pack([104, 146, 238, 215]);
const BLUE_DEEP = pack([74, 116, 226, 240]);
const GRAY = pack([186, 180, 170, 150]);

interface Blob {
  x: number; // anchor, relative to the focus point, in units of the short side
  y: number;
  r: number;
  w: number; // weight
  sx: number; // drift speeds
  sy: number;
  ph: number;
}

const BLOBS: Blob[] = [
  { x: -0.2, y: -0.16, r: 0.24, w: 0.6, sx: 0.11, sy: 0.08, ph: 0 },
  { x: 0.24, y: 0.04, r: 0.22, w: 0.52, sx: 0.07, sy: 0.12, ph: 2.1 },
  { x: -0.04, y: 0.24, r: 0.18, w: 0.42, sx: 0.13, sy: 0.06, ph: 4.2 },
  { x: 0.32, y: -0.3, r: 0.14, w: 0.36, sx: 0.09, sy: 0.1, ph: 1.3 },
];

export default function HeroBackdrop({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const grid = createDotGrid(canvas, { cell: 4, sub: 2, dot: 1 });
    const reduced = prefersReducedMotion();
    let raf = 0;
    let last = 0;
    let visible = true;
    let t0 = performance.now();
    // pointer, in cells; eased so the blobs lean rather than jump
    const mouse = { x: 0, y: 0, tx: 0, ty: 0, active: false };

    const focus = () => {
      // the window sits right of centre on desktop, below the copy on mobile
      const wide = canvas.clientWidth >= 1024;
      return { fx: grid.cols * (wide ? 0.7 : 0.5), fy: grid.rows * (wide ? 0.5 : 0.68) };
    };

    const frame = (time: number) => {
      const t = (time - t0) / 1000;
      const { cols, rows } = grid;
      const { fx, fy } = focus();
      const unit = Math.min(cols, rows * 1.4);
      mouse.x += (mouse.tx - mouse.x) * 0.06;
      mouse.y += (mouse.ty - mouse.y) * 0.06;
      const lean = mouse.active ? 0.12 : 0;

      // precompute blob centres for this frame
      const bs = BLOBS.map((b, i) => {
        let cx = fx + (b.x + Math.sin(t * b.sx + b.ph) * 0.06) * unit;
        let cy = fy + (b.y + Math.cos(t * b.sy + b.ph) * 0.05) * unit;
        cx += (mouse.x - cx) * lean * (1 - i * 0.2);
        cy += (mouse.y - cy) * lean * (1 - i * 0.2);
        const rr = b.r * unit * (1 + Math.sin(t * 0.3 + b.ph) * 0.06);
        return { cx, cy, inv: 1 / (rr * rr), w: b.w };
      });
      const floorTop = fy + unit * 0.3;
      // on wide screens, keep the glow off the copy column
      const wide = cols * grid.cell >= 1024;
      const leftA = wide ? cols * 0.4 : -1;
      const leftB = wide ? cols * 0.56 : 0;

      grid.draw((x, y) => {
        const th = bayerAt(x, y);
        let v = 0;
        for (let i = 0; i < bs.length; i++) {
          const b = bs[i];
          const dx = x - b.cx;
          const dy = (y - b.cy) * 1.15;
          const d = (dx * dx + dy * dy) * b.inv;
          if (d < 4) v += b.w * Math.exp(-d * 1.6);
        }
        if (x < leftB) v *= smoothstep(leftA, leftB, x);
        v = v > 0.8 ? 0.8 : v;
        if (v > th) return v > 0.62 && th < 0.25 ? BLUE_DEEP : BLUE;
        // the floor: a band below the window, fading out downward and at the sides
        if (y > floorTop) {
          const fade = smoothstep(floorTop, floorTop + rows * 0.08, y) * (1 - smoothstep(rows * 0.82, rows, y));
          const side = 1 - smoothstep(0.18, 0.42, Math.abs(x - fx) / cols);
          const f = fade * side * 0.42;
          if (f > th) return GRAY;
        }
        return 0;
      });
    };

    const loop = (time: number) => {
      raf = requestAnimationFrame(loop);
      if (time - last < 1000 / FPS) return;
      last = time;
      frame(time);
    };
    const start = () => {
      if (reduced || raf || !visible || document.hidden) return;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    grid.resize();
    t0 = performance.now() - 8000; // start mid-drift so the first frame isn't symmetric
    frame(performance.now());
    start();

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(canvas);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    const ro = new ResizeObserver(() => {
      grid.resize();
      frame(performance.now());
    });
    ro.observe(canvas);
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = canvas.getBoundingClientRect();
      mouse.tx = (e.clientX - r.left) / grid.cell;
      mouse.ty = (e.clientY - r.top) / grid.cell;
      if (!mouse.active) {
        mouse.x = mouse.tx;
        mouse.y = mouse.ty;
        mouse.active = true;
      }
    };
    const onLeave = () => (mouse.active = false);
    if (!reduced) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={`pointer-events-none block ${className}`} />;
}
