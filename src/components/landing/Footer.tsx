import { GITHUB_URL } from "@/lib/site";
import FooterWordmark from "./FooterWordmark";

export default function Footer() {
  return (
    <footer className="relative overflow-hidden" data-mm="footer">
      <nav
        aria-label="Footer"
        className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-5 pb-6 font-mono text-[11.5px] lowercase text-[var(--l-ink-faint)] sm:px-8"
      >
        <span>© 2026 char</span>
        <a href="https://www.jaykatariya.com" target="_blank" rel="noopener" className="l-underline hover:text-[var(--l-ink)]">
          made by jay katariya
        </a>
        <span className="flex-1" />
        <a href={GITHUB_URL} target="_blank" rel="noopener" className="l-underline hover:text-[var(--l-ink)]">
          source on github
        </a>
      </nav>
      <h2 className="sr-only">char</h2>
      <FooterWordmark />
    </footer>
  );
}
