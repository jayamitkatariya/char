"use client";

import { useEffect, useRef, useState } from "react";
import { isConfigured, listModels, PRESETS, type AISettings } from "@/lib/ai";
import { refreshAgentLabel } from "@/lib/charlie";
import { agentBridge, dataPath, revealData, type AgentConfig, type AgentId, type DetectedAgents } from "@/lib/desktop";
import type { WorkspaceData } from "@/lib/useWorkspace";
import { IconCheck, IconDownload, IconFolder, IconSparkle, IconTerminal, IconUpload, IconX } from "../icons";

type Tab = "ai" | "agents" | "data" | "storage";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(43,38,32,0.22)] p-4 backdrop-blur-[2px]" onMouseDown={p.onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="card pop-in flex max-h-[90dvh] w-full max-w-[560px] flex-col overflow-hidden !rounded-3xl !shadow-[var(--shadow-lg)]"
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
                preset === pr.id ? "border-transparent bg-[var(--accent)] text-white" : "border-[var(--hairline)] bg-[var(--card)] hover:bg-[var(--hover)]"
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
          <p className={`mt-2 text-[12.5px] ${status.kind === "error" ? "text-[var(--danger)]" : "text-[#3f7a3a]"}`} role="status">
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

const AGENT_ORDER: Exclude<AgentId, "custom">[] = ["claude", "codex", "opencode", "hermes"];

function AgentsTab() {
  const [found, setFound] = useState<DetectedAgents | null>(null);
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  const [saved, setSaved] = useState<AgentConfig | null>(null);
  const [test, setTest] = useState<{ kind: "idle" | "busy" | "ok" | "error"; msg?: string }>({ kind: "idle" });
  const testRun = useRef<string | null>(null);
  const [modelList, setModelList] = useState<{ agent: AgentId; ids: string[] } | null>(null);
  const agentId = draft?.agent;

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
  }, [agentId]);

  useEffect(() => {
    const bridge = agentBridge();
    bridge.getConfig().then((c) => {
      setDraft(c);
      setSaved(c);
    });
    bridge.detect().then(setFound);
    return bridge.onEvent((e) => {
      if (e.runId !== testRun.current) return;
      if (e.type === "done") setTest({ kind: "ok", msg: `Answered: “${e.output.slice(0, 80)}”` });
      else if (e.type === "error") setTest({ kind: "error", msg: e.message });
      else if (e.type === "stopped") setTest({ kind: "idle" });
      if (e.type === "done" || e.type === "error" || e.type === "stopped") testRun.current = null;
    });
  }, []);

  // A test in flight is stopped if the tab closes.
  useEffect(() => () => void (testRun.current && agentBridge().stop(testRun.current)), []);

  if (!draft) return <p className="label">loading…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const installed = draft.agent === "custom" ? !!draft.custom.trim() : !!found?.[draft.agent]?.path;

  const save = async () => {
    const next = await agentBridge().setConfig(draft);
    setDraft(next);
    setSaved(next);
    await refreshAgentLabel(next);
    return next;
  };

  const runTest = async () => {
    await save();
    const id = `test-${Date.now()}`;
    testRun.current = id;
    setTest({ kind: "busy" });
    agentBridge().run(id, "This is a connection test from the char notepad. Reply with exactly the word: ready");
  };

  return (
    <div className="space-y-5">
      <p className="text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
        <span className="text-[var(--sun)]">
          <IconTerminal size={13} className="inline -mt-0.5" />
        </span>{" "}
        Type <span className="kbd">@charlie</span> in any note, then a task, and press Enter. charlie hands the note (and notes it links to) to the
        agent below, runs it in the working folder, and writes the answer into the note. Long answers get a note of their own.
      </p>

      <div>
        <span className="label mb-2 block">agent</span>
        <div className="grid grid-cols-2 gap-1.5">
          {AGENT_ORDER.map((id) => {
            const a = found?.[id];
            const on = draft.agent === id;
            return (
              <button
                key={id}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                  on ? "border-transparent bg-[var(--accent)] text-white" : "border-[var(--hairline)] bg-[var(--card)] hover:bg-[var(--hover)]"
                }`}
                onClick={() => setDraft({ ...draft, agent: id })}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{a?.label ?? id}</span>
                  <span className={`block truncate font-mono text-[10.5px] ${on ? "text-white/70" : "text-[var(--ink-faint)]"}`}>
                    {!found ? "looking…" : a?.path ? (a.version ?? "installed") : "not installed"}
                  </span>
                </span>
                {a?.path && <IconCheck size={13} />}
              </button>
            );
          })}
          <button
            className={`col-span-2 rounded-xl border px-3 py-2 text-left text-[13px] font-medium transition-colors ${
              draft.agent === "custom" ? "border-transparent bg-[var(--accent)] text-white" : "border-[var(--hairline)] bg-[var(--card)] hover:bg-[var(--hover)]"
            }`}
            onClick={() => setDraft({ ...draft, agent: "custom" })}
          >
            Custom command
          </button>
        </div>
        {draft.agent !== "custom" && (
          <ModelPicker
            key={draft.agent}
            value={draft.models[draft.agent] ?? ""}
            options={modelList?.agent === draft.agent ? modelList.ids : null}
            listable={draft.agent === "claude" || draft.agent === "opencode"}
            hint={
              draft.agent === "opencode"
                ? "provider/model, as in `opencode models`"
                : draft.agent === "claude"
                  ? "an alias (opus, sonnet, haiku, fable) or a full model id"
                  : "the model name the CLI accepts with --model"
            }
            onChange={(model) => setDraft({ ...draft, models: { ...draft.models, [draft.agent]: model } })}
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
        <span className="label mb-2 block">permissions</span>
        <div className="space-y-1.5">
          {(
            [
              [false, "Ask first", "Reads and answers. Edits and commands follow the agent's own approval settings, so most are skipped."],
              [true, "Full access", "Edits files and runs commands in the working folder without asking. Only use this with a folder you trust it with."],
            ] as const
          ).map(([full, title, body]) => (
            <label
              key={title}
              className={`flex cursor-pointer gap-2.5 rounded-xl border px-3 py-2.5 ${draft.full === full ? "border-[var(--ink-soft)] bg-[var(--card)]" : "border-[var(--hairline)]"}`}
            >
              <input type="radio" className="mt-1" checked={draft.full === full} onChange={() => setDraft({ ...draft, full })} />
              <span>
                <span className="block text-[13px] font-medium">{title}</span>
                <span className="block text-[12px] leading-relaxed text-[var(--ink-soft)]">{body}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {test.kind !== "idle" && (
        <p className={`text-[12.5px] ${test.kind === "error" ? "text-[var(--danger)]" : test.kind === "ok" ? "text-[#3f7a3a]" : "text-[var(--ink-soft)]"}`} role="status">
          {test.kind === "busy" ? "Asking the agent to say “ready”… (agents can take a few seconds to start)" : test.msg}
        </p>
      )}

      <div className="hairline-t flex items-center gap-2 pt-4">
        <button className="btn btn-sm" disabled={!installed || test.kind === "busy"} onClick={runTest}>
          {test.kind === "busy" ? "Testing…" : "Test"}
        </button>
        {test.kind === "busy" && (
          <button className="btn btn-ghost btn-sm" onClick={() => testRun.current && agentBridge().stop(testRun.current)}>
            Cancel
          </button>
        )}
        <span className="flex-1" />
        {!dirty && saved && <span className="label">saved ✓</span>}
        <button className="btn btn-primary" disabled={!dirty || (draft.agent === "custom" && !draft.custom.trim())} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

function ModelPicker(p: { value: string; options: string[] | null; listable: boolean; hint: string; onChange: (model: string) => void }) {
  const [filter, setFilter] = useState("");
  const shown = (p.options ?? []).filter((m) => m.toLowerCase().includes(filter.toLowerCase())).slice(0, 200);
  return (
    <div className="mt-3">
      <span className="label mb-1.5 block">default model</span>
      <input
        className="input font-mono !text-[13px]"
        value={p.value}
        placeholder="agent's own default"
        spellCheck={false}
        onChange={(e) => {
          p.onChange(e.target.value.trim());
          setFilter(e.target.value.trim());
        }}
      />
      <span className="mt-1.5 block text-[12px] text-[var(--ink-soft)]">Leave empty to use the agent&apos;s own setting. Otherwise {p.hint}.</span>
      {p.listable && (
        <div className="scroll-soft mt-2 max-h-36 overflow-y-auto rounded-xl border border-[var(--hairline)] p-1">
          {p.options === null ? (
            <p className="label px-2.5 py-1.5">loading models…</p>
          ) : shown.length === 0 ? (
            <p className="label px-2.5 py-1.5">no matching models</p>
          ) : (
            [{ id: "", label: "agent's own default" }, ...shown.map((m) => ({ id: m, label: m }))].map((m) => (
              <button
                key={m.id || "default"}
                className="row flex w-full items-center justify-between px-2.5 py-1.5 text-left font-mono text-[12.5px]"
                data-selected={p.value === m.id}
                onClick={() => {
                  p.onChange(m.id);
                  setFilter("");
                }}
              >
                {m.label}
                {p.value === m.id && <IconCheck size={13} />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
