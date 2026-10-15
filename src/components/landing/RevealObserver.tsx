"use client";

import { useEffect } from "react";
import { prefersReducedMotion } from "@/lib/dither";

// One observer for every `[data-reveal]` element on the landing page: it sets
// `data-shown` once the element scrolls into view, and CSS does the rest, so
// the marked-up copy itself stays server-rendered. The `data-reveal-ready` flag
// on the root means that without JS nothing is ever hidden.
export default function RevealObserver() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".landing");
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.setAttribute("data-shown", ""));
      root.setAttribute("data-reveal-ready", "");
      return;
    }
    // anything already above the viewport (restored scroll) is shown instantly
    els.forEach((el) => {
      if (el.getBoundingClientRect().bottom < 0) el.setAttribute("data-shown", "");
    });
    root.setAttribute("data-reveal-ready", "");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-shown", "");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -18% 0px", threshold: 0.2 },
    );
    els.forEach((el) => {
      if (!el.hasAttribute("data-shown")) io.observe(el);
    });
    return () => io.disconnect();
  }, []);
  return null;
}
