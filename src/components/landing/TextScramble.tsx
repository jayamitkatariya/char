"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/lib/dither";

const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789·/*+#";

// Decodes `text` from random characters on mount. Screen readers get the real
// text from a visually-hidden copy; the animated glyphs are aria-hidden.
export default function TextScramble({
  text,
  className = "",
  duration = 900,
  delay = 350,
}: {
  text: string;
  className?: string;
  duration?: number;
  delay?: number;
}) {
  const [shown, setShown] = useState(text);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let frame = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = now - start - delay;
      const progress = Math.min(Math.max(t / duration, 0), 1);
      const revealed = Math.floor(progress * text.length);
      let out = "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        out += i < revealed || ch === " " || ch === "·" ? ch : CHARS[Math.floor(Math.random() * CHARS.length)];
      }
      setShown(out);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else setShown(text);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, duration, delay]);

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}
