"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { prefersReducedMotion } from "@/lib/dither";
import {
  Archive,
  ArrowUp,
  Broom,
  Calendar,
  CheckSquare,
  Doc,
  Hash,
  Inbox,
  Mail,
  Memory,
  Mic,
  More,
  Note,
  Plus,
  Sun,
  Users,
} from "./icons";

// The hero's app-window mockup: a note with a floating assistant card, four
// tabs that auto-advance (a CSS progress animation drives the timing, so
// hover-to-pause is just animation-play-state), and a reply box that types a
// suggestion. The whole stage is laid out at a fixed 600×536 and scaled to
// fit its column, so it shrinks like a screenshot instead of reflowing.

const STAGE_W = 600;
const STAGE_H = 536;

const noop = () => () => {};
const today = () =>
  new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

type TabDef = {
  label: string;
  pill: string;
  pillIcon: ReactNode;
  suggestion: string;
  card: ReactNode;
};

function NoteLink({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="hd-link">
      <span className="hd-link-icon">{icon}</span>
      {children}
    </span>
  );
}

function CardHead({ icon, title, meta }: { icon: ReactNode; title: string; meta?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-[var(--l-ink-soft)]">
      {icon}
      <span className="font-medium text-[var(--l-ink)]">{title}</span>
      {meta}
      <span className="ml-auto flex items-center gap-2.5 text-[var(--l-ink-faint)]">
        <Inbox className="h-[15px] w-[15px]" />
        <More className="h-[15px] w-[15px]" />
      </span>
    </div>
  );
}

const TABS: TabDef[] = [
  {
    label: "Catch up",
    pill: "Daily brief",
    pillIcon: <Sun className="h-3.5 w-3.5 text-[#f08a24]" />,
    suggestion: "push the domain renewal to tomorrow",
    card: (
      <>
        <CardHead icon={<Sun className="h-4 w-4 text-[#f08a24]" />} title="Daily brief" />
        <p className="mt-3 text-[15.5px] font-semibold tracking-[-0.01em] text-[var(--l-ink)]">
          Launch notes are done. Two things need you.
        </p>
        <ul className="hd-bullets mt-2.5">
          <li>
            <b>Done:</b> <NoteLink icon={<CheckSquare />}>Launch checklist</NoteLink> — all 12 items checked
          </li>
          <li>
            <b>Waiting:</b> <NoteLink icon={<Calendar />}>Design review</NoteLink> moved to Thu 3pm
          </li>
          <li>
            <b>#ideas:</b> 4 loose thoughts on onboarding, grouped into <NoteLink icon={<Note />}>one note</NoteLink>
          </li>
          <li>
            <b>Reminder:</b> renew the domain before Friday — <NoteLink icon={<Mail />}>draft ready</NoteLink>
          </li>
        </ul>
      </>
    ),
  },
  {
    label: "Remember more",
    pill: "Memory",
    pillIcon: <Memory className="h-3.5 w-3.5 text-[#7c5cff]" />,
    suggestion: "turn that into a task for this week",
    card: (
      <>
        <CardHead
          icon={<Memory className="h-4 w-4 text-[#7c5cff]" />}
          title="Memory"
          meta={<span className="text-[12px] text-[var(--l-ink-faint)]">· from Aug 12</span>}
        />
        <p className="mt-3 text-[15.5px] font-semibold tracking-[-0.01em] text-[var(--l-ink)]">
          You&rsquo;ve already solved this one.
        </p>
        <p className="mt-2 text-[13.5px] leading-[1.55] text-[var(--l-ink-soft)]">
          In <NoteLink icon={<Note />}>Onboarding v1 retro</NoteLink> you wrote:
        </p>
        <blockquote className="mt-2 border-l-2 border-[#d9d0ff] pl-3 font-serif text-[15px] italic leading-[1.5] text-[var(--l-ink)]">
          &ldquo;People drop off at the API-key step. Show them a finished note before asking for anything.&rdquo;
        </blockquote>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="mr-0.5 text-[var(--l-ink-faint)]">Related</span>
          <span className="hd-chip">
            <Note /> Pricing — rough thoughts
          </span>
          <span className="hd-chip">
            <Hash /> onboarding
          </span>
          <span className="hd-chip">
            <Users /> Interview: Priya
          </span>
        </div>
      </>
    ),
  },
  {
    label: "Get things done",
    pill: "Drafts",
    pillIcon: <CheckSquare className="h-3.5 w-3.5 text-[#2f9e5b]" />,
    suggestion: "make it a little warmer",
    card: (
      <>
        <CardHead
          icon={<CheckSquare className="h-4 w-4 text-[#2f9e5b]" />}
          title="Drafted for you"
          meta={
            <span className="ml-1 inline-flex items-center gap-1.5 text-[12px] text-[#b7791f]">
              <span className="hd-pulse" /> waiting for your yes
            </span>
          }
        />
        <p className="mt-3 text-[15.5px] font-semibold tracking-[-0.01em] text-[var(--l-ink)]">
          Sam asked to move the design review. Your reply is ready.
        </p>
        <div className="mt-2.5 rounded-xl border border-[var(--l-line)] bg-white px-3.5 py-2.5 text-[13px] leading-[1.5]">
          <div className="flex gap-2 text-[var(--l-ink-faint)]">
            <span className="w-12">To</span>
            <span className="text-[var(--l-ink)]">sam@studio.co</span>
          </div>
          <div className="flex gap-2 border-b border-[var(--l-line)] pb-1.5 text-[var(--l-ink-faint)]">
            <span className="w-12">Subject</span>
            <span className="text-[var(--l-ink)]">Re: design review</span>
          </div>
          <p className="pt-1.5 text-[var(--l-ink-soft)]">
            Thursday at 3 works. I&rsquo;ll bring the launch checklist and the two open questions from Monday&rsquo;s notes.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--l-cta)] px-2.5 py-1 text-[12px] font-medium text-white">
              Send <ArrowUp className="h-3 w-3 rotate-45" />
            </span>
            <span className="rounded-md border border-[var(--l-line)] px-2.5 py-1 text-[12px] text-[var(--l-ink-soft)]">
              Edit
            </span>
          </div>
        </div>
      </>
    ),
  },
  {
    label: "Clear clutter",
    pill: "Tidy up",
    pillIcon: <Broom className="h-3.5 w-3.5 text-[#0f8b8d]" />,
    suggestion: "keep anything with a recipe in it",
    card: (
      <>
        <CardHead
          icon={<Broom className="h-4 w-4 text-[#0f8b8d]" />}
          title="Tidy up"
          meta={<span className="text-[12px] text-[var(--l-ink-faint)]">· 14 stale notes</span>}
        />
        <p className="mt-3 text-[15.5px] font-semibold tracking-[-0.01em] text-[var(--l-ink)]">
          14 notes haven&rsquo;t been opened since June.
        </p>
        <ul className="hd-clutter mt-2">
          {[
            ["Untitled (3)", "Jun 2", true],
            ["groceries??", "May 28", true],
            ["Book list", "Jun 11", false],
            ["meeting notes copy", "May 19", true],
          ].map(([title, date, gone], i) => (
            <li key={title as string} data-gone={gone ? "" : undefined} style={{ ["--i" as string]: i }}>
              <Note className="h-3.5 w-3.5 shrink-0 text-[var(--l-ink-faint)]" />
              <span className="hd-strike">{title}</span>
              <span className="ml-auto text-[11.5px] text-[var(--l-ink-faint)]">{date}</span>
              <span className="hd-tag">{gone ? "archived" : "keep"}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2 text-[12px]">
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--l-cta)] px-2.5 py-1 font-medium text-white">
            <Archive className="h-3 w-3" /> Archive 9
          </span>
          <span className="rounded-md border border-[var(--l-line)] px-2.5 py-1 text-[var(--l-ink-soft)]">Keep 5</span>
        </div>
      </>
    ),
  },
];

/** Types the suggestion into the reply box, straight into the DOM. */
function ReplyBox({ suggestion }: { suggestion: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const placeholderRef = useRef<HTMLSpanElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let i = 0;
    let timer = 0;
    const type = () => {
      i++;
      if (textRef.current) textRef.current.textContent = suggestion.slice(0, i);
      if (placeholderRef.current) placeholderRef.current.style.display = "none";
      if (caretRef.current) caretRef.current.style.display = "inline-block";
      if (i < suggestion.length) timer = window.setTimeout(type, 34 + Math.random() * 40);
    };
    timer = window.setTimeout(type, 1500);
    return () => window.clearTimeout(timer);
  }, [suggestion]);

  return (
    <div className="mt-3 rounded-xl border border-[var(--l-line)] bg-white px-3 pb-2 pt-2.5 shadow-[0_1px_2px_rgba(40,30,10,0.04)]">
      <div className="h-5 truncate text-[13.5px] text-[var(--l-ink)]">
        <span ref={placeholderRef} className="text-[var(--l-ink-faint)]">
          Reply to char…
        </span>
        <span ref={textRef} />
        <span ref={caretRef} className="hd-caret" style={{ display: "none" }} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--l-ink-soft)]">
        <Plus className="h-4 w-4" />
        <span className="rounded-md border border-[var(--l-line)] px-1.5 py-0.5">Ask first</span>
        <Mic className="ml-auto h-4 w-4" />
        <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-[var(--l-cta)] text-white">
          <ArrowUp className="h-3.5 w-3.5" />
        </span>
      </div>
    </div>
  );
}

export default function HeroDemo() {
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [inView, setInView] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const date = useSyncExternalStore(noop, today, () => "");
  const id = useId();

  // scale the fixed-size stage to its column
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      wrap.style.setProperty("--s", String(wrap.clientWidth / STAGE_W));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const next = useCallback(() => setActive((a) => (a + 1) % TABS.length), []);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = TABS.length;
    let to = -1;
    if (e.key === "ArrowRight") to = (active + 1) % n;
    else if (e.key === "ArrowLeft") to = (active - 1 + n) % n;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = n - 1;
    if (to < 0) return;
    e.preventDefault();
    setActive(to);
    tabRefs.current[to]?.focus();
  };

  const tab = TABS[active];
  const paused = hovered || !inView;

  return (
    <div
      ref={rootRef}
      className="hero-demo relative"
      data-paused={paused ? "" : undefined}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovered(false);
      }}
    >
      <div ref={wrapRef} className="hd-wrap" data-mm="block">
        <div className="hd-stage" style={{ width: STAGE_W, height: STAGE_H }}>
          <div className="hd-ghost hd-ghost-2" aria-hidden="true" />
          <div className="hd-ghost hd-ghost-1" aria-hidden="true" />
          <div className="hd-window">
            {/* title bar */}
            <div className="relative flex h-11 items-center gap-3 border-b border-[var(--l-line-soft)] px-4" aria-hidden="true">
              <span className="flex gap-2">
                <i className="hd-light bg-[#ff5f57]" />
                <i className="hd-light bg-[#febc2e]" />
                <i className="hd-light bg-[#28c840]" />
              </span>
              <Doc className="ml-2 h-4 w-4 text-[var(--l-ink-faint)]" />
              <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[12.5px] font-medium text-[var(--l-ink-faint)]">
                {date || " "}
              </span>
              <span className="ml-auto flex items-center gap-3 text-[var(--l-ink-faint)]">
                <Mic className="h-4 w-4" />
                <Plus className="h-4 w-4" />
              </span>
            </div>

            {/* the note underneath */}
            <div className="relative h-[492px]">
              <div className="absolute inset-x-0 top-0 px-9 pt-6 text-[14px] leading-[1.6] text-[var(--l-ink-soft)]" aria-hidden="true">
                <div className="font-serif text-[22px] font-bold text-[var(--l-ink)]">Launch week</div>
                <p className="mt-2">Goals for this week, roughly in order. Ship the notes app to the waitlist, then…</p>
              </div>
              <div className="absolute inset-x-0 bottom-0 px-9 pb-5 text-[14px] leading-[1.6] text-[var(--l-ink-soft)]" aria-hidden="true">
                <p>keep the first launch small enough that we can actually help everyone.</p>
                <p className="mt-2 flex items-center gap-2 font-semibold text-[var(--l-ink)]">
                  <Users className="h-4 w-4 text-[#5b7fd6]" /> User interviews
                  <span className="font-normal text-[var(--l-ink-faint)]">/ Friday</span>
                </p>
                <p className="mt-1 flex items-center gap-2 font-semibold text-[var(--l-ink)]">
                  <CheckSquare className="h-4 w-4 text-[#2f9e5b]" /> Launch checklist
                </p>
              </div>

              {/* the assistant card */}
              <div
                key={active}
                id={`${id}-panel`}
                role="tabpanel"
                aria-labelledby={`${id}-tab-${active}`}
                className="hd-card"
              >
                {tab.card}
                <ReplyBox suggestion={tab.suggestion} />
              </div>

              <div key={`pill-${active}`} className="hd-pill" aria-hidden="true">
                {tab.pillIcon}
                {tab.pill}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div role="tablist" aria-label="What char does with your notes" className="hd-tabs" onKeyDown={onKey}>
        {TABS.map((t, i) => (
          <button
            key={t.label}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            id={`${id}-tab-${i}`}
            role="tab"
            type="button"
            aria-selected={i === active}
            aria-controls={`${id}-panel`}
            tabIndex={i === active ? 0 : -1}
            className="hd-tab"
            onClick={() => setActive(i)}
          >
            <span className="hd-track" aria-hidden="true">
              {i === active && <span className="hd-fill" onAnimationEnd={next} />}
            </span>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
