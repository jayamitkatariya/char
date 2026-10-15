"use client";

import { useEffect, useRef } from "react";
import { bayerAt, createDotGrid, pack, prefersReducedMotion } from "@/lib/dither";

// The giant `{char}` at the foot of the page, as an ordered-dither dot field
// (DitherBand-style). It "develops" from sparse dots when it scrolls into view,
// and the dots fill in denser in a soft flashlight around the cursor.

const LIGHT = pack([214, 208, 198, 255]);
const MID = pack([190, 183, 171, 255]);
const DARK = pack([150, 142, 129, 255]);
const BASE = 0.52; // resting density inside the letters
const RADIUS = 34; // flashlight radius, in cells

export default function FooterWordmark() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const grid = createDotGrid(canvas, { cell: 4, sub: 4, dot: 3 });
    const reduced = prefersReducedMotion();
    let cover = new Float32Array(0);
    let reveal = reduced ? 1 : 0;
    let started = reduced;
    let raf = 0;
    let animRaf = 0;
    let cancelled = false;
    const mouse = { x: -999, y: -999, on: false };

    const layout = () => {
      grid.resize();
      const { cols, rows } = grid;
      const off = document.createElement("canvas");
      off.width = cols;
      off.height = rows;
      const ctx = off.getContext("2d", { willReadFrequently: true })!;
      const family = getComputedStyle(canvas).fontFamily || "monospace";
      const text = "{char}";
      ctx.font = `800 100px ${family}`;
      ctx.letterSpacing = "-6px";
      const m = ctx.measureText(text);
      const size = (100 * cols * 0.98) / (m.width || 1);
      ctx.font = `800 ${size}px ${family}`;
      ctx.letterSpacing = `${-size * 0.06}px`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#000";
      // baseline a little below the canvas, so the page cuts the letters off
      ctx.fillText(text, cols / 2, rows + size * 0.12);
      const data = ctx.getImageData(0, 0, cols, rows).data;
      cover = new Float32Array(cols * rows);
      for (let i = 0; i < cover.length; i++) cover[i] = data[i * 4 + 3] / 255;
    };

    const render = () => {
      raf = 0;
      const { cols } = grid;
      const bias = (1 - reveal) * 0.9;
      const r2 = RADIUS * RADIUS;
      grid.draw((x, y) => {
        const c = cover[y * cols + x];
        if (!c) return 0;
        let dens = BASE;
        let near = 0;
        if (mouse.on) {
          const dx = x - mouse.x;
          const dy = y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < r2) {
            near = 1 - Math.sqrt(d2) / RADIUS;
            near = near * near * (3 - 2 * near);
            dens += (1.02 - BASE) * near;
          }
        }
        const th = bayerAt(x, y);
        if (c * dens - bias <= th) return 0;
        return near > 0.55 ? DARK : near > 0.2 ? MID : LIGHT;
      });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(render);
    };

    const develop = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / 1500);
        reveal = 1 - Math.pow(1 - p, 3);
        render();
        if (p < 1) animRaf = requestAnimationFrame(tick);
      };
      animRaf = requestAnimationFrame(tick);
    };

    const setup = async () => {
      try {
        await document.fonts.ready;
      } catch {
        /* render with whatever font is there */
      }
      if (cancelled) return;
      layout();
      render();
    };
    setup();

    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !started) {
          started = true;
          develop();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(canvas);

    let lastW = canvas.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(canvas.clientWidth - lastW) < 4) return;
      lastW = canvas.clientWidth;
      layout();
      render();
    });
    ro.observe(canvas);

    const onMove = (e: PointerEvent) => {
      if (reduced) return;
      const r = canvas.getBoundingClientRect();
      const inside = e.clientY > r.top - RADIUS * grid.cell && e.clientY < r.bottom + RADIUS * grid.cell;
      if (!inside && !mouse.on) return;
      mouse.on = inside;
      mouse.x = (e.clientX - r.left) / grid.cell;
      mouse.y = (e.clientY - r.top) / grid.cell;
      schedule();
    };
    const onLeave = () => {
      mouse.on = false;
      schedule();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(animRaf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="block h-[26vw] w-full font-mono" />;
}
