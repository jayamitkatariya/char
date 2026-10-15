import { DOWNLOAD_URL } from "@/lib/site";
import { ArrowRight, GitHub } from "./icons";

// "From notes to done." — the o in "notes" is an empty hand-drawn checkbox,
// the o in "done" gets a red check that draws itself once the heading is in view.

function Box({ checked = false }: { checked?: boolean }) {
  return (
    <svg className={`cta-box${checked ? " cta-box-checked" : ""}`} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        className="cta-box-frame"
        d="M7 9.5c8.5-2.2 18.6-2.4 26.6-.8 1.2 8.4 1.1 16.6-.2 24.4-8.7 1.4-17.6 1.3-26 .3C6.2 25.3 5.9 17.3 7 9.5z"
      />
      {checked && <path className="cta-check" pathLength={1} d="M10.5 20.5c3.2 2.6 5.8 5.6 7.6 9.4C22 19.6 28.6 10.8 38 3.5" />}
    </svg>
  );
}

export default function FinalCta() {
  return (
    <section id="start" className="relative px-5 pb-28 pt-28 text-center sm:pb-36 sm:pt-36" data-mm="cta">
      <h2 className="cta-head font-serif font-bold text-[var(--l-ink)]" data-reveal>
        <span className="sr-only">From notes to done.</span>
        <span aria-hidden="true">
          From n<Box />
          tes to d<Box checked />
          ne.
        </span>
      </h2>
      <p className="mx-auto mt-6 max-w-md text-[18px] leading-[1.5] text-[var(--l-ink-faint)] sm:text-[20px]">
        Stop collecting to-dos.
        <br />
        Start crossing them off.
      </p>
      <div className="mt-9 flex justify-center">
        <a href={DOWNLOAD_URL} target="_blank" rel="noopener" className="l-cta group">
          <GitHub className="h-4 w-4" />
          Download for macOS
          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </a>
      </div>
    </section>
  );
}
