import type { CSSProperties, ReactNode } from "react";
import FloatingCards from "./FloatingCards";
import PixelSprite from "./PixelSprite";
import { thinkerIdea, waver } from "./sprites";
import { ImageIcon, Mail, Mic, Note, Sheet, Sparkle } from "./icons";

// The manifesto, set on lined notebook paper. Everything here is server
// markup; the marks (highlighter sweeps, brush/wavy underlines) animate in via
// CSS once RevealObserver tags their paragraph with `data-shown`.

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

function Mark({ tone = "y", delay = 0, children }: { tone?: "y" | "g"; delay?: number; children: ReactNode }) {
  return (
    <span className={`mk mk-${tone}`} style={d(delay)}>
      {children}
    </span>
  );
}

function Brush({ delay = 0, children }: { delay?: number; children: ReactNode }) {
  return (
    <span className="ul-brush" style={d(delay)}>
      {children}
    </span>
  );
}

function Wavy({ delay = 0, children }: { delay?: number; children: ReactNode }) {
  return (
    <span className="ul-wavy" style={d(delay)}>
      {children}
    </span>
  );
}

function Ico({ children, color, bg }: { children: ReactNode; color: string; bg: string }) {
  return (
    <span className="m-ico" style={{ color, background: bg }}>
      {children}
    </span>
  );
}

export default function Manifesto() {
  return (
    <section id="manifesto" className="paper relative" data-mm="paper" aria-labelledby="manifesto-title">
      <FloatingCards />

      <div className="paper-col relative">
        <h2 id="manifesto-title" className="m-head" data-reveal>
          Your notes know everything. They just never <Brush delay={500}>do anything.</Brush>
        </h2>

        <p data-reveal>
          Think about where your week actually lives. Some of it is in a{" "}
          <Ico color="#c98a00" bg="#fff4cc">
            <Note />
          </Ico>{" "}
          <span className="hw">notes app</span>, a list of things you swore you&rsquo;d get to. Some of it is in a chat
          with an{" "}
          <Ico color="#7c5cff" bg="#efeaff">
            <Sparkle />
          </Ico>{" "}
          AI that forgot you the moment you closed the tab. The rest is screenshots{" "}
          <Ico color="#2f7fd6" bg="#e6f0fc">
            <ImageIcon />
          </Ico>
          , voice memos{" "}
          <Ico color="#d0453b" bg="#fde8e6">
            <Mic />
          </Ico>
          , and a <span className="hw2">to-do app</span> you abandoned in March.
        </p>

        <p data-reveal>
          Every one of those is a small promise to your future self, and most of them quietly expire. Not because
          you&rsquo;re disorganized &mdash; because <Mark delay={150}>nothing you write down ever writes back.</Mark>
        </p>

        <p data-reveal>
          We&rsquo;ve had a decade of nicer places to put things: faster sync, prettier fonts, cleverer folders. But a
          notes app is still a filing cabinet with a search bar. You do the remembering. You do the following up. You
          are the <Brush delay={200}>only moving part.</Brush>
        </p>

        <figure className="m-quote" data-reveal>
          <div className="m-quote-sprite">
            <PixelSprite frames={thinkerIdea} fps={3} size={64} accent="#f5b301" className="text-[var(--l-ink)]" />
          </div>
          <blockquote>Who takes notes for the note-taker?</blockquote>
        </figure>

        <p data-reveal>
          char is my answer. It&rsquo;s a notepad first &mdash; fast, quiet, <Mark tone="g">yours</Mark>. Write the way
          you already write, then let it read along. It notices the <span className="hw">DM</span> you promised to
          answer and drafts the{" "}
          <span className="chip chip-serif">
            <Mail /> email
          </span>
          . It finds the figure buried in last month&rsquo;s notes and pulls the{" "}
          <span className="chip chip-mono">
            <Sheet /> number
          </span>
          . It spots the same idea in four places and folds them into one <span className="hw2">doc</span>.
        </p>

        <p data-reveal>
          It runs on <Wavy delay={150}>your own AI key</Wavy>, so your notes aren&rsquo;t anyone&rsquo;s training data
          and your bill isn&rsquo;t anyone&rsquo;s margin. And it never acts without a yes from you:{" "}
          <Mark delay={500}>char drafts, you decide.</Mark>
        </p>

        <p data-reveal>
          I built it because I was tired of being the only thing standing between my notes and getting things done.{" "}
          <Mark tone="g" delay={250}>
            Write it down. We&rsquo;ll take it from there.
          </Mark>
        </p>

        <p className="m-sign" data-reveal>
          <span className="m-sign-name">&mdash; jay</span>
          <PixelSprite frames={waver} fps={4} size={40} accent="#5b5bd6" className="m-sign-sprite text-[var(--l-ink)]" />
        </p>
      </div>
    </section>
  );
}
