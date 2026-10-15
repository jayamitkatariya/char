"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/dither";

// Softly blurred, tilted app cards drifting at the edges of the manifesto
// (1400px+ only: any narrower and they run into the margin rule).
// Each one moves at its own speed against the scroll for a soft parallax;
// transforms are written straight to the DOM.

const CARDS = [
  { side: "left", top: "7%", rotate: -6, speed: 0.12, blur: 0.5 },
  { side: "right", top: "30%", rotate: 5, speed: -0.08, blur: 0.8 },
  { side: "left", top: "62%", rotate: 4, speed: 0.06, blur: 1.1 },
] as const;

function Reminders() {
  return (
    <div className="w-[230px] rounded-2xl border border-black/5 bg-white p-4 shadow-[0_18px_40px_rgba(60,40,10,0.12)]">
      <div className="text-[18px] font-bold text-[#f08a24]">Reminders</div>
      <ul className="mt-2 space-y-2 text-[13px] text-[#3a342c]">
        {["Send invoice to Dana", "Book the dentist", "Reply to Sam re: review", "Birthday card for Mom"].map((t) => (
          <li key={t} className="flex items-center gap-2 border-b border-black/5 pb-2 last:border-0">
            <span className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-[#f08a24]" />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PricingNote() {
  return (
    <div className="w-[250px] rounded-2xl border border-black/5 bg-[#fffbea] p-4 shadow-[0_18px_40px_rgba(60,40,10,0.12)]">
      <div className="text-[14px] font-bold leading-snug text-[#2b2620]">
        Pricing — rough thoughts <span className="font-normal text-[#a39d93]">(do not share)</span>
      </div>
      <div className="mt-2 space-y-1.5 text-[12.5px] leading-snug text-[#5b544a]">
        <p>$8/mo feels right? maybe $6 for students</p>
        <p>free tier = 50 notes, no assistant</p>
        <p>ask Priya about annual discount</p>
        <p className="text-[#a39d93]">— compare w/ the 3 apps in my bookmarks</p>
      </div>
    </div>
  );
}

function TeamChat() {
  return (
    <div className="w-[240px] overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_18px_40px_rgba(60,40,10,0.12)]">
      <div className="bg-[#5b3fd1] px-4 py-2.5 text-[13px] font-semibold text-white"># launch</div>
      <div className="space-y-2.5 p-3.5 text-[12.5px] leading-snug text-[#3a342c]">
        <p>
          <b className="text-[#5b3fd1]">maya</b> anyone have the final copy for the email?
        </p>
        <p>
          <b className="text-[#0f8b8d]">dev</b> it&rsquo;s in someone&rsquo;s notes. somewhere.
        </p>
        <p>
          <b className="text-[#d0453b]">sam</b> classic
        </p>
      </div>
    </div>
  );
}

const CONTENT = [<Reminders key="r" />, <PricingNote key="p" />, <TeamChat key="t" />];

export default function FloatingCards() {
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const vh = window.innerHeight;
      refs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.parentElement!.getBoundingClientRect();
        const offset = r.top + r.height / 2 - vh / 2;
        el.style.transform = `translate3d(0, ${(offset * CARDS[i].speed).toFixed(1)}px, 0) rotate(${CARDS[i].rotate}deg)`;
      });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    apply();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 hidden select-none min-[1400px]:block" aria-hidden="true">
      {CARDS.map((c, i) => (
        <div
          key={i}
          className="float-slot absolute"
          style={{
            top: c.top,
            [c.side]: "max(1.5rem, calc(50% - 23rem - 330px))",
          }}
        >
          <div
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="will-change-transform"
            style={{ transform: `rotate(${c.rotate}deg)`, filter: `blur(${c.blur}px)`, opacity: 0.85 }}
          >
            {CONTENT[i]}
          </div>
        </div>
      ))}
    </div>
  );
}
