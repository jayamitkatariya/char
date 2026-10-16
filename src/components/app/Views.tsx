"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { allTasks, tasksIn } from "@/lib/tasks";
import type { Folder, Note } from "@/lib/types";
import {
  IconBack,
  IconDownload,
  IconFolder,
  IconForward,
  IconLink,
  IconMenu,
  IconMore,
  IconMove,
  IconNote,
  IconPin,
  IconPlus,
  IconSidebar,
  IconSparkle,
  IconSun,
  IconTrash,
  IconWand,
} from "../icons";
import type { EditorChange } from "./Editor";
import { plainText } from "./Markdown";
import { IconPicker, NoteIcon } from "./NoteIcon";
import { Menu, MenuItem, MenuSep, type View } from "./Sidebar";

// BlockNote touches the DOM on import; load it only in the browser.
const Editor = dynamic(() => import("./Editor"), {
  ssr: false,
  loading: () => <div className="h-40 animate-pulse rounded-xl bg-[var(--paper-2)]/60" />,
});

export type SaveState = "saved" | "saving" | "error";

/* ---------- shared bits ---------- */

// The app moves between notes with pushState, so the window's own history is the back stack.
// Chromium's Navigation API says whether there is anywhere to go.
type HistoryNav = EventTarget & { canGoBack: boolean; canGoForward: boolean };
const historyNav = () => (window as unknown as { navigation?: HistoryNav }).navigation;
const onHistory = (cb: () => void) => {
  const nav = historyNav();
  nav?.addEventListener("currententrychange", cb);
  return () => nav?.removeEventListener("currententrychange", cb);
};

function HistoryButtons() {
  const back = useSyncExternalStore(onHistory, () => historyNav()?.canGoBack ?? true, () => false);
  const forward = useSyncExternalStore(onHistory, () => historyNav()?.canGoForward ?? true, () => false);
  return (
    <div className="hidden items-center sm:flex">
      <button className="icon-btn disabled:pointer-events-none disabled:opacity-30" disabled={!back} onClick={() => history.back()} title="Back (⌘[)" aria-label="Back">
        <IconBack size={16} />
      </button>
      <button className="icon-btn disabled:pointer-events-none disabled:opacity-30" disabled={!forward} onClick={() => history.forward()} title="Forward (⌘])" aria-label="Forward">
        <IconForward size={16} />
      </button>
    </div>
  );
}

export function TopBar({
  sidebarHidden,
  onShowSidebar,
  chatOpen,
  onToggleChat,
  children,
  actions,
}: {
  sidebarHidden: boolean;
  onShowSidebar: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header
      className={`drag sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 bg-[var(--paper)]/85 px-3 backdrop-blur-md sm:px-4 ${
        sidebarHidden ? "lights-left" : "" /* clear the traffic lights when the sidebar is hidden */
      }`}
    >
      <button className={`icon-btn ${sidebarHidden ? "" : "md:hidden"}`} onClick={onShowSidebar} aria-label="Show sidebar">
        <span className="md:hidden">
          <IconMenu size={16} />
        </span>
        <span className="hidden md:inline">
          <IconSidebar size={16} />
        </span>
      </button>
      <HistoryButtons />
      <div className="flex min-w-0 flex-1 items-center gap-1 text-[13px] text-[var(--ink-soft)]">{children}</div>
      {actions}
      <button
        className={`btn btn-sm ${chatOpen ? "btn-primary" : ""}`}
        onClick={onToggleChat}
        title="Ask char (⌘J)"
        aria-pressed={chatOpen}
      >
        <span className={chatOpen ? "" : "text-[var(--sun)]"}>
          <IconSparkle size={14} />
        </span>
        <span className="hidden sm:inline">Ask char</span>
      </button>
    </header>
  );
}

export function Crumbs({ chain, pages = [], onNavigate, tail }: { chain: Folder[]; pages?: Note[]; onNavigate: (v: View) => void; tail?: string }) {
  const steps = [
    ...chain.map((f) => ({ id: f.id, label: f.name, view: { kind: "folder", id: f.id } as View })),
    ...pages.map((n) => ({ id: n.id, label: `${n.icon ? `${n.icon} ` : ""}${n.title.trim() || "Untitled"}`, view: { kind: "note", id: n.id } as View })),
  ];
  return (
    <nav className="flex min-w-0 items-center gap-1" aria-label="Breadcrumb">
      {steps.map((st, i) => (
        <span key={st.id} className="flex min-w-0 shrink items-center gap-1">
          {i > 0 && <span className="text-[var(--ink-faint)]">/</span>}
          <button className="row max-w-[180px] truncate px-1.5 py-0.5 hover:text-[var(--ink)]" onClick={() => onNavigate(st.view)}>
            {st.label}
          </button>
        </span>
      ))}
      {tail !== undefined && (
        <>
          {steps.length > 0 && <span className="text-[var(--ink-faint)]">/</span>}
          <span className="truncate px-1.5 text-[var(--ink)]">{tail || "Untitled"}</span>
        </>
      )}
    </nav>
  );
}

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
};

export function NoteCard({ note, path, onOpen }: { note: Note; path?: string; onOpen: () => void }) {
  const preview = plainText(note.content).slice(0, 160);
  return (
    <button onClick={onOpen} className="card group flex h-full flex-col p-4 text-left transition-transform duration-200 hover:-translate-y-0.5">
      <div className="flex items-start gap-2">
        <h3 className="font-serif line-clamp-2 flex-1 text-[17px] font-semibold leading-snug">
          {note.icon && <span className="mr-1.5 font-sans">{note.icon}</span>}
          {note.title.trim() || "Untitled"}
        </h3>
        {note.pinned && (
          <span className="mt-1 text-[var(--ink-faint)]">
            <IconPin size={13} />
          </span>
        )}
      </div>
      <p className="mt-1.5 line-clamp-3 flex-1 text-[13px] leading-relaxed text-[var(--ink-soft)]">{preview || "Empty note"}</p>
      <div className="label mt-3 flex items-center gap-2">
        {path && <span className="truncate">{path.toLowerCase()}</span>}
        {path && <span>·</span>}
        <span className="shrink-0">{ago(note.updatedAt)}</span>
      </div>
    </button>
  );
}

/* ---------- a note ---------- */

type NoteViewProps = {
  note: Note;
  notes: Note[];
  folders: Folder[];
  chain: Folder[];
  /** The pages this one sits inside, outermost first. */
  pages: Note[];
  /** Pages directly inside this one. */
  subpages: Note[];
  folderPath: (id: string) => string;
  notePath: (n: Note) => string;
  saveState: SaveState;
  bar: Omit<React.ComponentProps<typeof TopBar>, "children" | "actions">;
  onNavigate: (v: View) => void;
  onTitle: (title: string) => void;
  onEditorChange: (c: EditorChange) => void;
  onTogglePin: () => void;
  onIcon: (icon: string) => void;
  onPickFolder: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  onCreateNote: (title: string) => Note | Promise<Note>;
  onCreateSubpage: (open: boolean) => Promise<Note>;
  registerInsert: (fn: ((markdown: string) => void) | null) => void;
  onToast: (msg: string) => void;
};

export function NoteView(p: NoteViewProps) {
  const { note } = p;
  const [title, setTitle] = useState(note.title);
  const [menu, setMenu] = useState(false);
  const [picking, setPicking] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // A brand-new note starts with the cursor in the title, or in the body when it already has one
  // (made from ⌘K or an @-link).
  const [fresh] = useState(() => !note.content.trim());
  useEffect(() => {
    if (fresh && !note.title) titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  // The page this sits inside links here with its /page row; that isn't news, so it's left out.
  const backlinks = useMemo(
    () => p.notes.filter((n) => n.id !== note.id && n.id !== note.parentId && n.links?.includes(note.id)),
    [p.notes, note.id, note.parentId],
  );
  // Subpages made from the sidebar (or whose row was deleted) still need a way in.
  const unlisted = p.subpages.filter((n) => !note.links?.includes(n.id));
  const words = useMemo(() => plainText(note.content).split(/\s+/).filter(Boolean).length, [note.content]);

  const exportMd = () => {
    const blob = new Blob([`# ${note.title || "Untitled"}\n\n${note.content}`], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(note.title || "untitled").replace(/[^\w\s-]/g, "").trim() || "untitled"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        {...p.bar}
        actions={
          <div className="flex items-center gap-1">
            <span className="label mr-2 hidden sm:inline" aria-live="polite">
              {p.saveState === "saving" ? "saving…" : p.saveState === "error" ? "couldn't save" : "saved"}
            </span>
            <button
              className="icon-btn"
              onClick={() => window.dispatchEvent(new Event("char:tidy"))}
              title="Tidy: turn loose lines into to-dos and bullets (⌘⇧T)"
              aria-label="Tidy into to-dos"
            >
              <IconWand size={15} />
            </button>
            <button className="icon-btn" onClick={p.onTogglePin} title={`${note.pinned ? "Unpin" : "Pin"} (⌘⇧P)`} aria-pressed={note.pinned}>
              <IconPin size={15} />
            </button>
            <div className="relative">
              <button className="icon-btn" onClick={() => setMenu((m) => !m)} title="More" aria-label="More">
                <IconMore size={16} />
              </button>
              {menu && (
                <Menu onClose={() => setMenu(false)}>
                  <MenuItem icon={<IconPlus size={14} />} onClick={() => void p.onCreateSubpage(true)}>
                    Add subpage
                  </MenuItem>
                  <MenuItem icon={<IconLink size={14} />} onClick={p.onCopyLink}>
                    Copy link
                  </MenuItem>
                  <MenuItem icon={<IconDownload size={14} />} onClick={exportMd}>
                    Export markdown
                  </MenuItem>
                  <MenuItem icon={<IconMove size={14} />} onClick={p.onPickFolder}>
                    Move to…
                  </MenuItem>
                  <MenuSep />
                  <MenuItem danger icon={<IconTrash size={14} />} onClick={p.onDelete}>
                    Move to Trash
                  </MenuItem>
                </Menu>
              )}
            </div>
          </div>
        }
      >
        <Crumbs chain={p.chain} pages={p.pages} onNavigate={p.onNavigate} tail={title} />
      </TopBar>

      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <article className="fade-in group/page mx-auto w-full max-w-[760px] px-6 pb-40 pt-10 sm:px-16 sm:pt-16">
          {/* The page's emoji, or an "Add icon" button that shows on hover, like Notion. */}
          <div className="relative mb-2">
            {note.icon ? (
              <button
                className="row -ml-1 flex h-[64px] w-[64px] items-center justify-center text-[48px] leading-none"
                title="Change icon"
                aria-label="Change icon"
                onClick={() => setPicking((v) => !v)}
              >
                {note.icon}
              </button>
            ) : (
              <button
                className={`btn btn-ghost btn-sm -ml-2 text-[var(--ink-faint)] transition-opacity ${picking ? "opacity-100" : "opacity-0 focus:opacity-100 group-hover/page:opacity-100"}`}
                onClick={() => setPicking((v) => !v)}
              >
                <NoteIcon size={14} /> Add icon
              </button>
            )}
            {picking && (
              <IconPicker
                hasIcon={!!note.icon}
                onPick={(e) => {
                  p.onIcon(e);
                  setPicking(false);
                }}
                onRemove={() => {
                  p.onIcon("");
                  setPicking(false);
                }}
                onClose={() => setPicking(false)}
              />
            )}
          </div>
          <textarea
            ref={titleRef}
            rows={1}
            className="field font-serif resize-none overflow-hidden text-[36px] font-semibold leading-[1.15] tracking-tight sm:text-[44px]"
            placeholder="Untitled"
            value={title}
            onChange={(e) => {
              const v = e.target.value.replace(/\n/g, "");
              setTitle(v);
              p.onTitle(v);
            }}
            onKeyDown={(e) => {
              // Enter jumps into the body, like Notion.
              if (e.key === "Enter") {
                e.preventDefault();
                window.dispatchEvent(new Event("char:focus-editor"));
              }
            }}
          />
          <div className="label mb-6 mt-3 flex flex-wrap items-center gap-x-2">
            <span>edited {ago(note.updatedAt)}</span>
            <span>·</span>
            <span>
              {words} {words === 1 ? "word" : "words"}
            </span>
            <span>·</span>
            <span>
              <span className="kbd">/</span> blocks & pages · <span className="kbd">@</span> link · <span className="kbd">@charlie</span> hand off a task
            </span>
          </div>

          <Editor
            key={note.id}
            note={note}
            notes={p.notes}
            folders={p.folders}
            folderPath={p.folderPath}
            onChange={p.onEditorChange}
            onCreateNote={p.onCreateNote}
            onCreateSubpage={() => p.onCreateSubpage(false)}
            autoFocus={fresh && !!note.title}
            registerInsert={p.registerInsert}
            onToast={p.onToast}
          />

          {unlisted.length > 0 && (
            <section className="mt-10">
              <h2 className="label mb-2 flex items-center gap-1.5">
                <IconNote size={11} /> pages inside
              </h2>
              <div className="-mx-1.5">
                {unlisted.map((n) => (
                  <button key={n.id} className="page-block" onClick={() => p.onNavigate({ kind: "note", id: n.id })}>
                    <NoteIcon icon={n.icon} size={16} />
                    <span className="page-block-title">{n.title.trim() || "Untitled"}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {backlinks.length > 0 && (
            <section className="hairline-t mt-16 pt-6">
              <h2 className="label mb-3 flex items-center gap-1.5">
                <IconLink size={11} /> linked from {backlinks.length} {backlinks.length === 1 ? "note" : "notes"}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {backlinks.map((n) => (
                  <NoteCard key={n.id} note={n} path={p.notePath(n)} onOpen={() => p.onNavigate({ kind: "note", id: n.id })} />
                ))}
              </div>
            </section>
          )}
        </article>
      </div>
    </div>
  );
}

/* ---------- a folder, all notes, pinned ---------- */

type ListViewProps = {
  heading: string;
  kicker: string;
  folder?: Folder;
  chain: Folder[];
  subfolders: Folder[];
  notes: Note[];
  folderPath: (id: string) => string;
  notePath: (n: Note) => string;
  bar: Omit<React.ComponentProps<typeof TopBar>, "children" | "actions">;
  onNavigate: (v: View) => void;
  onNewNote: () => void;
  onNewFolder?: () => void;
  onRename?: (name: string) => void;
};

// Big folders render a page of cards at a time; more appear as the list scrolls into view.
const PAGE = 60;

export function ListView(p: ListViewProps) {
  const [sort, setSort] = useState<"edited" | "title">("edited");
  const [limit, setLimit] = useState(PAGE);
  const more = useRef<HTMLDivElement>(null);
  const sorted = useMemo(
    () =>
      [...p.notes].sort((a, b) =>
        sort === "title" ? (a.title || "Untitled").localeCompare(b.title || "Untitled") : Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
      ),
    [p.notes, sort],
  );

  useEffect(() => {
    const el = more.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && setLimit((l) => l + PAGE * 2), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, sorted.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar {...p.bar}>
        <Crumbs chain={p.folder ? p.chain.slice(0, -1) : []} onNavigate={p.onNavigate} tail={p.heading} />
      </TopBar>
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <div className="fade-in mx-auto w-full max-w-[1040px] px-6 pb-24 pt-10 sm:px-12 sm:pt-14">
          <p className="label">{p.kicker}</p>
          {p.folder && p.onRename ? (
            <input
              key={p.folder.id}
              className="field font-serif mt-1 text-[38px] font-semibold tracking-tight sm:text-[46px]"
              defaultValue={p.folder.name}
              autoFocus={p.folder.name === "New folder"}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.folder?.name && p.onRename?.(e.target.value.trim())}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              aria-label="Folder name"
            />
          ) : (
            <h1 className="font-serif mt-1 text-[38px] font-semibold tracking-tight sm:text-[46px]">{p.heading}</h1>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button className="btn btn-primary btn-sm" onClick={p.onNewNote}>
              <IconPlus size={14} /> New note
            </button>
            {p.onNewFolder && (
              <button className="btn btn-sm" onClick={p.onNewFolder}>
                <IconFolder size={14} /> New subfolder
              </button>
            )}
            <div className="ml-auto flex items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--card)] p-0.5">
              {(["edited", "title"] as const).map((s) => (
                <button
                  key={s}
                  className={`rounded-full px-3 py-1 font-mono text-[11px] ${sort === s ? "bg-[var(--accent)] text-[var(--on-accent)]" : "text-[var(--ink-soft)]"}`}
                  onClick={() => setSort(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {p.subfolders.length > 0 && (
            <div className="mt-8 flex flex-wrap gap-2">
              {p.subfolders.map((f) => (
                <button key={f.id} className="btn" onClick={() => p.onNavigate({ kind: "folder", id: f.id })}>
                  <IconFolder size={15} /> {f.name}
                </button>
              ))}
            </div>
          )}

          {sorted.length ? (
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sorted.slice(0, limit).map((n) => (
                <NoteCard key={n.id} note={n} path={p.folder ? undefined : p.notePath(n)} onOpen={() => p.onNavigate({ kind: "note", id: n.id })} />
              ))}
            </div>
          ) : null}
          {sorted.length > limit && <div ref={more} className="h-px" aria-hidden />}
          {sorted.length === 0 && (
            <div className="mt-16 text-center">
              <p className="font-hand -rotate-2 text-[28px] text-[var(--ink-soft)]">nothing here yet…</p>
              <button className="btn mt-4" onClick={p.onNewNote}>
                <IconPlus size={14} /> Write the first note
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- today ---------- */

function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 22) return "Good evening";
  return "Working late";
}

type HomeViewProps = {
  username: string | null;
  notes: Note[];
  notePath: (n: Note) => string;
  aiReady: boolean;
  bar: Omit<React.ComponentProps<typeof TopBar>, "children" | "actions">;
  onNavigate: (v: View) => void;
  onNewNote: () => void;
  onBrief: () => void;
  onSetupAI: () => void;
};

export function HomeView(p: HomeViewProps) {
  // Client-only view, so the clock can be read once up front.
  const [hello] = useState(() => ({
    greet: greeting(),
    date: new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }),
    now: Date.now(),
  }));

  const recent = useMemo(() => [...p.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 9), [p.notes]);
  const weekAgo = hello.now - 7 * 86400 * 1000;
  const touched = p.notes.filter((n) => Date.parse(n.updatedAt) > weekAgo).length;
  const openTasks = useMemo(() => allTasks(p.notes).filter((t) => !t.checked).length, [p.notes]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar {...p.bar}>
        <span className="px-1.5 text-[var(--ink)]">Today</span>
      </TopBar>
      <div className="scroll-soft relative min-h-0 flex-1 overflow-y-auto">
        <div aria-hidden className="paper-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
        <div className="fade-in relative mx-auto w-full max-w-[1040px] px-6 pb-24 pt-12 sm:px-12 sm:pt-16">
          <p className="label">{hello.date.toLowerCase()}</p>
          <h1 className="font-serif mt-2 text-[40px] font-semibold leading-[1.08] tracking-tight sm:text-[54px]">
            {hello.greet}
            {p.username ? `, ${p.username}` : ""}.
          </h1>
          <p className="mt-3 max-w-xl text-[16px] text-[var(--ink-soft)]">
            {p.notes.length === 0 ? (
              "A blank page. Write the first thing on your mind."
            ) : (
              <>
                You touched <span className="mark">{touched} {touched === 1 ? "note" : "notes"}</span> this week
                {openTasks > 0 && (
                  <>
                    {" "}
                    and have{" "}
                    <button className="mark cursor-pointer hover:underline" onClick={() => p.onNavigate({ kind: "tasks" })}>
                      {openTasks} open {openTasks === 1 ? "to-do" : "to-dos"}
                    </button>
                  </>
                )}
                .
              </>
            )}
          </p>

          <div className="mt-8 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <div className="card relative overflow-hidden p-5">
              <div className="flex items-center gap-2 text-[14px] font-medium">
                <span className="text-[var(--sun)]">
                  <IconSun size={17} />
                </span>
                Daily brief
              </div>
              {p.aiReady ? (
                <>
                  <p className="mt-3 text-[15px] leading-relaxed text-[var(--ink-soft)]">
                    Let char read what changed across your notes and tell you what&apos;s done, what&apos;s waiting, and what needs you.
                  </p>
                  <button className="btn btn-primary mt-4" onClick={p.onBrief}>
                    Write my brief →
                  </button>
                </>
              ) : (
                <>
                  <p className="mt-3 text-[15px] leading-relaxed text-[var(--ink-soft)]">
                    char can read every note and write you a morning brief, find anything, and turn notes into to-dos. Bring your own AI key — it stays on this Mac.
                  </p>
                  <button className="btn mt-4" onClick={p.onSetupAI}>
                    <IconSparkle size={14} /> Connect an AI model
                  </button>
                </>
              )}
            </div>
            <div className="card flex flex-col justify-between p-5">
              <div>
                <div className="text-[14px] font-medium">Start something</div>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--ink-soft)]">
                  <span className="kbd">⌘N</span> new note · <span className="kbd">⌘K</span> find anything · <span className="kbd">⌘J</span> ask char
                </p>
              </div>
              <button className="btn btn-primary mt-4 self-start" onClick={p.onNewNote}>
                <IconPlus size={14} /> New note
              </button>
            </div>
          </div>


          {recent.length > 0 && (
            <>
              <h2 className="label mb-3 mt-12">recently edited</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recent.map((n) => (
                  <NoteCard key={n.id} note={n} path={p.notePath(n)} onOpen={() => p.onNavigate({ kind: "note", id: n.id })} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- the Trash ---------- */

type TrashViewProps = {
  trash: Note[];
  notePath: (n: Note) => string;
  bar: Omit<React.ComponentProps<typeof TopBar>, "children" | "actions">;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  onEmpty: () => void;
};

export function TrashView(p: TrashViewProps) {
  const [now] = useState(() => Date.now());
  // Subpages that went with their page are listed under it, not on their own.
  const ids = new Set(p.trash.map((n) => n.id));
  const roots = p.trash
    .filter((n) => !(n.parentId && ids.has(n.parentId) && p.trash.find((x) => x.id === n.parentId)?.deletedAt === n.deletedAt))
    .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
  const inside = (id: string): number => p.trash.filter((n) => n.parentId === id).reduce((s, n) => s + 1 + inside(n.id), 0);
  const daysLeft = (n: Note) => Math.max(0, Math.ceil(30 - (now - Date.parse(n.deletedAt ?? "")) / 86400000));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar {...p.bar}>
        <span className="px-1.5 text-[var(--ink)]">Trash</span>
      </TopBar>
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <div className="fade-in mx-auto w-full max-w-[860px] px-6 pb-24 pt-10 sm:px-12 sm:pt-14">
          <p className="label">{roots.length} {roots.length === 1 ? "item" : "items"} · deleted for good after 30 days</p>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="font-serif flex-1 text-[38px] font-semibold tracking-tight sm:text-[46px]">Trash</h1>
            {roots.length > 0 && (
              <button
                className="btn btn-sm text-[var(--danger)]"
                onClick={() => window.confirm("Delete everything in the Trash for good? This can't be undone.") && p.onEmpty()}
              >
                <IconTrash size={14} /> Empty Trash
              </button>
            )}
          </div>
          {roots.length === 0 ? (
            <div className="mt-16 text-center">
              <p className="font-hand -rotate-2 text-[28px] text-[var(--ink-soft)]">nothing in here</p>
              <p className="mt-2 text-[14px] text-[var(--ink-soft)]">Deleted notes wait here for 30 days, in case you want them back.</p>
            </div>
          ) : (
            <ul className="card mt-8 divide-y divide-[var(--hairline)] overflow-hidden !rounded-2xl">
              {roots.map((n) => {
                const k = inside(n.id);
                return (
                  <li key={n.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-[var(--ink-faint)]">
                      <NoteIcon icon={n.icon} size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] font-medium">{n.title.trim() || "Untitled"}</div>
                      <div className="label mt-0.5 truncate">
                        {p.notePath(n).toLowerCase()}
                        {k ? ` · ${k} page${k === 1 ? "" : "s"} inside` : ""} · {daysLeft(n)} d left
                      </div>
                    </div>
                    <button className="btn btn-sm" onClick={() => p.onRestore(n.id)}>
                      Restore
                    </button>
                    <button
                      className="icon-btn"
                      title="Delete for good"
                      aria-label="Delete for good"
                      onClick={() => window.confirm(`Delete “${n.title.trim() || "Untitled"}” for good? This can't be undone.`) && p.onPurge(n.id)}
                    >
                      <IconTrash size={15} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- every to-do, across notes ---------- */

type TasksViewProps = {
  notes: Note[];
  notePath: (n: Note) => string;
  bar: Omit<React.ComponentProps<typeof TopBar>, "children" | "actions">;
  onNavigate: (v: View) => void;
  onToggle: (noteId: string, blockId: string, checked: boolean) => void;
};

export function TasksView(p: TasksViewProps) {
  const [showDone, setShowDone] = useState(false);
  // Ticked here, so they stay in view (struck through) instead of vanishing under the cursor.
  const [justDone, setJustDone] = useState<Set<string>>(() => new Set());
  const groups = useMemo(
    () =>
      [...p.notes]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((n) => ({ note: n, tasks: tasksIn(n).filter((t) => showDone || !t.checked || (t.blockId && justDone.has(t.blockId))) }))
        .filter((g) => g.tasks.length),
    [p.notes, showDone, justDone],
  );
  const open = useMemo(() => allTasks(p.notes).filter((t) => !t.checked).length, [p.notes]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar {...p.bar}>
        <span className="px-1.5 text-[var(--ink)]">Tasks</span>
      </TopBar>
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <div className="fade-in mx-auto w-full max-w-[860px] px-6 pb-24 pt-10 sm:px-12 sm:pt-14">
          <p className="label">
            {open} open {open === 1 ? "to-do" : "to-dos"} across your notes
          </p>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="font-serif flex-1 text-[38px] font-semibold tracking-tight sm:text-[46px]">Tasks</h1>
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--ink-soft)]">
              <input type="checkbox" className="accent-[var(--accent)]" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              Show done
            </label>
          </div>
          {groups.length === 0 ? (
            <div className="mt-16 text-center">
              <p className="font-hand -rotate-2 text-[28px] text-[var(--ink-soft)]">all clear</p>
              <p className="mt-2 text-[14px] text-[var(--ink-soft)]">
                Checklists from every note show up here. Type <span className="kbd">[] </span> or <span className="kbd">todo: </span> in a note, or tidy loose lines with{" "}
                <span className="kbd">⌘⇧T</span>.
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-6">
              {groups.map(({ note, tasks }) => (
                <section key={note.id}>
                  <button
                    className="row -ml-2 flex max-w-full items-center gap-2 px-2 py-1 text-left"
                    onClick={() => p.onNavigate({ kind: "note", id: note.id })}
                  >
                    <NoteIcon icon={note.icon} size={15} className="text-[var(--ink-soft)]" />
                    <span className="truncate text-[14.5px] font-semibold">{note.title.trim() || "Untitled"}</span>
                    <span className="label truncate">{p.notePath(note).toLowerCase()}</span>
                  </button>
                  <ul className="mt-1">
                    {tasks.map((t, i) => (
                      <li key={t.blockId ?? i} className="flex items-start gap-2.5 py-1 pl-1">
                        <input
                          type="checkbox"
                          className="task-box"
                          checked={t.checked}
                          disabled={!t.blockId}
                          title={t.blockId ? undefined : "Open the note to tick this one"}
                          aria-label={t.text}
                          onChange={(e) => {
                            if (!t.blockId) return;
                            if (e.target.checked) setJustDone((s) => new Set(s).add(t.blockId!));
                            p.onToggle(note.id, t.blockId, e.target.checked);
                          }}
                        />
                        <button
                          className={`min-w-0 flex-1 text-left text-[15px] leading-relaxed ${t.checked ? "text-[var(--ink-faint)] line-through" : ""}`}
                          onClick={() => p.onNavigate({ kind: "note", id: note.id })}
                        >
                          {t.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
