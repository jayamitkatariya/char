"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChatPanel, BRIEF_PROMPT } from "@/components/app/ChatPanel";
import { CommandPalette } from "@/components/app/CommandPalette";
import type { EditorChange } from "@/components/app/Editor";
import { setLinkState } from "@/components/app/linkStore";
import { SettingsDialog } from "@/components/app/SettingsDialog";
import { Sidebar, type View } from "@/components/app/Sidebar";
import { HomeView, ListView, NoteView, type SaveState } from "@/components/app/Views";
import { isConfigured, loadAISettings, saveAISettings, type AISettings } from "@/lib/ai";
import { isDesktop, userName } from "@/lib/desktop";
import { GITHUB_URL } from "@/lib/site";
import type { Folder, Note } from "@/lib/types";
import { DEFAULT_FOLDER, useWorkspace } from "@/lib/useWorkspace";

const SAVE_DELAY_MS = 500;

// AI settings and chat history are keyed by account; the desktop app has exactly one.
const LOCAL_UID = "local";

/* ---------- view <-> URL (?n=note, ?f=folder, ?v=all|pinned) ---------- */

function viewFromUrl(): View {
  const q = new URLSearchParams(window.location.search);
  if (q.get("n")) return { kind: "note", id: q.get("n")! };
  if (q.get("f")) return { kind: "folder", id: q.get("f")! };
  if (q.get("v") === "all") return { kind: "all" };
  if (q.get("v") === "pinned") return { kind: "pinned" };
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
  const [settingsTab, setSettingsTab] = useState<null | "ai" | "data" | "storage">(null);
  const [ai, setAI] = useState<AISettings | null>(() => loadAISettings(uid));
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const pending = useRef(new Map<string, { patch: Partial<Note>; timer: ReturnType<typeof setTimeout> }>());
  const insertRef = useRef<((markdown: string) => void) | null>(null);
  const [canInsert, setCanInsert] = useState(false);

  /* ---------- boot ---------- */

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

  // Save failures surface as a toast too.
  const shownToast = toast ?? ws.error;
  useEffect(() => {
    if (!shownToast) return;
    const t = setTimeout(() => {
      setToast(null);
      ws.clearError();
    }, 2600);
    return () => clearTimeout(t);
  }, [shownToast, ws]);

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
    const timer = setTimeout(() => {
      pending.current.delete(id);
      flush(id, merged);
    }, SAVE_DELAY_MS);
    pending.current.set(id, { patch: merged, timer });
    setSaveState("saving");
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
    const folderId = notes.find((n) => n.id === id)?.folderId;
    await ws.deleteNote(id);
    navigate(folderId && folderById.has(folderId) ? { kind: "folder", id: folderId } : { kind: "home" });
    setToast("Note deleted");
  };

  // Created with a placeholder name; the sidebar or folder page opens it for renaming.
  const createFolder = async (parentId: string | null, open = true) => {
    const f = await ws.createFolder("New folder", parentId);
    if (open) navigate({ kind: "folder", id: f.id });
    return f;
  };

  const deleteFolder = async (id: string) => {
    if (activeFolderId && chainOf(activeFolderId).some((f) => f.id === id)) navigate({ kind: "home" });
    await ws.deleteFolder(id);
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
      } else if (k === "\\") {
        e.preventDefault();
        setSidebarOpen((s) => !s);
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
        folderPath={folderPath}
        saveState={ws.error ? "error" : saveState}
        bar={bar}
        onNavigate={navigate}
        onTitle={(title) => queueSave(currentNote.id, { title })}
        onEditorChange={(c: EditorChange) => queueSave(currentNote.id, c)}
        onTogglePin={() => saveNow(currentNote.id, { pinned: !currentNote.pinned })}
        onMove={(folderId) => {
          saveNow(currentNote.id, { folderId });
          setToast(`Moved to ${folderPath(folderId)}`);
        }}
        onDelete={() => deleteNote(currentNote.id)}
        onCreateNote={(title) => createNote(currentNote.folderId, title, false)}
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
        notes={notes.filter((n) => n.folderId === folder.id)}
        folderPath={folderPath}
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
        bar={bar}
        onNavigate={navigate}
        onNewNote={() => createNote()}
      />
    );
  } else {
    main = (
      <HomeView
        username={username}
        notes={notes}
        folderPath={folderPath}
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
      {sidebarOpen && isMobile && <div className="fixed inset-0 z-30 bg-[rgba(43,38,32,0.2)]" onClick={() => setSidebarOpen(false)} />}
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
          onMoveNote={(noteId, folderId) => {
            if (notes.find((n) => n.id === noteId)?.folderId === folderId) return;
            saveNow(noteId, { folderId });
            setToast(`Moved to ${folderPath(folderId)}`);
          }}
          onMoveFolder={(id, parentId) => ws.moveFolder(id, parentId)}
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
          onClose={() => setPalette(false)}
          onNavigate={navigate}
          onNewNote={(title) => createNote(undefined, title ?? "")}
          onNewFolder={() => createFolder(null)}
          onAsk={(q) => ask(q)}
          onSettings={() => setSettingsTab("ai")}
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

      {shownToast && (
        <div className="pop-in fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[var(--accent)] px-4 py-2 text-[13px] text-white shadow-[var(--shadow-lg)]">
          {shownToast}
        </div>
      )}
    </div>
  );
}
