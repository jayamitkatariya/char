"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Folder, Note } from "@/lib/types";
import {
  IconDownload,
  IconFolder,
  IconLink,
  IconMenu,
  IconMore,
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
import { Menu, MenuItem, type View } from "./Sidebar";

// BlockNote touches the DOM on import; load it only in the browser.
const Editor = dynamic(() => import("./Editor"), {
  ssr: false,
  loading: () => <div className="h-40 animate-pulse rounded-xl bg-[var(--paper-2)]/60" />,
});

export type SaveState = "saved" | "saving" | "error";

/* ---------- shared bits ---------- */

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

export function Crumbs({ chain, onNavigate, tail }: { chain: Folder[]; onNavigate: (v: View) => void; tail?: string }) {
  return (
    <nav className="flex min-w-0 items-center gap-1" aria-label="Breadcrumb">
      {chain.map((f, i) => (
        <span key={f.id} className="flex min-w-0 items-center gap-1">
          {i > 0 && <span className="text-[var(--ink-faint)]">/</span>}
          <button className="row truncate px-1.5 py-0.5 hover:text-[var(--ink)]" onClick={() => onNavigate({ kind: "folder", id: f.id })}>
            {f.name}
          </button>
        </span>
      ))}
      {tail !== undefined && (
        <>
          {chain.length > 0 && <span className="text-[var(--ink-faint)]">/</span>}
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
        <h3 className="font-serif line-clamp-2 flex-1 text-[17px] font-semibold leading-snug">{note.title.trim() || "Untitled"}</h3>
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
  folderPath: (id: string) => string;
  saveState: SaveState;
  bar: Omit<React.ComponentProps<typeof TopBar>, "children" | "actions">;
  onNavigate: (v: View) => void;
  onTitle: (title: string) => void;
  onEditorChange: (c: EditorChange) => void;
  onTogglePin: () => void;
  onMove: (folderId: string) => void;
  onDelete: () => void;
  onCreateNote: (title: string) => Note | Promise<Note>;
  registerInsert: (fn: ((markdown: string) => void) | null) => void;
  onToast: (msg: string) => void;
};

export function NoteView(p: NoteViewProps) {
  const { note } = p;
  const [title, setTitle] = useState(note.title);
  const [menu, setMenu] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // A brand-new note starts with the cursor in the title.
  useEffect(() => {
    if (!note.title && !note.content) titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const backlinks = useMemo(() => p.notes.filter((n) => n.id !== note.id && n.links?.includes(note.id)), [p.notes, note.id]);
  const words = useMemo(() => plainText(note.content).split(/\s+/).filter(Boolean).length, [note.content]);

  const copyLink = async () => {
    // char:// links open this note in the app from anywhere (Messages, Mail, a terminal).
    await navigator.clipboard.writeText(`char://note/${note.id}`);
    p.onToast("Link copied");
  };
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
            <button className="icon-btn" onClick={p.onTogglePin} title={note.pinned ? "Unpin" : "Pin"} aria-pressed={note.pinned}>
              <IconPin size={15} />
            </button>
            <div className="relative">
              <button className="icon-btn" onClick={() => setMenu((m) => !m)} title="More" aria-label="More">
                <IconMore size={16} />
              </button>
              {menu && (
                <Menu onClose={() => setMenu(false)}>
                  <MenuItem onClick={copyLink}>
                    <span className="flex items-center gap-2">
                      <IconLink size={14} /> Copy link
                    </span>
                  </MenuItem>
                  <MenuItem onClick={exportMd}>
                    <span className="flex items-center gap-2">
                      <IconDownload size={14} /> Export markdown
                    </span>
                  </MenuItem>
                  <div className="label px-3 pb-1 pt-2">move to</div>
                  <div className="scroll-soft max-h-48 overflow-y-auto">
                    {p.folders
                      .filter((f) => f.id !== note.folderId)
                      .map((f) => (
                        <MenuItem key={f.id} onClick={() => p.onMove(f.id)}>
                          <span className="flex items-center gap-2">
                            <IconFolder size={14} /> <span className="truncate">{p.folderPath(f.id)}</span>
                          </span>
                        </MenuItem>
                      ))}
                  </div>
                  <div className="hairline-t my-1" />
                  <MenuItem danger onClick={() => window.confirm("Delete this note?") && p.onDelete()}>
                    <span className="flex items-center gap-2">
                      <IconTrash size={14} /> Delete note
                    </span>
                  </MenuItem>
                </Menu>
              )}
            </div>
          </div>
        }
      >
        <Crumbs chain={p.chain} onNavigate={p.onNavigate} tail={title} />
      </TopBar>

      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <article className="fade-in mx-auto w-full max-w-[760px] px-6 pb-40 pt-10 sm:px-16 sm:pt-16">
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
              type <span className="kbd">/</span> for blocks, <span className="kbd">@</span> to link, <span className="kbd">@charlie</span> to hand off a task
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
            registerInsert={p.registerInsert}
            onToast={p.onToast}
          />

          {backlinks.length > 0 && (
            <section className="hairline-t mt-16 pt-6">
              <h2 className="label mb-3 flex items-center gap-1.5">
                <IconLink size={11} /> linked from {backlinks.length} {backlinks.length === 1 ? "note" : "notes"}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {backlinks.map((n) => (
                  <NoteCard key={n.id} note={n} path={p.folderPath(n.folderId)} onOpen={() => p.onNavigate({ kind: "note", id: n.id })} />
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
                  className={`rounded-full px-3 py-1 font-mono text-[11px] ${sort === s ? "bg-[var(--accent)] text-white" : "text-[var(--ink-soft)]"}`}
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
                <NoteCard key={n.id} note={n} path={p.folder ? undefined : p.folderPath(n.folderId)} onOpen={() => p.onNavigate({ kind: "note", id: n.id })} />
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
  folderPath: (id: string) => string;
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
  const openTasks = p.notes.reduce((sum, n) => sum + (n.content.match(/^\s*[-*] \[ \]/gm)?.length ?? 0), 0);

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
                    and have <span className="mark">{openTasks} open {openTasks === 1 ? "to-do" : "to-dos"}</span>
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
                  <NoteCard key={n.id} note={n} path={p.folderPath(n.folderId)} onOpen={() => p.onNavigate({ kind: "note", id: n.id })} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

