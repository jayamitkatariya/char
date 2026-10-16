"use client";

import { useEffect, useRef, useState } from "react";
import { isConfigured, listModels, PRESETS, type AISettings } from "@/lib/ai";
import { elapsed, refreshAgentLabel } from "@/lib/charlie";
import { CONNECTORS, setupPrompt } from "@/lib/connectors";
import {
  agentBridge,
  cliBridge,
  dataPath,
  revealData,
  type AgentConfig,
  type AgentId,
  type AgentLevel,
  type AgentStatus,
  type AgentStep,
  type BuiltInAgent,
  type DetectedAgents,
} from "@/lib/desktop";
import { setThemeMode, useTheme, type ThemeMode } from "@/lib/theme";
import { newId, type WorkspaceData } from "@/lib/useWorkspace";
import { IconCheck, IconDownload, IconFolder, IconMonitor, IconMoon, IconRetry, IconSparkle, IconSun, IconTerminal, IconUpload, IconX } from "../icons";
import { Markdown } from "./Markdown";

type Tab = "appearance" | "ai" | "agents" | "data" | "storage";

type Props = {
  initialTab?: Tab;
  settings: AISettings | null;
  data: WorkspaceData;
  onSave: (s: AISettings | null) => void;
  onImport: (data: WorkspaceData) => Promise<number>;
  onClose: () => void;
};

const presetFor = (s: AISettings | null) =>
  s ? (PRESETS.find((p) => p.provider === s.provider && p.baseUrl === s.baseUrl)?.id ?? "custom") : "anthropic";

export function SettingsDialog(p: Props) {
  const [tab, setTab] = useState<Tab>(p.initialTab ?? "ai");
  const box = useRef<HTMLDivElement>(null);

  const close = useRef(p.onClose);
  useEffect(() => {
    close.current = p.onClose;
  });

  // Modal: take focus from the note behind it, and close on Escape wherever focus ended up.
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="scrim fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={p.onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="card pop-in flex max-h-[90dvh] w-full max-w-[560px] flex-col overflow-hidden !rounded-3xl !shadow-[var(--shadow-lg)] outline-none"
        ref={box}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 px-6 pb-2 pt-5">
          <h2 className="font-serif flex-1 text-[24px] font-semibold">Settings</h2>
          <button className="icon-btn" onClick={p.onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </header>
        <div className="hairline-b flex gap-1 px-5">
          {(
            [
              ["ai", "AI model"],
              ["agents", "Agents"],
              ["appearance", "Appearance"],
              ["data", "Import & export"],
              ["storage", "Storage"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={`relative px-2.5 py-2.5 text-[13.5px] ${tab === id ? "font-medium text-[var(--ink)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"}`}
              onClick={() => setTab(id)}
            >
              {label}
              {tab === id && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[var(--accent)]" />}
            </button>
          ))}
        </div>
        <div className="scroll-soft overflow-y-auto px-6 py-5">
          {tab === "ai" && <AITab settings={p.settings} onSave={p.onSave} />}
          {tab === "agents" && <AgentsTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "data" && <DataTab data={p.data} onImport={p.onImport} />}
          {tab === "storage" && (
            <div className="space-y-4">
              <p className="text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
                Your notes and folders are saved as one file on this Mac, written as you type. Nothing is uploaded. Back it up or
                move it like any other file; Import &amp; export reads and writes the same format.
              </p>
              <div className="card break-all px-3 py-2 font-mono text-[12px] text-[var(--ink-soft)]">{dataPath()}</div>
              <button className="btn" onClick={revealData}>
                Show in Finder
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AppearanceTab() {
  const { mode } = useTheme();
  const options: [ThemeMode, string, React.ReactNode][] = [
    ["system", "Match System", <IconMonitor key="s" size={18} />],
    ["light", "Light", <IconSun key="l" size={18} />],
    ["dark", "Dark", <IconMoon key="d" size={18} />],
  ];
  return (
    <div className="space-y-4">
      <p className="text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
        Match System follows macOS, switching with it. The window, menus and editor all change together. Also in View → Appearance.
      </p>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Appearance">
        {options.map(([id, label, icon]) => (
          <button
            key={id}
            role="radio"
            aria-checked={mode === id}
            className={`flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-[13px] transition-colors ${
              mode === id ? "border-transparent bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--hairline)] bg-[var(--card)] hover:bg-[var(--hover)]"
            }`}
            onClick={() => setThemeMode(id)}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AITab({ settings, onSave }: { settings: AISettings | null; onSave: (s: AISettings | null) => void }) {
  const [preset, setPreset] = useState(presetFor(settings));
  const [draft, setDraft] = useState<AISettings>(
    settings ?? { provider: "anthropic", baseUrl: PRESETS[0].baseUrl, apiKey: "", model: PRESETS[0].model },
  );
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "busy" | "ok" | "error"; msg?: string }>({ kind: "idle" });
  const [saved, setSaved] = useState(false);

  const choose = (id: string) => {
    const pr = PRESETS.find((x) => x.id === id)!;
    setPreset(id);
    setModels(null);
    setStatus({ kind: "idle" });
    // Custom starts blank rather than inheriting the last preset's URL.
    setDraft((d) => ({ ...d, provider: pr.provider, baseUrl: pr.baseUrl, model: pr.model }));
  };

  const fetchModels = async () => {
    setStatus({ kind: "busy" });
    try {
      const ids = await listModels(draft);
      setModels(ids);
      setStatus({ kind: "ok", msg: `Connected · ${ids.length} models` });
      if (!draft.model && ids.length) setDraft((d) => ({ ...d, model: ids[0] }));
    } catch (e) {
      setModels(null);
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({
        kind: "error",
        msg: /failed to fetch|networkerror|load failed/i.test(msg)
          ? "Couldn't reach that URL (offline, wrong URL, or the server blocks cross-origin requests / CORS)."
          : msg,
      });
    }
  };

  const hint = PRESETS.find((x) => x.id === preset)?.hint;

  return (
    <div className="space-y-5">
      <p className="text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
        <span className="text-[var(--sun)]">
          <IconSparkle size={13} className="inline -mt-0.5" />
        </span>{" "}
        AI is optional. Bring your own key: it&apos;s stored only on this Mac and sent only to the provider below.
      </p>

      <div>
        <span className="label mb-2 block">provider</span>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((pr) => (
            <button
              key={pr.id}
              className={`rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${
                preset === pr.id ? "border-transparent bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--hairline)] bg-[var(--card)] hover:bg-[var(--hover)]"
              }`}
              onClick={() => choose(pr.id)}
            >
              {pr.label}
            </button>
          ))}
        </div>
        {hint && <p className="mt-2 text-[12.5px] text-[var(--ink-soft)]">{hint}</p>}
      </div>

      <label className="block">
        <span className="label mb-1.5 block">base url</span>
        <input
          className="input font-mono !text-[13px]"
          value={draft.baseUrl}
          placeholder={draft.provider === "anthropic" ? "https://api.anthropic.com" : "https://your-endpoint/v1"}
          onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
          spellCheck={false}
        />
        {preset === "custom" && (
          <span className="mt-1.5 flex gap-3 text-[12px] text-[var(--ink-soft)]">
            API format:
            {(["openai", "anthropic"] as const).map((pv) => (
              <label key={pv} className="flex items-center gap-1">
                <input type="radio" checked={draft.provider === pv} onChange={() => setDraft({ ...draft, provider: pv })} />
                {pv === "openai" ? "OpenAI-compatible" : "Anthropic"}
              </label>
            ))}
          </span>
        )}
      </label>

      <label className="block">
        <span className="label mb-1.5 block">api key</span>
        <div className="relative">
          <input
            className="input pr-16 font-mono !text-[13px]"
            type={showKey ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={draft.apiKey}
            placeholder={preset === "ollama" ? "not needed" : "paste your key"}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value.trim() })}
          />
          <button
            type="button"
            className="label absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 hover:bg-[var(--hover)] hover:text-[var(--ink)]"
            onClick={() => setShowKey((s) => !s)}
          >
            {showKey ? "hide" : "show"}
          </button>
        </div>
      </label>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label">model</span>
          <button className="btn btn-sm" onClick={fetchModels} disabled={!draft.baseUrl || status.kind === "busy"}>
            {status.kind === "busy" ? "Fetching…" : "Fetch models"}
          </button>
        </div>
        <input
          className="input font-mono !text-[13px]"
          list="char-models"
          value={draft.model}
          placeholder="pick from the list or type a model id"
          onChange={(e) => setDraft({ ...draft, model: e.target.value.trim() })}
          spellCheck={false}
        />
        <datalist id="char-models">{models?.map((m) => <option key={m} value={m} />)}</datalist>
        {models && models.length > 0 && (
          <div className="scroll-soft mt-2 max-h-40 overflow-y-auto rounded-xl border border-[var(--hairline)] p-1">
            {models.map((m) => (
              <button
                key={m}
                className="row flex w-full items-center justify-between px-2.5 py-1.5 text-left font-mono text-[12.5px]"
                data-selected={draft.model === m}
                onClick={() => setDraft({ ...draft, model: m })}
              >
                {m}
                {draft.model === m && <IconCheck size={13} />}
              </button>
            ))}
          </div>
        )}
        {status.msg && (
          <p className={`mt-2 text-[12.5px] ${status.kind === "error" ? "text-[var(--danger)]" : "text-[var(--success)]"}`} role="status">
            {status.msg}
          </p>
        )}
      </div>

      <div className="hairline-t flex items-center gap-2 pt-4">
        {settings && (
          <button
            className="btn btn-ghost btn-sm text-[var(--danger)]"
            onClick={() => {
              onSave(null);
              setDraft({ provider: "anthropic", baseUrl: PRESETS[0].baseUrl, apiKey: "", model: PRESETS[0].model });
              setPreset("anthropic");
            }}
          >
            Remove key
          </button>
        )}
        <span className="flex-1" />
        {saved && <span className="label">saved ✓</span>}
        <button
          className="btn btn-primary"
          disabled={!isConfigured(draft)}
          onClick={() => {
            onSave({ ...draft, baseUrl: draft.baseUrl.trim() });
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function DataTab({ data, onImport }: { data: WorkspaceData; onImport: (d: WorkspaceData) => Promise<number> }) {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `char-notes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importFile = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.folders) || !Array.isArray(parsed.notes)) throw new Error("That file isn't a char or jknotes export.");
      const count = await onImport(parsed);
      setMsg(`Imported ${count} ${count === 1 ? "note" : "notes"}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="card !shadow-none p-4">
        <div className="flex items-center gap-2 font-medium">
          <IconDownload size={15} /> Export everything
        </div>
        <p className="mt-1 text-[13.5px] text-[var(--ink-soft)]">
          {data.notes.length} notes and {data.folders.length} folders as one JSON file. Re-import it anytime.
        </p>
        <button className="btn btn-sm mt-3" onClick={exportAll}>
          Download .json
        </button>
      </div>
      <div className="card !shadow-none p-4">
        <div className="flex items-center gap-2 font-medium">
          <IconUpload size={15} /> Import
        </div>
        <p className="mt-1 text-[13.5px] text-[var(--ink-soft)]">A char export, or the notes.json from jknotes. Notes with the same ID are updated, nothing is deleted.</p>
        <button className="btn btn-sm mt-3" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Importing…" : "Choose file"}
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = "";
          }}
        />
        {msg && <p className="mt-2 text-[13px]">{msg}</p>}
      </div>
    </div>
  );
}

/* ---------- @charlie ---------- */

const AGENT_ORDER: BuiltInAgent[] = ["claude", "codex", "opencode", "hermes"];

const LEVEL_TEXT: Record<AgentLevel, [string, string]> = {
  read: ["Read only", "Reads files and the web, and answers. Can't change anything."],
  edit: ["Can edit files", "Also creates and edits files in the working folder. Commands that need approval are skipped."],
  full: ["Full access", "Edits files and runs any command in the working folder without asking. Only for a folder you trust it with."],
};

const MODEL_HINT: Record<BuiltInAgent, string> = {
  claude: "an alias (opus, sonnet, haiku, fable) or a full model id",
  codex: "the model name Codex accepts with --model",
  opencode: "provider/model, as in `opencode models`",
  hermes: "provider:model from your Hermes providers, or a model name",
};

/** A run started from Settings (the test, a connector setup), watched until it ends. */
type Watched = { id: string; status: "running" | "done" | "error" | "stopped"; steps: AgentStep[]; line: string; output: string; startedAt: number; ms?: number };

function useWatchedRun(onDone?: () => void) {
  const [run, setRun] = useState<Watched | null>(null);
  const current = useRef<string | null>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(
    () =>
      agentBridge().onEvent((e) => {
        if (e.runId !== current.current) return;
        if (e.type === "done") done.current?.();
        setRun((r) => {
          if (!r || r.id !== e.runId) return r;
          const ms = Date.now() - r.startedAt;
          if (e.type === "step") return { ...r, steps: [...r.steps, e.step].slice(-200), line: "" };
          if (e.type === "progress") return { ...r, line: e.line };
          if (e.type === "start") return { ...r, startedAt: Date.now() };
          if (e.type === "done") return { ...r, status: "done", output: e.output + (e.notice ? `\n\n*${e.notice}*` : ""), ms };
          if (e.type === "error") return { ...r, status: "error", output: e.message, ms };
          if (e.type === "stopped") return { ...r, status: "stopped", ms };
          return r;
        });
      }),
    [],
  );
  // A run still going when Settings closes is stopped.
  useEffect(() => () => void (current.current && agentBridge().stop(current.current)), []);
  const begin = (id: string) => {
    current.current = id;
    setRun({ id, status: "running", steps: [], line: "", output: "", startedAt: Date.now() });
  };
  const stop = () => current.current && agentBridge().stop(current.current);
  return { run, begin, stop, clear: () => setRun(null) };
}

function RunView({ run, onStop }: { run: Watched; onStop: () => void }) {
  return (
    <div className="card !shadow-none mt-2 p-3" role="status">
      <ol className="charlie-steps" data-all>
        {run.steps.map((s, i) => (
          <li key={i}>
            <span className="charlie-step-tool">{s.tool}</span>
            {s.detail && <span className="charlie-step-detail">{s.detail}</span>}
          </li>
        ))}
      </ol>
      {run.status === "running" ? (
        <div className="flex items-center gap-2">
          <p className="charlie-line flex-1">
            <span className="charlie-dots" aria-hidden />
            {run.line || "working… (agents can take a few seconds to start)"}
          </p>
          <button className="btn btn-ghost btn-sm" onClick={onStop}>
            Stop
          </button>
        </div>
      ) : run.status === "error" ? (
        <p className="charlie-error !line-clamp-none">{run.output}</p>
      ) : run.status === "stopped" ? (
        <p className="charlie-line">Stopped.</p>
      ) : (
        <div className="prose-sm mt-1 text-[13px]">
          <Markdown text={run.output} />
        </div>
      )}
      {run.ms !== undefined && <p className="label mt-1.5">{elapsed(run.ms)}</p>}
    </div>
  );
}

function AgentsTab() {
  const [found, setFound] = useState<DetectedAgents | null>(null);
  const [statuses, setStatuses] = useState<Partial<Record<BuiltInAgent, AgentStatus | null>>>({});
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  const [saved, setSaved] = useState<AgentConfig | null>(null);
  const [modelList, setModelList] = useState<{ agent: AgentId; ids: string[] } | null>(null);
  const [modelsAsked, setModelsAsked] = useState(0);
  const test = useWatchedRun();
  const agentId = draft?.agent;

  const look = () => {
    const bridge = agentBridge();
    bridge.detect().then(setFound);
    for (const id of AGENT_ORDER) bridge.status(id).then((s) => setStatuses((m) => ({ ...m, [id]: s })));
  };

  useEffect(() => {
    agentBridge()
      .getConfig()
      .then((c) => {
        setDraft(c);
        setSaved(c);
      });
    look();
  }, []);

  // What the chosen agent can run, for the model picker (OpenCode asks its providers, which takes a moment).
  useEffect(() => {
    if (!agentId || agentId === "custom") return;
    let live = true;
    agentBridge()
      .models(agentId)
      .then((ids) => live && setModelList({ agent: agentId, ids }));
    return () => {
      live = false;
    };
  }, [agentId, modelsAsked]);

  if (!draft) return <p className="label">loading…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const builtIn = draft.agent === "custom" ? null : draft.agent;
  const installed = builtIn ? !!found?.[builtIn]?.path : !!draft.custom.trim();
  const status = builtIn ? statuses[builtIn] : null;
  const offered: AgentLevel[] = builtIn ? (found?.[builtIn]?.levels ?? ["read", "edit", "full"]) : ["full"];
  const level: AgentLevel = offered.includes(draft.level) ? draft.level : offered[offered.length - 1];

  const save = async () => {
    const next = await agentBridge().setConfig(draft);
    setDraft(next);
    setSaved(next);
    await refreshAgentLabel(next);
    return next;
  };

  const runTest = async () => {
    const next = await save();
    // A cancelled confirm keeps the old settings: test what's actually saved, but say so.
    if (JSON.stringify(next) !== JSON.stringify(draft)) return;
    const id = newId("test");
    test.begin(id);
    agentBridge().run(id, "This is a connection test from the char notepad. Reply with exactly the word: ready");
  };

  return (
    <div className="space-y-5">
      <p className="text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
        <span className="text-[var(--sun)]">
          <IconTerminal size={13} className="inline -mt-0.5" />
        </span>{" "}
        Type <span className="kbd">@charlie</span> in any note, then a task, and press Enter. charlie hands the note (and notes it links to) to the
        agent below, shows its steps as it works, and writes the answer into the note. Under each answer, <b>Follow up</b> continues the same
        conversation.
      </p>

      <div>
        <div className="mb-2 flex items-center">
          <span className="label flex-1">agent</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setFound(null);
              setStatuses({});
              look();
            }}
            title="Look for installed agents again"
          >
            <IconRetry size={12} /> Check again
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {AGENT_ORDER.map((id) => {
            const a = found?.[id];
            const st = statuses[id];
            const on = draft.agent === id;
            const sub = !found ? "looking…" : !a?.path ? "not installed" : st?.signedIn === false ? "not signed in" : (a.version ?? "installed");
            return (
              <button
                key={id}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                  on ? "border-transparent bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--hairline)] bg-[var(--card)] hover:bg-[var(--hover)]"
                }`}
                onClick={() => setDraft({ ...draft, agent: id })}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{a?.label ?? id}</span>
                  <span className={`block truncate font-mono text-[10.5px] ${on ? "text-[var(--on-accent)]/70" : st?.signedIn === false ? "text-[var(--danger)]" : "text-[var(--ink-faint)]"}`}>
                    {sub}
                  </span>
                </span>
                {a?.path && st?.signedIn !== false && <IconCheck size={13} />}
              </button>
            );
          })}
          <button
            className={`col-span-2 rounded-xl border px-3 py-2 text-left text-[13px] font-medium transition-colors ${
              draft.agent === "custom" ? "border-transparent bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--hairline)] bg-[var(--card)] hover:bg-[var(--hover)]"
            }`}
            onClick={() => setDraft({ ...draft, agent: "custom" })}
          >
            Custom command
          </button>
        </div>

        {builtIn && found && (
          <div className="mt-2 text-[12.5px] text-[var(--ink-soft)]">
            {!installed ? (
              <p>
                {found[builtIn].label} isn&apos;t installed (charlie looked on your login shell&apos;s PATH). Install it, then press Check again.
              </p>
            ) : status?.signedIn === false ? (
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-[var(--danger)]">{found[builtIn].label} isn&apos;t signed in{status.detail && status.detail !== "not signed in" ? ` (${status.detail})` : ""}.</span>
                <button className="btn btn-sm" onClick={() => agentBridge().signIn(builtIn)}>
                  <IconTerminal size={12} /> Sign in, in Terminal
                </button>
                <span className="font-mono text-[11.5px]">{status.signIn}</span>
              </p>
            ) : status ? (
              <p>
                {status.signedIn ? "Ready" : "Installed"}
                {status.detail ? ` · ${status.detail}` : ""}
              </p>
            ) : (
              <p>Checking sign-in…</p>
            )}
          </div>
        )}

        {builtIn && (
          <ModelPicker
            key={builtIn}
            value={draft.models[builtIn] ?? ""}
            fallback={status?.defaultModel ?? null}
            options={modelList?.agent === builtIn ? modelList.ids : null}
            hint={MODEL_HINT[builtIn]}
            onRefresh={() => {
              setModelList(null);
              setModelsAsked((n) => n + 1);
            }}
            onChange={(model) => setDraft({ ...draft, models: { ...draft.models, [builtIn]: model } })}
          />
        )}
        {draft.agent === "custom" && (
          <label className="mt-3 block">
            <span className="label mb-1.5 block">command</span>
            <input
              className="input font-mono !text-[13px]"
              value={draft.custom}
              placeholder="my-agent --print {prompt}"
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, custom: e.target.value })}
            />
            <span className="mt-1.5 block text-[12px] text-[var(--ink-soft)]">
              Runs without a shell. The task goes where <span className="font-mono">{"{prompt}"}</span> is, or last if it isn&apos;t there. Whatever it prints
              becomes the answer.
            </span>
          </label>
        )}
      </div>

      <div>
        <span className="label mb-1.5 block">working folder</span>
        <div className="flex items-center gap-2">
          <div className="card min-w-0 flex-1 truncate px-3 py-2 font-mono text-[12px] text-[var(--ink-soft)]" title={draft.cwd}>
            {draft.cwd}
          </div>
          <button
            className="btn btn-sm"
            onClick={async () => {
              const dir = await agentBridge().pickFolder();
              if (dir) setDraft({ ...draft, cwd: dir });
            }}
          >
            <IconFolder size={14} /> Choose…
          </button>
        </div>
        <span className="mt-1.5 block text-[12px] text-[var(--ink-soft)]">Where charlie runs: point it at a project to let it work on that code.</span>
      </div>

      <div>
        <span className="label mb-2 block">access</span>
        <div className="space-y-1.5">
          {(["read", "edit", "full"] as const).map((l) => {
            const allowed = offered.includes(l);
            const [title, body] = LEVEL_TEXT[l];
            return (
              <label
                key={l}
                className={`flex gap-2.5 rounded-xl border px-3 py-2.5 ${allowed ? "cursor-pointer" : "cursor-not-allowed opacity-50"} ${
                  level === l ? "border-[var(--ink-soft)] bg-[var(--card)]" : "border-[var(--hairline)]"
                }`}
              >
                <input type="radio" className="mt-1" disabled={!allowed} checked={level === l} onChange={() => setDraft({ ...draft, level: l })} />
                <span>
                  <span className="block text-[13px] font-medium">{title}</span>
                  <span className="block text-[12px] leading-relaxed text-[var(--ink-soft)]">{body}</span>
                </span>
              </label>
            );
          })}
        </div>
        {offered.length === 1 && (
          <span className="mt-1.5 block text-[12px] text-[var(--ink-soft)]">
            {draft.agent === "hermes"
              ? "Hermes approves its own actions when charlie runs it, so it can only run with full access."
              : "Your command decides what it may do, so charlie treats it as full access."}
          </span>
        )}
      </div>

      {test.run && <RunView run={test.run} onStop={test.stop} />}

      <div className="hairline-t flex items-center gap-2 pt-4">
        <button className="btn btn-sm" disabled={!installed || test.run?.status === "running"} onClick={runTest}>
          {test.run?.status === "running" ? "Testing…" : "Test"}
        </button>
        <span className="flex-1" />
        {!dirty && saved && <span className="label">saved ✓</span>}
        <button className="btn btn-primary" disabled={!dirty || (draft.agent === "custom" && !draft.custom.trim())} onClick={save}>
          Save
        </button>
      </div>

      {installed && <Connectors agent={draft.agent} label={builtIn ? (found?.[builtIn]?.label ?? builtIn) : "your command"} canSetUp={!dirty} />}

      <CommandLine />
    </div>
  );
}

const AGENT_HINT = "You can read and edit my notes with the `char` command. Run `char help` to see how.";

/** The `char` command: any agent (or you) can read and change notes from a terminal. */
function CommandLine() {
  const [status, setStatus] = useState<{ installedAt: string | null; onPath?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    cliBridge()
      ?.status()
      .then(setStatus)
      .catch(() => setStatus({ installedAt: null }));
  }, []);
  const install = async () => {
    setError(null);
    try {
      setStatus(await cliBridge()!.install());
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
    }
  };
  return (
    <section className="hairline-t space-y-3 pt-5">
      <h3 className="text-[14px] font-semibold">Command line</h3>
      <p className="text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
        The <span className="kbd">char</span> command lets any agent (Claude Code, Codex, scripts) or you read, search and edit notes from a terminal:
        list, show, search, tasks, new, append, move, check off to-dos and more. Changes go through char, so this window updates as they happen.
      </p>
      <div className="card space-y-1 px-3 py-2 font-mono text-[12px] text-[var(--ink-soft)]">
        <div>char search roadmap</div>
        <div>char new &quot;Standup&quot; --folder Work &quot;- [ ] ship the fix&quot;</div>
        <div>char append &quot;Weekly sync&quot; --stdin &lt; notes.md</div>
        <div>char tasks --json</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" onClick={install}>
          {status?.installedAt ? "Reinstall" : "Install the char command"}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            await navigator.clipboard.writeText(AGENT_HINT);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title={AGENT_HINT}
        >
          {copied ? "Copied ✓" : "Copy a note for your agent"}
        </button>
      </div>
      {status?.installedAt && (
        <p className="text-[12.5px] text-[var(--ink-soft)]">
          Installed at <span className="font-mono">{status.installedAt}</span>
          {status.onPath === false && (
            <>
              . Add <span className="font-mono">{status.installedAt.replace(/\/char$/, "")}</span> to your PATH to use it from any terminal.
            </>
          )}
        </p>
      )}
      {error && (
        <p className="text-[12.5px] text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** What the agent can reach beyond its folder, and prompts that ask it to set more up. */
function Connectors({ agent, label, canSetUp }: { agent: AgentId; label: string; canSetUp: boolean }) {
  const [list, setList] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [custom, setCustom] = useState("");
  const builtIn = agent === "custom" ? null : agent;
  const listed = useRef(false);

  const check = async () => {
    if (!builtIn) return;
    listed.current = true;
    setChecking(true);
    setList(await agentBridge().mcpList(builtIn).catch((e: Error) => e.message));
    setChecking(false);
  };

  // A setup that finished changes what's connected.
  const setup = useWatchedRun(() => listed.current && void check());

  const start = async (name: string, goal: string) => {
    const id = newId("setup");
    setup.begin(id);
    const ok = await agentBridge().setup(id, name, setupPrompt(agent, { name, goal }));
    if (!ok) setup.clear();
  };

  const busy = setup.run?.status === "running";
  return (
    <div className="hairline-t space-y-3 pt-4">
      <div className="flex items-center gap-2">
        <span className="label flex-1">connectors</span>
        {builtIn && (
          <button className="btn btn-ghost btn-sm" disabled={checking} onClick={check}>
            {checking ? "Checking…" : list === null ? "What's connected?" : "Check again"}
          </button>
        )}
      </div>
      <p className="text-[12.5px] leading-relaxed text-[var(--ink-soft)]">
        Connectors let {label} reach your other tools (GitHub, your calendar, the web) when charlie runs it. Pick one and charlie asks {label} to set
        it up for itself, with full access and after you confirm. If it needs you to sign in, it says how.
      </p>
      {list !== null && <pre className="card scroll-soft max-h-48 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11.5px] text-[var(--ink-soft)]">{list || "Nothing connected yet."}</pre>}
      <div className="grid grid-cols-2 gap-1.5">
        {CONNECTORS.map((c) => (
          <button
            key={c.id}
            className="rounded-xl border border-[var(--hairline)] bg-[var(--card)] px-3 py-2 text-left hover:bg-[var(--hover)] disabled:opacity-50"
            disabled={busy || !canSetUp}
            onClick={() => start(c.name, c.goal)}
          >
            <span className="block text-[13px] font-medium">{c.name}</span>
            <span className="block truncate text-[11.5px] text-[var(--ink-faint)]">{c.blurb}</span>
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const what = custom.trim();
          if (what) start(what.length > 40 ? `${what.slice(0, 37)}…` : what, `use ${what}`);
        }}
      >
        <input className="input !text-[13px]" value={custom} placeholder="Something else, e.g. “my Postgres database”" onChange={(e) => setCustom(e.target.value)} />
        <button className="btn btn-sm" disabled={busy || !canSetUp || !custom.trim()} type="submit">
          Set up
        </button>
      </form>
      {!canSetUp && <p className="label">Save your agent settings first.</p>}
      {setup.run && <RunView run={setup.run} onStop={setup.stop} />}
    </div>
  );
}

function ModelPicker(p: {
  value: string;
  fallback: string | null;
  options: string[] | null;
  hint: string;
  onRefresh: () => void;
  onChange: (model: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const shown = (p.options ?? []).filter((m) => m.toLowerCase().includes(filter.toLowerCase())).slice(0, 200);
  const own = `agent's own default${p.fallback ? ` (${p.fallback})` : ""}`;
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center">
        <span className="label flex-1">default model</span>
        <button className="btn btn-ghost btn-sm" onClick={p.onRefresh} title="Ask the agent for its models again">
          <IconRetry size={12} /> Refresh
        </button>
      </div>
      <input
        className="input font-mono !text-[13px]"
        value={p.value}
        placeholder={own}
        spellCheck={false}
        onChange={(e) => {
          p.onChange(e.target.value.trim());
          setFilter(e.target.value.trim());
        }}
      />
      <span className="mt-1.5 block text-[12px] text-[var(--ink-soft)]">Leave empty to use the agent&apos;s own setting. Otherwise {p.hint}.</span>
      <div className="scroll-soft mt-2 max-h-36 overflow-y-auto rounded-xl border border-[var(--hairline)] p-1">
        {p.options === null ? (
          <p className="label px-2.5 py-1.5">loading models…</p>
        ) : (
          [{ id: "", label: own }, ...shown.map((m) => ({ id: m, label: m }))].map((m) => (
            <button
              key={m.id || "default"}
              className="row flex w-full items-center justify-between px-2.5 py-1.5 text-left font-mono text-[12.5px]"
              data-selected={p.value === m.id}
              onClick={() => {
                p.onChange(m.id);
                setFilter("");
              }}
            >
              <span className="truncate">{m.label}</span>
              {p.value === m.id && <IconCheck size={13} />}
            </button>
          ))
        )}
        {p.options !== null && !p.options.length && <p className="label px-2.5 py-1.5">The agent didn&apos;t list any models: type one above.</p>}
      </div>
    </div>
  );
}
