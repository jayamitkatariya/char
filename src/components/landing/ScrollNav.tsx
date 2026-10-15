"use client";

import { useEffect, useState } from "react";
import { GITHUB_URL } from "@/lib/site";
import Logo from "./Logo";

// A minimal fixed nav that fades in (with backdrop blur) once the hero has
// scrolled away. While hidden it is inert, so it never steals focus.
export default function ScrollNav() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let frame = 0;
    const apply = () => {
      frame = 0;
      const hero = document.getElementById("hero");
      const edge = hero ? hero.offsetTop + hero.offsetHeight - 72 : window.innerHeight;
      setShown(window.scrollY > edge);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="scroll-nav" data-shown={shown ? "" : undefined} inert={!shown}>
      <nav aria-label="Main" className="mx-auto flex h-14 max-w-[1240px] items-center justify-between px-5 sm:px-8">
        <Logo className="text-[20px]" />
        <div className="flex items-center gap-4 font-mono text-[12px] lowercase text-[var(--l-ink-soft)] sm:gap-6">
          <a href="#manifesto" className="l-underline hidden hover:text-[var(--l-ink)] sm:inline">
            manifesto
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener"
            className="rounded-full bg-[var(--l-cta)] px-3.5 py-1.5 text-white transition-opacity hover:opacity-90"
          >
            get it on github →
          </a>
        </div>
      </nav>
    </div>
  );
}
