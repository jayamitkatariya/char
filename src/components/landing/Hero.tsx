import { GITHUB_URL } from "@/lib/site";
import Annotation from "./Annotation";
import HeroBackdrop from "./HeroBackdrop";
import HeroDemo from "./HeroDemo";
import Logo from "./Logo";
import TextScramble from "./TextScramble";
import { ArrowRight, GitHub } from "./icons";

export default function Hero() {
  return (
    <section id="hero" className="relative isolate min-h-[100svh] overflow-x-clip" data-mm="hero">
      <HeroBackdrop className="hero-backdrop absolute inset-0 -z-10 h-full w-full" />

      <header className="mx-auto flex max-w-[1240px] items-center justify-between px-5 pt-6 sm:px-8 sm:pt-7">
        <Logo className="text-[26px] sm:text-[28px]" />
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener"
          className="l-underline font-mono text-[12.5px] lowercase text-[var(--l-ink-soft)] hover:text-[var(--l-ink)] lg:hidden"
        >
          github
        </a>
      </header>

      <div className="mx-auto grid max-w-[1240px] items-center gap-x-10 gap-y-24 px-5 pb-16 pt-14 sm:px-8 sm:pt-20 lg:min-h-[calc(100svh-84px)] lg:grid-cols-[minmax(0,11fr)_minmax(0,13fr)] lg:pb-12 lg:pt-6 xl:gap-x-16">
        {/* copy */}
        <div className="hero-copy max-w-[34rem]">
          <a
            href="https://www.jaykatariya.com"
            target="_blank"
            rel="noopener"
            className="group inline-flex items-center gap-2 text-[14px] text-[var(--l-ink-faint)] transition-colors hover:text-[var(--l-ink-soft)]"
          >
            Made by
            <span className="grid h-[18px] w-[18px] place-items-center rounded-[4px] bg-[#5b5bd6] font-mono text-[9px] font-bold leading-none tracking-[-0.04em] text-white">
              jk
            </span>
            <span className="text-[var(--l-ink-soft)] group-hover:text-[var(--l-ink)]">Jay Katariya</span>
          </a>

          <h1 className="mt-5 font-serif text-[clamp(2.6rem,8.6vw,3.4rem)] font-bold leading-[1.03] tracking-[-0.035em] text-[var(--l-ink)] lg:text-[clamp(3rem,4.15vw,4.5rem)]">
            <span className="sm:whitespace-nowrap">Write it down.</span>
            <br />
            <span className="sm:whitespace-nowrap">Watch it get done.</span>
          </h1>

          <p className="mt-5 max-w-[28rem] text-[17px] leading-[1.55] text-[var(--l-ink-soft)]">
            char is a notepad with a brain. Jot things the way you already do — it reads along, remembers what
            matters, and turns loose notes into finished work.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <a href={GITHUB_URL} target="_blank" rel="noopener" className="l-cta group">
              <GitHub className="h-4 w-4" />
              Download for macOS
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </a>
          </div>
          <p className="mt-3.5 font-mono text-[11.5px] lowercase tracking-[0.02em] text-[var(--l-ink-faint)]">
            <TextScramble text="free & open source · notes stay on your mac" />
          </p>
        </div>

        {/* demo */}
        <div className="relative mx-auto w-full max-w-[660px] lg:mt-16">
          <Annotation />
          <HeroDemo />
        </div>
      </div>
    </section>
  );
}
