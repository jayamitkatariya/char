"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChatPanel, BRIEF_PROMPT } from "@/components/app/ChatPanel";
import { CommandPalette } from "@/components/app/CommandPalette";
import type { EditorChange } from "@/components/app/Editor";
import { setLinkState } from "@/components/app/linkStore";
import { SettingsDialog } from "@/components/app/SettingsDialog";
import { Sidebar, type View } from "@/components/app/Sidebar";
import { MovePicker } from "@/components/app/MovePicker";
import { HomeView, ListView, NoteView, TrashView, type SaveState } from "@/components/app/Views";
import { isConfigured, loadAISettings, saveAISettings, type AISettings } from "@/lib/ai";
import { hasRunIn, isLongOutput, refreshAgentLabel, setRunFinisher, stopRunsOutside, type Run } from "@/lib/charlie";
import { isDesktop, onMenu, onOpenLink, onUpdate, userName, type AgentEvent } from "@/lib/desktop";
import { GITHUB_URL } from "@/lib/site";
import { setThemeMode, startTheme } from "@/lib/theme";
import type { Folder, Note } from "@/lib/types";
import { DEFAULT_FOLDER, subpagesOf, useWorkspace } from "@/lib/useWorkspace";

const SAVE_DELAY_MS = 500;
const SAVE_MAX_WAIT_MS = 2000;

// AI settings and chat history are keyed by account; the desktop app has exactly one.
const LOCAL_UID = "local";

/* ---------- view <-> URL (?n=note, ?f=folder, ?v=all|pinned) ---------- */

function viewFromUrl(): View {
  const q = new URLSearchParams(window.location.search);
  if (q.get("n")) return { kind: "note", id: q.get("n")! };
  if (q.get("f")) return { kind: "folder", id: q.get("f")! };
  if (q.get("v") === "all") return { kind: "all" };
  if (q.get("v") === "pinned") return { kind: "pinned" };
  if (q.get("v") === "trash") return { kind: "trash" };
  return { kind: "home" };
}

function urlFor(v: View) {
  switch (v.kind) {
    case "note":
      return `/notes?n=${v.id}`;
    case "folder":
      return `/notes?f=${v.id}`;
    case "all":
    case "pinned":
    case "trash":
      return `/notes?v=${v.kind}`;
    default:
      return "/notes";
  }
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <main className="drag flex h-dvh flex-col items-center justify-center gap-3 bg-[var(--paper)]">
      <span className="logo animate-pulse text-[28px]">{"{char}"}</span>
      <span className="label">{children}</span>
    </main>
  );
}

const noop = () => () => {};

export default function NotesPage() {
  // The workspace reads window on its first render, so it waits for the client.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return <Splash>opening your notepad…</Splash>;
  if (!isDesktop()) return <GetTheApp />;
  return <Workspace />;
}

// Notes are stored on the Mac, so the notepad itself only exists in the desktop app.
function GetTheApp() {
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-4 bg-[var(--paper)] p-8 text-center">
      <span className="logo text-[28px]">{"{char}"}</span>
      <p className="max-w-sm text-[15px] text-[var(--ink-soft)]">char is a Mac app. Your notes live on your Mac, not on a server.</p>
      <a className="btn btn-primary" href={GITHUB_URL} target="_blank" rel="noopener">
        Download on GitHub
      </a>
    </main>
  );
}

function Workspace() {
  const ws = useWorkspace();
  const { folders, notes } = ws;
  const uid = LOCAL_UID;
  const [username] = useState(userName);

  // This component only renders in the browser, so reading window here is safe.
  const [view, setView] = useState<View>(viewFromUrl);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobile); // desktop: docked; mobile: drawer
  const [chatOpen, setChatOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [moving, setMoving] = useState<string | null>(null); // the note the "Move to…" picker is for
  const [settingsTab, setSettingsTab] = useState<null | "ai" | "agents" | "data" | "storage">(null);
  const [ai, setAI] = useState<AISettings | null>(() => loadAISettings(uid));
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  type Toast = { text: string; action?: { label: string; run: () => void }; at: number };
  const [toast, setToastState] = useState<Toast | null>(null);
  const setToast = useCallback((text: string | null, action?: Toast["action"]) => setToastState(text ? { text, action, at: Date.now() } : null), []);
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null);

  const pending = useRef(new Map<string, { patch: Partial<Note>; timer: ReturnType<typeof setTimeout>; since: number }>());
  const insertRef = useRef<((markdown: string) => void) | null>(null);
  const openNote = useRef<string | null>(null); // the note on screen, for the empty-note cleanup
  const discardIfEmpty = useRef<(id: string) => void>(() => {});
  const [canInsert, setCanInsert] = useState(false);

  /* ---------- boot ---------- */

  useEffect(() => startTheme(), []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => {
      setIsMobile(mq.matches);
      setSidebarOpen(!mq.matches);
    };
    mq.addEventListener("change", apply);
    const onPop = () => setView(viewFromUrl());
    window.addEventListener("popstate", onPop);
    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // Save failures surface as a toast too. One with an Undo stays a little longer.
  const shownToast: Toast | null = toast ?? (ws.error ? { text: ws.error, at: 0 } : null);
  const clearError = useRef(ws.clearError);
  useEffect(() => {
    clearError.current = ws.clearError;
  });
  useEffect(() => {
    if (!shownToast) return;
    const t = setTimeout(
      () => {
        setToastState(null);
        clearError.current();
      },
      shownToast.action ? 6000 : 2600,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownToast?.text, shownToast?.at]);

  /* ---------- lookups ---------- */

  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const chainOf = useCallback(
    (id: string) => {
      const chain: Folder[] = [];
      let cur = folderById.get(id);
      while (cur && chain.length < 32) {
        chain.unshift(cur);
        cur = cur.parentId ? folderById.get(cur.parentId) : undefined;
      }
      return chain;
    },
    [folderById],
  );
  const folderPath = useCallback((id: string) => chainOf(id).map((f) => f.name).join(" / ") || "Notes", [chainOf]);

  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  /** The pages a subpage sits inside, outermost first. */
  const pagesAbove = useCallback(
    (n: Note) => {
      const chain: Note[] = [];
      let cur = n.parentId ? noteById.get(n.parentId) : undefined;
      while (cur && chain.length < 64 && cur.id !== n.id) {
        chain.unshift(cur);
        cur = cur.parentId ? noteById.get(cur.parentId) : undefined;
      }
      return chain;
    },
    [noteById],
  );
  /** Where a note lives: its folder path, then the pages it sits inside. */
  const notePath = useCallback(
    (n: Note) => [folderPath(n.folderId), ...pagesAbove(n).map((p) => p.title.trim() || "Untitled")].join(" / "),
    [folderPath, pagesAbove],
  );
  const isTopLevel = (n: Note) => !n.parentId || !noteById.has(n.parentId);

  const currentNote = view.kind === "note" ? (notes.find((n) => n.id === view.id) ?? null) : null;
  const activeFolderId = view.kind === "folder" ? view.id : (currentNote?.folderId ?? null);

  /* ---------- navigation ---------- */

  const navigate = useCallback(
    (v: View) => {
      setView(v);
      const url = urlFor(v);
      if (window.location.pathname + window.location.search !== url) window.history.pushState(null, "", url);
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile],
  );

  // @-link chips read titles and navigate through this store.
  useEffect(() => {
    const titles = new Map<string, string>();
    for (const f of folders) titles.set(f.id, f.name);
    for (const n of notes) titles.set(n.id, n.title.trim() || "Untitled");
    setLinkState({ titles, open: (kind, id) => navigate(kind === "folder" ? { kind: "folder", id } : { kind: "note", id }) });
  }, [folders, notes, navigate]);

  /* ---------- note mutations (debounced while typing) ---------- */

  const flush = async (id: string, patch: Partial<Note>) => {
    setSaveState("saving");
    try {
      await ws.updateNote(id, patch);
      if (pending.current.size === 0) setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const queueSave = (id: string, patch: Partial<Note>) => {
    const entry = pending.current.get(id);
    if (entry) clearTimeout(entry.timer);
    const merged = { ...(entry?.patch ?? {}), ...patch };
    const since = entry?.since ?? Date.now();
    // Typing without a pause still saves at least every couple of seconds.
    const wait = Math.max(0, Math.min(SAVE_DELAY_MS, since + SAVE_MAX_WAIT_MS - Date.now()));
    const timer = setTimeout(() => {
      pending.current.delete(id);
      flush(id, merged);
    }, wait);
    pending.current.set(id, { patch: merged, timer, since });
    setSaveState("saving");
  };

  // Writes any typing still waiting in the debounce for this note.
  const settle = async (id: string) => {
    const entry = pending.current.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.current.delete(id);
    await flush(id, entry.patch);
  };

  const saveNow = (id: string, patch: Partial<Note>) => {
    const entry = pending.current.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.current.delete(id);
    }
    flush(id, { ...(entry?.patch ?? {}), ...patch });
  };

  // Don't lose the last keystrokes when the window closes.
  useEffect(() => {
    const flushAll = () => {
      for (const [id, { patch, timer }] of pending.current) {
        clearTimeout(timer);
        ws.updateNote(id, patch);
      }
      pending.current.clear();
      if (openNote.current) discardIfEmpty.current(openNote.current);
    };
    window.addEventListener("pagehide", flushAll);
    // Electron silently cancels the close if beforeunload is prevented, so save instead of asking.
    window.addEventListener("beforeunload", flushAll);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      window.removeEventListener("beforeunload", flushAll);
    };
  }, [ws]);

  const targetFolder = (preferred?: string) => {
    if (preferred && folderById.has(preferred)) return preferred;
    if (activeFolderId && folderById.has(activeFolderId)) return activeFolderId;
    if (folderById.has(DEFAULT_FOLDER)) return DEFAULT_FOLDER;
    return folders[0]?.id ?? DEFAULT_FOLDER;
  };

  const ensureFolder = async (id: string) => {
    if (!folderById.has(id)) await ws.importData({ folders: [{ id, name: "Notes", parentId: null }], notes: [] });
  };

  const createNote = async (folderId?: string, title = "", open = true) => {
    const fid = targetFolder(folderId);
    await ensureFolder(fid);
    const note = await ws.createNote(fid, { title });
    if (open) navigate({ kind: "note", id: note.id });
    return note;
  };

  const deleteNote = async (id: string) => {
    const entry = pending.current.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.current.delete(id);
    }
    const doomed = notes.find((n) => n.id === id);
    const inside = doomed ? subpagesOf(notes, id) : new Set<string>();
    await ws.deleteNote(id);
    // Deleting from the sidebar leaves you where you are, unless you were in that note (or a page inside it).
    if (view.kind === "note" && (view.id === id || inside.has(view.id))) {
      const parent = doomed?.parentId ? noteById.get(doomed.parentId) : undefined;
      navigate(parent ? { kind: "note", id: parent.id } : doomed && folderById.has(doomed.folderId) ? { kind: "folder", id: doomed.folderId } : { kind: "home" });
    }
    const wasOpen = view.kind === "note" && (view.id === id || inside.has(view.id)) ? view.id : null;
    setToast(inside.size ? `Moved to Trash with ${inside.size} page${inside.size === 1 ? "" : "s"} inside` : "Moved to Trash", {
      label: "Undo",
      run: async () => {
        await ws.restoreNote(id);
        if (wasOpen) navigate({ kind: "note", id: wasOpen });
      },
    });
  };

  const togglePin = (id: string) => {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    saveNow(id, { pinned: !note.pinned });
    setToast(note.pinned ? "Unpinned" : "Pinned");
  };

  // To the top level of a folder.
  const moveNote = async (id: string, folderId: string) => {
    const n = noteById.get(id);
    if (!n || (n.folderId === folderId && isTopLevel(n))) return;
    await ws.moveNote(id, { folderId });
    setToast(`Moved to ${folderPath(folderId)}`);
  };

  // Inside another page.
  const nestNote = async (id: string, parentId: string) => {
    const parent = noteById.get(parentId);
    if (!parent || id === parentId || noteById.get(id)?.parentId === parentId || subpagesOf(notes, id).has(parentId)) return;
    await ws.moveNote(id, { parentId });
    setToast(`Moved into “${parent.title.trim() || "Untitled"}”`);
  };

  const createSubpage = async (parentId: string, open = true) => {
    const parent = ws.getNote(parentId);
    if (!parent) throw new Error("That page is gone");
    const note = await ws.createNote(parent.folderId, { parentId });
    if (open) navigate({ kind: "note", id: note.id });
    return note;
  };

  const duplicateNote = async (id: string) => {
    await settle(id);
    const src = ws.getNote(id);
    if (!src) return;
    const copy = await ws.createNote(src.folderId, {
      title: `${src.title.trim() || "Untitled"} copy`,
      content: src.content,
      blocks: src.blocks,
      links: src.links,
    });
    navigate({ kind: "note", id: copy.id });
  };

  const copyLink = async (id: string) => {
    // char:// links open this note in the app from anywhere (Messages, Mail, a terminal).
    await navigator.clipboard.writeText(`char://note/${id}`);
    setToast("Link copied");
  };

  /* ---------- empty notes don't pile up ---------- */

  // A note left with no title and no text (a stray ⌘N) is dropped once you move on.
  useEffect(() => {
    discardIfEmpty.current = (id) => {
      const n = ws.getNote(id);
      if (!n || pending.current.has(id) || n.title.trim() || n.content.trim() || n.pinned || hasRunIn(id)) return;
      // Kept while another note points at it (an @-link or a /page row) or it holds pages of its own.
      if (ws.notes.some((o) => o.links?.includes(id) || o.parentId === id)) return;
      ws.purgeNote(id).catch(() => {}); // not worth a place in the Trash
    };
  });
  useEffect(() => {
    const left = openNote.current;
    openNote.current = view.kind === "note" ? view.id : null;
    if (!left || left === openNote.current) return;
    // Typing still in the debounce is written first, so a note that just got its first words stays.
    void settle(left).then(() => discardIfEmpty.current(left));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Created with a placeholder name; the sidebar or folder page opens it for renaming.
  const createFolder = async (parentId: string | null, open = true) => {
    const f = await ws.createFolder("New folder", parentId);
    if (open) navigate({ kind: "folder", id: f.id });
    return f;
  };

  const deleteFolder = async (id: string) => {
    const name = folderById.get(id)?.name ?? "Folder";
    if (activeFolderId && chainOf(activeFolderId).some((f) => f.id === id)) navigate({ kind: "home" });
    const undo = await ws.deleteFolder(id);
    setToast(`Deleted “${name}”; its notes are in the Trash`, { label: "Undo", run: () => void ws.undoDeleteFolder(undo) });
  };

  /* ---------- AI ---------- */

  const aiReady = isConfigured(ai);
  const ask = (question?: string) => {
    setChatOpen(true);
    if (question) setPendingQuestion(question);
  };

  const openNoteByTitle = (title: string) => {
    const t = title.trim().toLowerCase();
    const hit = notes.find((n) => (n.title.trim() || "Untitled").toLowerCase() === t) ?? notes.find((n) => n.title.toLowerCase().includes(t));
    if (hit) navigate({ kind: "note", id: hit.id });
    else setToast(`No note called “${title}”`);
  };

  const registerInsert = useCallback((fn: ((markdown: string) => void) | null) => {
    insertRef.current = fn;
    setCanInsert(!!fn);
  }, []);

  /* ---------- @charlie: where a finished run's answer goes ---------- */

  const finishRun = useRef<(run: Run, e: Extract<AgentEvent, { type: "done" | "error" | "stopped" }>) => Promise<void>>(async () => {});
  // Answers for the same note land one at a time, so two can't both start from the same copy.
  const landing = useRef(new Map<string, Promise<void>>());
  useEffect(() => {
    finishRun.current = async (run, e) => {
      // Everything async that isn't about this note happens first.
      const [{ applyRunResult, findRun }, { openEditor }, { applyRunToStoredNote }] = await Promise.all([
        import("@/components/app/editorSchema"),
        import("@/components/app/editorRegistry"),
        import("@/components/app/offscreen"),
      ]);
      const origin = ws.getNote(run.noteId);
      // The card may have been deleted while charlie worked (that stops the run, but it can finish first).
      const cardThere = () => {
        const editor = openEditor(run.noteId);
        if (editor) return !!findRun(editor, run.id);
        return !!ws.getNote(run.noteId)?.blocks?.includes(run.id);
      };
      if (!cardThere()) return;
      type Result = Parameters<typeof applyRunResult>[2];
      let result: Result;
      if (e.type === "done" && isLongOutput(e.output)) {
        const title = `charlie: ${run.task.length > 60 ? `${run.task.slice(0, 57)}…` : run.task}`;
        const created = await ws.createNote(origin && folderById.has(origin.folderId) ? origin.folderId : targetFolder(), { title, content: e.output });
        result = { kind: "link", noteId: created.id, title, lines: e.output.split("\n").length };
      } else if (e.type === "done") {
        result = { kind: "inline", markdown: e.output };
      } else {
        result = { kind: e.type, message: e.type === "error" ? e.message : "Stopped." };
      }
      if (e.type === "done") {
        result.footer = {
          agent: run.agent,
          agentId: run.agentId ?? "",
          sessionId: e.sessionId ?? run.sessionId ?? "",
          durationMs: (run.finishedAt ?? Date.now()) - run.startedAt,
          notice: e.notice ?? "",
        };
      }

      const land = async () => {
        if (!openEditor(run.noteId)) await settle(run.noteId);
        // Checked again after the await: the note may have been opened meanwhile.
        const editor = openEditor(run.noteId);
        if (editor) {
          applyRunResult(editor, run.id, result); // the editor's change event saves it
          return;
        }
        const fresh = ws.getNote(run.noteId);
        const patch = fresh && applyRunToStoredNote(fresh, run.id, result);
        if (patch) await ws.updateNote(run.noteId, patch);
      };
      const queued = (landing.current.get(run.noteId) ?? Promise.resolve()).then(land, land);
      landing.current.set(run.noteId, queued);
      await queued;

      const here = view.kind === "note" && view.id === run.noteId;
      const where = origin && !here ? ` in “${origin.title.trim() || "Untitled"}”` : "";
      if (e.type === "done") setToast(result.kind === "link" ? `charlie wrote “${result.title}”${where}` : `charlie finished${where}`);
      else if (e.type === "error") setToast(`charlie couldn't finish${where}`);
    };
  });
  useEffect(() => setRunFinisher((run, e) => void finishRun.current(run, e).catch((err: Error) => setToast(`charlie: ${err.message}`))), [setToast]);
  useEffect(() => {
    refreshAgentLabel();
  }, []);
  // Deleting a note (or its folder) stops charlie's runs in it.
  useEffect(() => stopRunsOutside(new Set(notes.map((n) => n.id))), [notes]);

  /* ---------- the menu bar and char:// links ---------- */

  const menuAction = useRef<(action: string) => void>(() => {});
  useEffect(() => {
    menuAction.current = (action) => {
      if (action === "settings") setSettingsTab("ai");
      else if (action === "new-note") createNote();
      else if (action === "new-folder") createFolder(null);
      else if (action === "search") setPalette(true);
      else if (action === "ask") setChatOpen((c) => !c);
      else if (action === "toggle-sidebar") setSidebarOpen((s) => !s);
      else if (action === "home") navigate({ kind: "home" });
      else if (action.startsWith("theme-")) setThemeMode(action.slice(6) as "system" | "light" | "dark");
    };
  });
  useEffect(() => onMenu((a) => menuAction.current(a)), []);
  useEffect(() => onUpdate(setUpdate), []);
  useEffect(() => onOpenLink((t) => navigate(t.kind === "folder" ? { kind: "folder", id: t.id } : { kind: "note", id: t.id })), [navigate]);

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (k === "j") {
        e.preventDefault();
        setChatOpen((c) => !c);
      } else if (k === "n" && !e.shiftKey) {
        e.preventDefault();
        createNote();
      } else if (k === "h" && e.shiftKey) {
        e.preventDefault();
        navigate({ kind: "home" });
      } else if (k === "p" && e.shiftKey && currentNote) {
        e.preventDefault();
        togglePin(currentNote.id);
      } else if (k === "\\") {
        e.preventDefault();
        setSidebarOpen((s) => !s);
      } else if (k === "t" && e.shiftKey && view.kind === "note") {
        e.preventDefault();
        window.dispatchEvent(new Event("char:tidy"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------- render ---------- */

  if (!ws.loaded) return <Splash>{ws.error ?? "loading your notes…"}</Splash>;

  const bar = {
    sidebarHidden: !sidebarOpen,
    onShowSidebar: () => setSidebarOpen(true),
    chatOpen,
    onToggleChat: () => setChatOpen((c) => !c),
  };

  // A link to a note that's gone (deleted elsewhere, or a stale URL).
  const missing =
    (view.kind === "note" && !currentNote) || (view.kind === "folder" && !folderById.has(view.id));

  let main: React.ReactNode;
  if (missing) {
    main = (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="font-hand -rotate-2 text-[30px] text-[var(--ink-soft)]">this page wandered off</p>
        <p className="text-[14px] text-[var(--ink-soft)]">It may have been deleted or moved.</p>
        <button className="btn" onClick={() => navigate({ kind: "home" })}>
          Back to today
        </button>
      </div>
    );
  } else if (view.kind === "note" && currentNote) {
    main = (
      <NoteView
        key={currentNote.id}
        note={currentNote}
        notes={notes}
        folders={folders}
        chain={chainOf(currentNote.folderId)}
        pages={pagesAbove(currentNote)}
        subpages={notes.filter((n) => n.parentId === currentNote.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))}
        folderPath={folderPath}
        notePath={notePath}
        saveState={ws.error ? "error" : saveState}
        bar={bar}
        onNavigate={navigate}
        onTitle={(title) => queueSave(currentNote.id, { title })}
        onEditorChange={(c: EditorChange) => queueSave(currentNote.id, c)}
        onTogglePin={() => togglePin(currentNote.id)}
        onPickFolder={() => setMoving(currentNote.id)}
        onCopyLink={() => copyLink(currentNote.id)}
        onDelete={() => deleteNote(currentNote.id)}
        onCreateNote={(title) => createNote(currentNote.folderId, title, false)}
        onCreateSubpage={(open) => createSubpage(currentNote.id, open)}
        registerInsert={registerInsert}
        onToast={setToast}
      />
    );
  } else if (view.kind === "folder") {
    const folder = folderById.get(view.id)!;
    main = (
      <ListView
        key={folder.id}
        heading={folder.name}
        kicker="folder"
        folder={folder}
        chain={chainOf(folder.id)}
        subfolders={folders.filter((f) => f.parentId === folder.id).sort((a, b) => a.name.localeCompare(b.name))}
        notes={notes.filter((n) => n.folderId === folder.id && isTopLevel(n))}
        folderPath={folderPath}
        notePath={notePath}
        bar={bar}
        onNavigate={navigate}
        onNewNote={() => createNote(folder.id)}
        onNewFolder={() => createFolder(folder.id)}
        onRename={(name) => ws.renameFolder(folder.id, name)}
      />
    );
  } else if (view.kind === "all" || view.kind === "pinned") {
    main = (
      <ListView
        key={view.kind}
        heading={view.kind === "all" ? "All notes" : "Pinned"}
        kicker={`${view.kind === "all" ? notes.length : notes.filter((n) => n.pinned).length} notes`}
        chain={[]}
        subfolders={view.kind === "all" ? folders.filter((f) => !f.parentId).sort((a, b) => a.name.localeCompare(b.name)) : []}
        notes={view.kind === "all" ? notes : notes.filter((n) => n.pinned)}
        folderPath={folderPath}
        notePath={notePath}
        bar={bar}
        onNavigate={navigate}
        onNewNote={() => createNote()}
      />
    );
  } else if (view.kind === "trash") {
    main = (
      <TrashView
        trash={ws.trash}
        notePath={(n) => (folderById.has(n.folderId) ? folderPath(n.folderId) : "Deleted folder")}
        bar={bar}
        onRestore={async (id) => {
          await ws.restoreNote(id);
          setToast("Restored", { label: "Open", run: () => navigate({ kind: "note", id }) });
        }}
        onPurge={(id) => void ws.purgeNote(id)}
        onEmpty={() => void ws.emptyTrash()}
      />
    );
  } else {
    main = (
      <HomeView
        username={username}
        notes={notes}
        notePath={notePath}
        aiReady={aiReady}
        bar={bar}
        onNavigate={navigate}
        onNewNote={() => createNote()}
        onBrief={() => ask(BRIEF_PROMPT)}
        onSetupAI={() => setSettingsTab("ai")}
      />
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--paper)]">
      {/* Sidebar: docked on desktop, a drawer on phones */}
      {sidebarOpen && isMobile && <div className="scrim fixed inset-0 z-30" onClick={() => setSidebarOpen(false)} />}
      <div
        className={`hairline-r z-40 h-full w-[268px] shrink-0 transition-[margin,transform] duration-200 ease-out ${
          isMobile ? `fixed inset-y-0 left-0 shadow-[var(--shadow-lg)] ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}` : sidebarOpen ? "" : "-ml-[268px]"
        }`}
      >
        <Sidebar
          folders={folders}
          notes={notes}
          view={view}
          activeFolderId={activeFolderId}
          username={username}
          aiReady={aiReady}
          onNavigate={navigate}
          onNewNote={(fid) => createNote(fid)}
          onNewFolder={(parentId) => createFolder(parentId, false)}
          onRenameFolder={(id, name) => ws.renameFolder(id, name)}
          onDeleteFolder={deleteFolder}
          onMoveNote={moveNote}
          onMoveFolder={(id, parentId) => ws.moveFolder(id, parentId)}
          onTogglePin={togglePin}
          onDuplicate={duplicateNote}
          onCopyLink={copyLink}
          onPickFolder={setMoving}
          onDeleteNote={deleteNote}
          onNewSubpage={(id) => void createSubpage(id)}
          onNestNote={nestNote}
          trashCount={ws.trash.filter((n) => !ws.trash.some((t) => t.id === n.parentId && t.deletedAt === n.deletedAt)).length}
          onSearch={() => setPalette(true)}
          onAsk={() => ask()}
          onSettings={() => setSettingsTab("ai")}
          onCollapse={() => setSidebarOpen(false)}
        />
      </div>

      <main className="flex min-w-0 flex-1 flex-col">{main}</main>

      {chatOpen && (
        <div className={`${isMobile ? "fixed inset-0 z-40" : "hairline-l h-full w-[400px] shrink-0"} fade-in`}>
          <ChatPanel
            uid={uid}
            username={username}
            settings={aiReady ? ai : null}
            folders={folders}
            notes={notes}
            currentNote={currentNote}
            pending={pendingQuestion}
            onPendingTaken={() => setPendingQuestion(null)}
            onClose={() => setChatOpen(false)}
            onSetup={() => setSettingsTab("ai")}
            onOpenNoteByTitle={openNoteByTitle}
            onInsert={canInsert && currentNote ? (md) => (insertRef.current?.(md), setToast("Added to the note")) : null}
            onSaveAsNote={async (title, md) => {
              const note = await createNote(undefined, title, false);
              await ws.updateNote(note.id, { content: md });
              navigate({ kind: "note", id: note.id });
            }}
          />
        </div>
      )}

      {palette && (
        <CommandPalette
          notes={notes}
          folders={folders}
          folderPath={folderPath}
          notePath={notePath}
          onClose={() => setPalette(false)}
          onNavigate={navigate}
          onNewNote={(title) => createNote(undefined, title ?? "")}
          onNewFolder={() => createFolder(null)}
          onAsk={(q) => ask(q)}
          onSettings={() => setSettingsTab("ai")}
          onAgentSettings={() => setSettingsTab("agents")}
          current={currentNote ? { title: currentNote.title, pinned: currentNote.pinned } : null}
          onTogglePin={() => currentNote && togglePin(currentNote.id)}
          onMoveNote={() => currentNote && setMoving(currentNote.id)}
          onNewSubpage={() => currentNote && void createSubpage(currentNote.id)}
        />
      )}

      {moving && noteById.has(moving) && (
        <MovePicker
          note={noteById.get(moving)!}
          folders={folders}
          pages={notes.filter((n) => n.id !== moving && !subpagesOf(notes, moving).has(n.id) && n.id !== noteById.get(moving)!.parentId)}
          isTopLevel={isTopLevel(noteById.get(moving)!)}
          folderPath={folderPath}
          notePath={notePath}
          onPickFolder={(folderId) => moveNote(moving, folderId)}
          onPickPage={(pageId) => nestNote(moving, pageId)}
          onCreate={async (name) => {
            const f = await ws.createFolder(name, null);
            await ws.moveNote(moving, { folderId: f.id });
            setToast(`Moved to ${name}`);
          }}
          onClose={() => setMoving(null)}
        />
      )}

      {settingsTab && (
        <SettingsDialog
          initialTab={settingsTab}
          settings={ai}
          data={{ folders, notes }}
          onSave={(s) => {
            saveAISettings(uid, s);
            setAI(s);
          }}
          onImport={ws.importData}
          onClose={() => setSettingsTab(null)}
        />
      )}

      {update && (
        <div className="pop-in fixed bottom-5 right-5 z-[55] flex items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--card)] py-1.5 pl-4 pr-1.5 text-[13px] shadow-[var(--shadow-lg)]">
          <span>char {update.version} is out</span>
          <a className="btn btn-primary btn-sm" href={update.url} target="_blank" rel="noopener">
            Download
          </a>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setUpdate(null)}>
            ×
          </button>
        </div>
      )}

      {shownToast && (
        <div
          key={shownToast.at}
          role="status"
          className="pop-in fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full bg-[var(--accent)] px-4 py-2 text-[13px] text-[var(--on-accent)] shadow-[var(--shadow-lg)]"
        >
          <span>{shownToast.text}</span>
          {shownToast.action && (
            <button
              className="-my-1 -mr-2 rounded-full px-2.5 py-1 font-medium underline-offset-2 hover:underline"
              onClick={() => {
                shownToast.action?.run();
                setToastState(null);
              }}
            >
              {shownToast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
