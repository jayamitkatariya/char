// @charlie: runs one task through a terminal coding agent installed on this Mac, in the folder
// the user picked, and reports back. Each agent runs in its one-shot (non-interactive) mode, and
// where the agent can stream events (Claude Code, Codex, OpenCode) we read them, so the card
// shows real steps and a follow-up can resume the same session.

const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/* ---------- access levels ---------- */

// What charlie may do in the working folder. Each agent maps these onto its own flags; an agent
// that can't enforce a level doesn't offer it (see `levels`).
const LEVELS = ["read", "edit", "full"];

// Tools Claude Code may use at "read": looking, never touching.
const CLAUDE_READ_TOOLS = "Read,Grep,Glob,LS,WebFetch,WebSearch,TodoWrite";

/* ---------- the agents ---------- */

// Each adapter says how to call the agent (`args`), whether the prompt goes on stdin (keeps note
// text out of `ps` and off the argument-size limit), how to read what it prints (`parse`), and how
// to ask it about models, sign-in and connected tools.
const AGENTS = {
  claude: {
    label: "Claude Code",
    bin: "claude",
    stdin: true,
    levels: LEVELS,
    signIn: ["claude", "auth", "login"],
    args: ({ level, model, resume }) => [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      ...(resume ? ["--resume", resume] : []),
      ...(model ? ["--model", model] : []),
      ...(level === "full"
        ? ["--permission-mode", "bypassPermissions"]
        : level === "edit"
          ? ["--permission-mode", "acceptEdits"]
          : ["--permission-mode", "default", "--allowedTools", CLAUDE_READ_TOOLS]),
    ],
    parse: parseClaude,
    // Aliases always point at the newest model of that tier.
    models: async () => ["fable", "opus", "sonnet", "haiku", "claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    status: async (file, env) => {
      const out = await capture(file, ["auth", "status"], env, 15000);
      try {
        const s = JSON.parse(out);
        return { signedIn: !!s.loggedIn, detail: s.loggedIn ? s.authMethod || "signed in" : "not signed in" };
      } catch {
        return { signedIn: null, detail: "" };
      }
    },
    mcp: [["mcp", "list"]],
  },
  codex: {
    label: "Codex",
    bin: "codex",
    stdin: true,
    levels: LEVELS,
    signIn: ["codex", "login"],
    args: ({ level, model, resume }) => {
      const sandbox = level === "full" ? [] : ["-c", `sandbox_mode="${level === "edit" ? "workspace-write" : "read-only"}"`];
      const common = ["--json", "--skip-git-repo-check", ...(model ? ["--model", model] : []), ...(level === "full" ? ["--dangerously-bypass-approvals-and-sandbox"] : sandbox)];
      return resume ? ["exec", "resume", ...common, resume, "-"] : ["exec", ...common, "--color", "never", "-"];
    },
    parse: parseCodex,
    models: async () => {
      const cache = readJson(path.join(os.homedir(), ".codex", "models_cache.json"));
      const list = Array.isArray(cache?.models) ? cache.models : Array.isArray(cache) ? cache : [];
      return list.map((m) => (typeof m === "string" ? m : m?.slug || m?.id)).filter((m) => typeof m === "string");
    },
    defaultModel: () => /^\s*model\s*=\s*"([^"]+)"/m.exec(readText(path.join(os.homedir(), ".codex", "config.toml")))?.[1] ?? null,
    status: async (file, env) => {
      const out = await capture(file, ["login", "status"], env, 15000);
      const yes = /logged in/i.test(out) && !/not logged in/i.test(out);
      return { signedIn: yes, detail: out.split("\n")[0] || "" };
    },
    mcp: [["mcp", "list"]],
  },
  opencode: {
    label: "OpenCode",
    bin: "opencode",
    stdin: true,
    levels: LEVELS,
    signIn: ["opencode", "auth", "login"],
    // "read" uses OpenCode's built-in plan agent, which can't change files outside its own folder.
    args: ({ level, model, resume }) => [
      "run",
      "--format",
      "json",
      ...(resume ? ["--session", resume] : []),
      ...(model ? ["--model", model] : []),
      ...(level === "read" ? ["--agent", "plan"] : []),
      ...(level === "full" ? ["--auto"] : []),
    ],
    parse: parseOpenCode,
    models: (file, env) => capture(file, ["models"], env, 30000).then(lines),
    // OpenCode has free built-in models, so there's nothing to sign in to before it works.
    status: async () => ({ signedIn: null, detail: "" }),
    mcp: [["mcp", "list"]],
  },
  hermes: {
    label: "Hermes",
    bin: "hermes",
    stdin: false,
    // `hermes -z` auto-approves everything it does, so it only runs at full access.
    levels: ["full"],
    signIn: ["hermes", "setup"],
    // Models are stored as "provider:model" (see `models`), so the right provider is used too.
    args: ({ prompt, model, resume, usageFile }) => {
      const [provider, id] = model && model.includes(":") ? [model.slice(0, model.indexOf(":")), model.slice(model.indexOf(":") + 1)] : [null, model];
      return [
        "-z",
        prompt,
        "--usage-file",
        usageFile,
        ...(resume ? ["--resume", resume] : []),
        ...(id ? ["-m", id] : []),
        ...(provider ? ["--provider", provider] : []),
      ];
    },
    parse: parseText,
    models: async () => {
      const cache = readJson(path.join(os.homedir(), ".hermes", "provider_models_cache.json")) ?? {};
      const def = hermesDefault();
      const out = [];
      const providers = Object.keys(cache).filter((p) => !p.includes(":"));
      providers.sort((a, b) => (a === def?.provider ? -1 : b === def?.provider ? 1 : 0));
      for (const p of providers) for (const m of cache[p]?.models ?? []) if (typeof m === "string") out.push(`${p}:${m}`);
      return out;
    },
    defaultModel: () => {
      const d = hermesDefault();
      return d?.model ? (d.provider ? `${d.provider}:${d.model}` : d.model) : null;
    },
    status: async () => {
      const d = hermesDefault();
      return d?.model ? { signedIn: true, detail: `${d.model}${d.provider ? ` via ${d.provider}` : ""}` } : { signedIn: false, detail: "no model set up" };
    },
    mcp: [
      ["mcp", "list"],
      ["connectors", "list"],
    ],
  },
};

const AGENT_IDS = Object.keys(AGENTS);

// Hermes keeps its default model in ~/.hermes/config.yaml as `model: { default, provider }`.
function hermesDefault() {
  const yaml = readText(path.join(os.homedir(), ".hermes", "config.yaml"));
  const block = /^model:\s*\n((?:[ \t]+.*\n?)*)/m.exec(yaml)?.[1] ?? "";
  const field = (k) => new RegExp(`^\\s+${k}:\\s*['"]?([^'"\\n]+?)['"]?\\s*$`, "m").exec(block)?.[1] ?? null;
  return block ? { model: field("default"), provider: field("provider") } : null;
}

/** The levels an agent can honestly enforce; custom commands decide for themselves. */
const levelsFor = (agent) => (agent === "custom" ? ["full"] : (AGENTS[agent]?.levels ?? LEVELS));

/** The level a run actually gets: the chosen one if the agent offers it, else the nearest it has. */
function effectiveLevel(config) {
  const offered = levelsFor(config.agent);
  return offered.includes(config.level) ? config.level : offered[offered.length - 1];
}

function normalizeConfig(c = {}) {
  const models = {};
  for (const id of AGENT_IDS) {
    const m = c.models?.[id];
    if (typeof m === "string" && m.trim()) models[id] = m.trim();
  }
  // Before 1.1 there was only "Ask first" (full: false) or "Full access" (full: true).
  const level = LEVELS.includes(c.level) ? c.level : c.full === true ? "full" : "read";
  return {
    agent: c.agent === "custom" || Object.hasOwn(AGENTS, c.agent) ? c.agent : "claude",
    custom: typeof c.custom === "string" ? c.custom.trim() : "",
    cwd: typeof c.cwd === "string" && c.cwd ? c.cwd : os.homedir(),
    level,
    models,
  };
}

/* ---------- reading what agents print ---------- */

// Every parser gets one line at a time and a per-run context, and reports through `ctx.emit`:
//   session(id), step(tool, detail), say(text), final(output), fail(message), note(text)

// "Read src/app.ts", "Run npm test": what a tool call was about, in a few words.
function describe(input) {
  if (!input || typeof input !== "object") return "";
  const v =
    input.command ?? input.cmd ?? input.file_path ?? input.filePath ?? input.path ?? input.pattern ?? input.query ?? input.url ?? input.description ?? input.prompt ?? "";
  const s = Array.isArray(v) ? v.join(" ") : String(v);
  return s.replace(/\s+/g, " ").trim().slice(0, 160);
}

function parseClaude(obj, ctx) {
  if (obj.session_id && !ctx.sessionId) ctx.session(obj.session_id);
  if (obj.type === "assistant") {
    for (const c of obj.message?.content ?? []) {
      if (c.type === "tool_use") ctx.step(c.name, describe(c.input));
      else if (c.type === "text" && c.text?.trim()) ctx.say(c.text);
    }
  } else if (obj.type === "system" && obj.subtype === "task_summary" && obj.detail) {
    ctx.say(obj.detail);
  } else if (obj.type === "result") {
    const denied = [...new Set((obj.permission_denials ?? []).map((d) => d.tool_name).filter(Boolean))];
    if (denied.length) ctx.note(`Claude Code wasn't allowed to use ${denied.join(", ")}. Raise charlie's access in Settings → Agents if it needs to.`);
    if (obj.is_error) ctx.fail(String(obj.result || obj.subtype || "Claude Code reported an error."));
    else ctx.final(String(obj.result ?? ""));
  }
}

function parseCodex(obj, ctx) {
  if (obj.type === "thread.started" && obj.thread_id) ctx.session(obj.thread_id);
  else if (obj.type === "item.started" || obj.type === "item.completed") {
    const it = obj.item ?? {};
    const done = obj.type === "item.completed";
    if (it.type === "agent_message" && done) {
      ctx.lastMessage = it.text ?? "";
      ctx.say(it.text ?? "");
    } else if (it.type === "command_execution" && !done) ctx.step("Run", describe(it));
    else if (it.type === "file_change" && done) ctx.step("Edit", (it.changes ?? []).map((c) => c.path).join(", "));
    else if (it.type === "mcp_tool_call" && !done) ctx.step(`${it.server ?? "tool"}.${it.tool ?? ""}`, describe(it.arguments));
    else if (it.type === "web_search" && !done) ctx.step("Search", it.query ?? "");
    else if (it.type === "reasoning" && done && it.text) ctx.say(it.text);
    else if (it.type === "error" && done && it.message) ctx.say(it.message);
  } else if (obj.type === "error") {
    const msg = String(obj.message ?? "");
    // Without a login Codex retries ten times before giving up; there's no point waiting.
    if (/401|unauthori[sz]ed|not logged in|missing bearer/i.test(msg)) ctx.fail("Codex isn't signed in. Run “codex login” in Terminal (Settings → Agents can open it for you).", true);
    else ctx.say(msg);
  } else if (obj.type === "turn.failed") ctx.fail(obj.error?.message || "Codex couldn't finish.");
  else if (obj.type === "turn.completed") ctx.final(ctx.lastMessage ?? "");
}

function parseOpenCode(obj, ctx) {
  if (obj.sessionID && !ctx.sessionId) ctx.session(obj.sessionID);
  const p = obj.part ?? {};
  if (obj.type === "tool_use") {
    const st = p.state ?? {};
    ctx.step(p.tool ?? "tool", describe(st.input));
    if (st.status === "error" && st.error) ctx.say(String(st.error));
  } else if (obj.type === "text" && typeof p.text === "string") {
    // The answer is the text of the last message; earlier messages are thinking out loud.
    ctx.texts ??= new Map();
    if (p.messageID !== ctx.textMessage) {
      ctx.textMessage = p.messageID;
      ctx.texts.clear();
    }
    ctx.texts.set(p.id ?? ctx.texts.size, p.text);
    ctx.answer = [...ctx.texts.values()].join("");
    ctx.say(p.text);
  } else if (obj.type === "error") {
    const e = obj.error ?? {};
    ctx.fail(e.data?.message || e.message || (typeof e === "string" ? e : "OpenCode reported an error."));
  }
}

// Agents without an event stream: stdout is the answer, and its last line is the progress.
function parseText(line, ctx) {
  ctx.say(line);
}

/* ---------- finding the agents ---------- */

// Apps opened from the Dock don't inherit the terminal's PATH, so ask the login shell for it once.
let pathPromise = null;
function shellPath() {
  pathPromise ??= new Promise((resolve) => {
    const home = os.homedir();
    const common = [
      `${home}/.local/bin`,
      `${home}/.opencode/bin`,
      `${home}/.bun/bin`,
      `${home}/.cargo/bin`,
      `${home}/.npm-global/bin`,
      `${home}/.volta/bin`,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ];
    const finish = (fromShell) =>
      resolve([...new Set([...fromShell.split(":"), ...(process.env.PATH || "").split(":"), ...common].filter(Boolean))].join(":"));
    execFile(
      process.env.SHELL || "/bin/zsh",
      ["-ilc", 'printf "\\n__CHAR_PATH__%s__CHAR_PATH__\\n" "$PATH"'],
      { encoding: "utf8", timeout: 8000 },
      (_err, stdout) => finish(/__CHAR_PATH__(.*)__CHAR_PATH__/.exec(stdout || "")?.[1] ?? ""),
    );
  });
  return pathPromise;
}

async function which(bin) {
  if (bin.includes("/")) return fs.existsSync(bin) ? bin : null;
  for (const dir of (await shellPath()).split(":")) {
    const file = path.join(dir, bin);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      if (fs.statSync(file).isFile()) return file;
    } catch {}
  }
  return null;
}

async function childEnv() {
  const env = { ...process.env, PATH: await shellPath(), NO_COLOR: "1", FORCE_COLOR: "0", TERM: "dumb", CHAR_AGENT: "charlie" };
  for (const k of Object.keys(env)) if (k.startsWith("ELECTRON_")) delete env[k];
  return env;
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

// stdout (and stderr if stdout is empty) of a quick command, without colours.
function capture(file, args, env, timeout = 10000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, env, maxBuffer: 4_000_000 }, (_err, stdout, stderr) =>
      resolve(String(stdout || stderr || "").replace(ANSI, "").trim()),
    );
  });
}

const lines = (text) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[\w.@:/-]+$/.test(l));

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function detect() {
  const env = await childEnv();
  const entries = await Promise.all(
    Object.entries(AGENTS).map(async ([id, a]) => {
      const file = await which(a.bin);
      const version = file ? (await capture(file, ["--version"], env, 6000)).split("\n")[0] || null : null;
      return [id, { label: a.label, path: file, version, levels: a.levels }];
    }),
  );
  return Object.fromEntries(entries);
}

/** Installed, signed in, and which model it uses by default. Slower than detect(), so it's separate. */
async function status(agentId) {
  const a = Object.hasOwn(AGENTS, agentId) ? AGENTS[agentId] : null;
  if (!a) return null;
  const file = await which(a.bin);
  if (!file) return { installed: false, signedIn: null, detail: "", defaultModel: null, signIn: a.signIn.join(" ") };
  const s = await a.status(file, await childEnv()).catch(() => ({ signedIn: null, detail: "" }));
  return { installed: true, ...s, defaultModel: a.defaultModel?.() ?? null, signIn: a.signIn.join(" ") };
}

async function models(agentId) {
  const a = Object.hasOwn(AGENTS, agentId) ? AGENTS[agentId] : null;
  if (!a?.models) return [];
  const file = await which(a.bin);
  return file ? [...new Set(await a.models(file, await childEnv()).catch(() => []))] : [];
}

/** What the agent can reach beyond the folder: its MCP servers (and Hermes' connectors), as it prints them. */
async function mcpList(agentId) {
  const a = Object.hasOwn(AGENTS, agentId) ? AGENTS[agentId] : null;
  if (!a) return "";
  const file = await which(a.bin);
  if (!file) return `${a.label} isn't installed.`;
  const env = await childEnv();
  const parts = await Promise.all(a.mcp.map((args) => capture(file, args, env, 60000)));
  return parts.filter(Boolean).join("\n\n");
}

/** The command that signs an agent in, for Settings to open in Terminal. */
const signInCommand = (agentId) => (Object.hasOwn(AGENTS, agentId) ? AGENTS[agentId].signIn : null);

/* ---------- running a task ---------- */

// Splits a custom command like `my-agent --flag "two words"` into arguments (no shell involved).
function splitCommand(cmd) {
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(cmd))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? m[3]));
  return out;
}

// "~/bin/agent" and "./agent" mean what they would in a terminal opened in the working folder.
function resolveCommand(bin, cwd) {
  if (bin === "~" || bin.startsWith("~/")) return path.join(os.homedir(), bin.slice(1));
  if (bin.startsWith("./") || bin.startsWith("../")) return path.resolve(cwd, bin);
  return bin;
}

async function command(config, prompt, extra) {
  if (config.agent === "custom") {
    const parts = splitCommand(config.custom);
    if (!parts.length) throw new Error("Add a command for your custom agent in Settings → Agents.");
    const file = await which(resolveCommand(parts[0], config.cwd));
    if (!file) throw new Error(`Couldn't find “${parts[0]}”. Check the command in Settings → Agents.`);
    const rest = parts.slice(1);
    const hasSlot = rest.some((a) => a.includes("{prompt}"));
    return {
      file,
      args: hasSlot ? rest.map((a) => a.replaceAll("{prompt}", prompt)) : [...rest, prompt],
      label: path.basename(parts[0]),
      adapter: { parse: parseText, stdin: false, json: false },
    };
  }
  const a = AGENTS[config.agent];
  const file = await which(a.bin);
  if (!file) throw new Error(`${a.label} isn't installed (no “${a.bin}” on your PATH). Pick another agent in Settings → Agents.`);
  const args = a.args({ prompt, level: effectiveLevel(config), model: config.models[config.agent], ...extra });
  return { file, args, label: a.label, adapter: { parse: a.parse, stdin: a.stdin, json: a.parse !== parseText } };
}

const MAX_OUTPUT = 2_000_000;
// Agents can work for a long time, but not forever.
const TIME_LIMIT_MS = 60 * 60 * 1000;
// No output at all for this long is worth telling the user about (it may be waiting on something).
const QUIET_MS = 3 * 60 * 1000;
// After the agent exits, how long to wait for output still in flight. A child process it left
// behind can hold the pipes open, so exiting is what counts, not the pipes closing.
const DRAIN_MS = 1500;
// More runs than this wait their turn; each one is a whole agent with its own model calls.
const MAX_PARALLEL = 3;
// Session ids go on the command line, so only plain ones are accepted.
const SESSION_ID = /^[\w.:-]{1,200}$/;

const runs = new Map(); // runId → { owner, child?, stopped, done?, ... }
const waiting = []; // runs queued behind MAX_PARALLEL: { runId, go }
let active = 0;

// Resolves true once the run holds a slot, or false if it was stopped while still waiting.
function slot(runId, state, emit) {
  if (active < MAX_PARALLEL) {
    active++;
    return Promise.resolve(true);
  }
  emit({ type: "queued" });
  return new Promise((resolve) => {
    waiting.push({ runId, go: () => resolve(true) });
    state.unqueue = () => {
      const i = waiting.findIndex((w) => w.runId === runId);
      if (i >= 0) waiting.splice(i, 1);
      resolve(false);
    };
  });
}

function release() {
  const next = waiting.shift();
  if (next) next.go();
  else active = Math.max(0, active - 1);
}

/* ---------- transcripts ---------- */

// Each run's steps and outcome, kept as JSON lines so the card's "Steps" can be read later.
let logDir = null;
const MAX_LOG = 1_000_000;
const KEEP_LOGS = 200;

function setLogDir(dir) {
  logDir = dir;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(KEEP_LOGS)) fs.rmSync(path.join(dir, f), { force: true });
  } catch {}
}

const RUN_ID = /^[\w-]{1,100}$/;
const logFile = (runId) => (logDir && RUN_ID.test(runId) ? path.join(logDir, `${runId}.jsonl`) : null);

function logger(runId) {
  const file = logFile(runId);
  let size = 0;
  return (entry) => {
    if (!file || size > MAX_LOG) return;
    const line = `${JSON.stringify({ t: Date.now(), ...entry })}\n`;
    size += line.length;
    try {
      fs.appendFileSync(file, line);
    } catch {}
  };
}

function transcript(runId) {
  const file = logFile(runId);
  if (!file) return [];
  return readText(file)
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Runs one task. `opts.resume` continues an earlier session of the same agent (a follow-up);
 * `opts.level` overrides the configured access (used by connector setup, after a confirm).
 */
async function run(runId, prompt, config, emit, owner, opts = {}) {
  // Registered before anything async, so Stop works even while the agent is still starting.
  const state = { owner, child: null, stopped: false };
  runs.set(runId, state);
  const log = logger(runId);
  let finished = false;
  let holding = false;
  const finish = (event) => {
    if (finished) return;
    finished = true;
    state.done = true;
    if (runs.get(runId) === state) runs.delete(runId);
    clearTimeout(state.timer);
    clearInterval(state.quietTimer);
    if (holding) release();
    log(event.type === "done" ? { type: "done", output: event.output.slice(0, 20000), notice: event.notice } : event);
    emit(event);
  };
  try {
    if (!fs.existsSync(config.cwd)) throw new Error(`The working folder ${config.cwd} doesn't exist. Pick one in Settings → Agents.`);
    const resume = typeof opts.resume === "string" && SESSION_ID.test(opts.resume) ? opts.resume : undefined;
    const runConfig = opts.level ? { ...config, level: opts.level } : config;
    const usageFile = path.join(os.tmpdir(), `char-${runId}-usage.json`);
    const { file, args, label, adapter } = await command(runConfig, prompt, { resume, usageFile });
    // PWD too, not only the process's directory: Electron passes down its own (just "/" when opened
    // from the Dock), and some agents (OpenCode) trust PWD over where they were started.
    const env = { ...(await childEnv()), PWD: config.cwd };
    if (state.stopped) return finish({ type: "stopped" });
    holding = await slot(runId, state, emit);
    state.unqueue = null;
    if (state.stopped) return finish({ type: "stopped" });

    // Its own process group, so Stop also ends anything the agent started.
    const child = spawn(file, args, { cwd: config.cwd, env, stdio: [adapter.stdin ? "pipe" : "ignore", "pipe", "pipe"], detached: true });
    state.child = child;
    if (adapter.stdin) {
      child.stdin.on("error", () => {}); // an agent that exits early closes the pipe
      child.stdin.end(prompt);
    }
    emit({ type: "start", agent: label, level: effectiveLevel(runConfig), resumed: !!resume });
    log({ type: "start", agent: label, level: effectiveLevel(runConfig), cwd: config.cwd, resume, task: opts.task });
    state.timer = setTimeout(() => {
      state.timedOut = true;
      stop(runId, true);
    }, TIME_LIMIT_MS);

    // Quiet for a while: say so on the card (it may be waiting for something), and say when it wakes.
    let lastActivity = Date.now();
    let quiet = false;
    state.quietTimer = setInterval(() => {
      if (!quiet && Date.now() - lastActivity > QUIET_MS) {
        quiet = true;
        emit({ type: "quiet", since: lastActivity });
      }
    }, 10000);
    const activity = () => {
      lastActivity = Date.now();
      if (quiet) {
        quiet = false;
        emit({ type: "quiet", since: 0 });
      }
    };

    // What the parsers report, turned into events for the card.
    let lastProgress = 0;
    const ctx = {
      sessionId: null,
      result: null, // { output } or { message }
      notices: [],
      session(id) {
        if (!id || ctx.sessionId) return;
        ctx.sessionId = String(id);
        emit({ type: "session", id: ctx.sessionId });
        log({ type: "session", id: ctx.sessionId });
      },
      step(tool, detail) {
        const step = { tool: String(tool || "tool").slice(0, 60), detail: String(detail || "").slice(0, 200) };
        emit({ type: "step", step });
        log({ type: "step", ...step });
      },
      say(text) {
        const line = String(text).replace(ANSI, "").split("\n").map((l) => l.trim()).filter(Boolean).pop();
        const now = Date.now();
        if (line && now - lastProgress > 250) {
          lastProgress = now;
          emit({ type: "progress", line: line.slice(0, 200) });
        }
      },
      final(output) {
        ctx.result = { output: String(output) };
      },
      fail(message, fatal = false) {
        ctx.result = { message: String(message) };
        log({ type: "error", message: String(message) });
        if (fatal) stop(runId, true, true);
      },
      note(text) {
        ctx.notices.push(text);
      },
    };

    let out = ""; // raw stdout (the answer, for agents without events)
    let err = "";
    let truncated = false;
    let pending = ""; // a JSON line still arriving
    const onLine = (line) => {
      if (!line.trim()) return;
      if (!adapter.json) return adapter.parse(line, ctx);
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        return ctx.say(line); // not an event: a log line some agents print anyway
      }
      try {
        adapter.parse(obj, ctx);
      } catch {}
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      activity();
      if (out.length < MAX_OUTPUT) out += d;
      else truncated = true;
      pending += d;
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      if (pending.length > MAX_OUTPUT) pending = "";
      for (const l of parts) onLine(l);
    });
    child.stderr.on("data", (d) => {
      activity();
      err = (err + d).slice(-20000);
      ctx.say(d);
    });
    child.on("error", (e) => finish({ type: "error", message: e.code === "ENOENT" ? `Couldn't start ${label}.` : e.message }));

    const conclude = (code, signal) => {
      if (pending) onLine(pending);
      pending = "";
      // Hermes reports its session (and whether it failed) in the usage file, not on stdout.
      const usage = readJson(usageFile);
      fs.rmSync(usageFile, { force: true });
      if (usage?.session_id) ctx.session(usage.session_id);
      if (state.timedOut && !state.fatal) return finish({ type: "error", message: `${label} was still working after ${TIME_LIMIT_MS / 60000} minutes, so charlie stopped it.` });
      if (state.stopped) return finish({ type: "stopped" });
      if (ctx.result?.message) return finish({ type: "error", message: ctx.result.message });
      const output = (adapter.json ? (ctx.result?.output ?? ctx.answer ?? "") : out).replace(ANSI, "").trim();
      const notice = [...ctx.notices, ...(truncated ? ["The answer was longer than 2 MB, so it was cut."] : [])].join(" ") || undefined;
      if (code === 0 && output && !usage?.failed) return finish({ type: "done", output, sessionId: ctx.sessionId ?? undefined, notice });
      const why = (err.replace(ANSI, "").trim() || (adapter.json ? "" : output)).split("\n").slice(-6).join("\n");
      finish({
        type: "error",
        message: why || (signal ? `${label} was stopped (${signal}).` : code === 0 ? `${label} finished without an answer.` : `${label} exited with code ${code}.`),
      });
    };
    let exited = null;
    child.on("exit", (code, signal) => {
      exited = [code, signal];
      setTimeout(() => conclude(code, signal), DRAIN_MS);
    });
    child.on("close", (code, signal) => conclude(...(exited ?? [code, signal])));
  } catch (e) {
    finish(state.stopped ? { type: "stopped" } : { type: "error", message: e.message });
  }
}

function kill(state, sig) {
  if (!state.child) return;
  try {
    process.kill(-state.child.pid, sig);
  } catch {
    try {
      state.child.kill(sig);
    } catch {}
  }
}

// `internal` stops are charlie's own (time limit, a fatal error it saw): they don't count as the user's Stop.
function stop(runId, internal = false, fatal = false) {
  const state = runs.get(runId);
  if (!state) return false;
  if (internal) {
    state.timedOut = true;
    state.fatal = fatal;
  } else state.stopped = true;
  state.unqueue?.();
  kill(state, "SIGTERM");
  setTimeout(() => !state.done && kill(state, "SIGKILL"), 3000);
  return true;
}

/** Stops every run a window started (it closed, reloaded or crashed: nobody is left to receive the answer). */
function stopOwnedBy(owner) {
  for (const [id, state] of [...runs]) if (state.owner === owner) stop(id);
}

function stopAll() {
  for (const id of [...runs.keys()]) stop(id);
}

module.exports = {
  AGENTS,
  LEVELS,
  levelsFor,
  effectiveLevel,
  normalizeConfig,
  detect,
  status,
  models,
  mcpList,
  signInCommand,
  setLogDir,
  transcript,
  run,
  stop,
  stopOwnedBy,
  stopAll,
};
