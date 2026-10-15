"use client";

import { useEffect, useRef } from "react";

// A VS Code-style minimap of the whole page (lg+): blocks and text lines are
// measured from the real layout and drawn into a tiny canvas, with a viewport
// rectangle on top. Click or drag it to scroll. Decorative for assistive tech
// (it duplicates normal scrolling), so it's aria-hidden.

const W = 104;
const MAX_H = 210;

export default function Minimap() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const view = viewRef.current;
    if (!wrap || !canvas || !view) return;
    const ctx = canvas.getContext("2d")!;
    let sy = 1;
    let sx = 1;
    let h = MAX_H;
    let frame = 0;
    let drawFrame = 0;

    const draw = () => {
      drawFrame = 0;
      if (getComputedStyle(wrap).display === "none") return; // hidden below lg
      const doc = document.documentElement;
      const docH = doc.scrollHeight;
      const docW = doc.clientWidth;
      h = Math.min(MAX_H, Math.max(120, Math.round((docH / docW) * W * 0.32)));
      sy = h / docH;
      sx = W / docW;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr;
      canvas.height = h * dpr;
      canvas.style.height = `${h}px`;
      wrap.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, h);
      const top = window.scrollY;
      const rect = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.left * sx, y: (r.top + top) * sy, w: r.width * sx, h: r.height * sy };
      };

      const root = document.querySelector(".landing");
      if (!root) return;
      // section tints
      root.querySelectorAll('[data-mm="paper"]').forEach((el) => {
        const r = rect(el);
        ctx.fillStyle = "rgba(110,140,195,0.10)";
        ctx.fillRect(0, r.y, W, r.h);
        ctx.fillStyle = "rgba(226,104,104,0.45)";
        const col = el.querySelector(".paper-col");
        if (col) ctx.fillRect(rect(col).x - 3, r.y, 0.75, r.h);
      });
      // solid blocks (the app window, the wordmark)
      root.querySelectorAll('[data-mm="block"], [data-mm="footer"] canvas').forEach((el) => {
        const r = rect(el);
        ctx.fillStyle = "rgba(43,38,32,0.10)";
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, 1.5);
        ctx.fill();
      });
      // text, line by line
      root.querySelectorAll("h1, h2:not(.sr-only), p, blockquote, li").forEach((el) => {
        if (el.closest('[data-mm="block"], [aria-hidden="true"], .sr-only')) return;
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
        const r = el.getBoundingClientRect();
        if (!r.height) return;
        const lines = Math.max(1, Math.round(r.height / lh));
        const heavy = /^H/.test(el.tagName) || el.tagName === "BLOCKQUOTE";
        ctx.fillStyle = heavy ? "rgba(43,38,32,0.62)" : "rgba(43,38,32,0.3)";
        const thick = Math.max(0.7, lh * sy * (heavy ? 0.6 : 0.45));
        for (let i = 0; i < lines; i++) {
          const y = (r.top + top + i * lh + lh * 0.3) * sy;
          let w = r.width * sx;
          if (i === lines - 1 && lines > 1) w *= 0.55 + ((i * 37) % 30) / 100;
          const x = cs.textAlign === "center" ? r.left * sx + (r.width * sx - w) / 2 : r.left * sx;
          ctx.fillRect(x, y, w, thick);
        }
      });
      place();
    };

    const place = () => {
      frame = 0;
      view.style.transform = `translateY(${(window.scrollY * sy).toFixed(2)}px)`;
      view.style.height = `${Math.max(8, window.innerHeight * sy)}px`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const redraw = () => {
      if (!drawFrame) drawFrame = requestAnimationFrame(draw);
    };

    let dragging = false;
    const scrollTo = (clientY: number, smooth: boolean) => {
      const y = clientY - wrap.getBoundingClientRect().top;
      window.scrollTo({ top: y / sy - window.innerHeight / 2, behavior: smooth ? "smooth" : "instant" });
    };
    const onDown = (e: PointerEvent) => {
      dragging = true;
      wrap.setPointerCapture(e.pointerId);
      scrollTo(e.clientY, true);
    };
    const onMove = (e: PointerEvent) => {
      if (dragging && e.buttons) scrollTo(e.clientY, false);
    };
    const onUp = () => (dragging = false);

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", redraw);
    const ro = new ResizeObserver(redraw);
    ro.observe(document.body);
    document.fonts?.ready.then(redraw).catch(() => {});
    wrap.addEventListener("pointerdown", onDown);
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerup", onUp);
    wrap.addEventListener("pointercancel", onUp);
    redraw();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", redraw);
      ro.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(drawFrame);
      wrap.removeEventListener("pointerdown", onDown);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerup", onUp);
      wrap.removeEventListener("pointercancel", onUp);
    };
  }, []);

  return (
    <div ref={wrapRef} className="minimap" aria-hidden="true" style={{ width: W, height: MAX_H }}>
      <canvas ref={canvasRef} style={{ width: W, height: MAX_H }} className="block" />
      <div ref={viewRef} className="minimap-view" />
    </div>
  );
}
