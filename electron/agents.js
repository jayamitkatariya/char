// @charlie: runs one task through a terminal coding agent installed on this Mac, in the folder
// the user picked, and reports back. Each agent runs in its one-shot (non-interactive) mode.

const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// `full` is the user's "can edit files and run commands without asking" switch. Without it
// each agent runs with its own default (or read-only) permissions. An empty `model` leaves the
// choice to the agent's own configuration.
const AGENTS = {
  claude: {
    label: "Claude Code",
    bin: "claude",
    args: (prompt, full, model) => [
      "-p",
      prompt,
      "--output-format",
      "text",
      ...(model ? ["--model", model] : []),
      ...(full ? ["--permission-mode", "bypassPermissions"] : []),
    ],
    // Aliases always point at the newest model of that tier.
    models: async () => ["fable", "opus", "sonnet", "haiku", "claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  },
  opencode: {
    label: "OpenCode",
    bin: "opencode",
    args: (prompt, full, model) => ["run", ...(model ? ["--model", model] : []), ...(full ? ["--auto"] : []), prompt],
    models: (file, env) => listFrom(file, ["models"], env),
  },
  hermes: {
    label: "Hermes",
    bin: "hermes",
    args: (prompt, full, model) => ["-z", prompt, ...(model ? ["-m", model] : []), ...(full ? ["--yolo"] : [])],
  },
  codex: {
    label: "Codex",
    bin: "codex",
    args: (prompt, full, model) => [
      "exec",
      "--skip-git-repo-check",
      "--color",
      "never",
      ...(model ? ["--model", model] : []),
      ...(full ? ["--dangerously-bypass-approvals-and-sandbox"] : ["--sandbox", "read-only"]),
      prompt,
    ],
  },
};

function normalizeConfig(c = {}) {
  const models = {};
  for (const id of Object.keys(AGENTS)) {
    const m = c.models?.[id];
    if (typeof m === "string" && m.trim()) models[id] = m.trim();
  }
  return {
    agent: c.agent === "custom" || Object.hasOwn(AGENTS, c.agent) ? c.agent : "claude",
    custom: typeof c.custom === "string" ? c.custom.trim() : "",
    cwd: typeof c.cwd === "string" && c.cwd ? c.cwd : os.homedir(),
    full: c.full === true,
    models,
  };
}

// One model id per line of a CLI's output (`opencode models`).
function listFrom(file, args, env) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 30000, env, maxBuffer: 4_000_000 }, (_err, stdout) =>
      resolve(
        (stdout || "")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => /^[\w.@:/-]+$/.test(l)),
      ),
    );
  });
}

async function models(agentId) {
  const a = Object.hasOwn(AGENTS, agentId) ? AGENTS[agentId] : null;
  if (!a?.models) return [];
  const file = await which(a.bin);
  return file ? a.models(file, await childEnv()) : [];
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

function version(file, env) {
  return new Promise((resolve) => {
    execFile(file, ["--version"], { timeout: 6000, env }, (_err, stdout) => resolve((stdout || "").trim().split("\n")[0] || null));
  });
}

async function detect() {
  const env = await childEnv();
  const entries = await Promise.all(
    Object.entries(AGENTS).map(async ([id, a]) => {
      const file = await which(a.bin);
      return [id, { label: a.label, path: file, version: file ? await version(file, env) : null }];
    }),
  );
  return Object.fromEntries(entries);
}

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

async function command(config, prompt) {
  if (config.agent === "custom") {
    const parts = splitCommand(config.custom);
    if (!parts.length) throw new Error("Add a command for your custom agent in Settings → Agents.");
    const file = await which(resolveCommand(parts[0], config.cwd));
    if (!file) throw new Error(`Couldn't find “${parts[0]}”. Check the command in Settings → Agents.`);
    const rest = parts.slice(1);
    const hasSlot = rest.some((a) => a.includes("{prompt}"));
    return { file, args: hasSlot ? rest.map((a) => a.replaceAll("{prompt}", prompt)) : [...rest, prompt], label: path.basename(parts[0]) };
  }
  const a = AGENTS[config.agent];
  const file = await which(a.bin);
  if (!file) throw new Error(`${a.label} isn't installed (no “${a.bin}” on your PATH). Pick another agent in Settings → Agents.`);
  return { file, args: a.args(prompt, config.full, config.models[config.agent]), label: a.label };
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
const MAX_OUTPUT = 2_000_000;
// Agents can work for a long time, but not forever.
const TIME_LIMIT_MS = 60 * 60 * 1000;
// After the agent exits, how long to wait for output still in flight. A child process it left
// behind can hold the pipes open, so exiting is what counts, not the pipes closing.
const DRAIN_MS = 1500;
const runs = new Map(); // runId → { owner, child?, stopped, settle? }

async function run(runId, prompt, config, emit, owner) {
  // Registered before anything async, so Stop works even while the agent is still starting.
  const state = { owner, child: null, stopped: false };
  runs.set(runId, state);
  let finished = false;
  const finish = (event) => {
    if (finished) return;
    finished = true;
    state.done = true;
    if (runs.get(runId) === state) runs.delete(runId);
    clearTimeout(state.timer);
    emit(event);
  };
  try {
    if (!fs.existsSync(config.cwd)) throw new Error(`The working folder ${config.cwd} doesn't exist. Pick one in Settings → Agents.`);
    const { file, args, label } = await command(config, prompt);
    const env = await childEnv();
    if (state.stopped) return finish({ type: "stopped" });
    // Its own process group, so Stop also ends anything the agent started.
    const child = spawn(file, args, { cwd: config.cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    state.child = child;
    emit({ type: "start", agent: label });
    state.timer = setTimeout(() => {
      state.timedOut = true;
      stop(runId, true);
    }, TIME_LIMIT_MS);

    let out = "";
    let err = "";
    let lastProgress = 0;
    const progress = (chunk) => {
      const line = chunk.replace(ANSI, "").split("\n").map((l) => l.trim()).filter(Boolean).pop();
      const now = Date.now();
      if (line && now - lastProgress > 250) {
        lastProgress = now;
        emit({ type: "progress", line: line.slice(0, 200) });
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      if (out.length < MAX_OUTPUT) out += d;
      progress(d);
    });
    child.stderr.on("data", (d) => {
      err = (err + d).slice(-20000);
      progress(d);
    });
    child.on("error", (e) => finish({ type: "error", message: e.code === "ENOENT" ? `Couldn't start ${label}.` : e.message }));

    const conclude = (code, signal) => {
      const output = out.replace(ANSI, "").trim();
      if (state.timedOut) return finish({ type: "error", message: `${label} was still working after ${TIME_LIMIT_MS / 60000} minutes, so charlie stopped it.` });
      if (state.stopped) return finish({ type: "stopped" });
      if (code === 0 && output) return finish({ type: "done", output });
      const why = (err.replace(ANSI, "").trim() || output).split("\n").slice(-6).join("\n");
      finish({ type: "error", message: why || (signal ? `${label} was stopped (${signal}).` : code === 0 ? `${label} finished without an answer.` : `${label} exited with code ${code}.`) });
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

function stop(runId, keepTimeout = false) {
  const state = runs.get(runId);
  if (!state) return false;
  if (!keepTimeout) state.stopped = true;
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

module.exports = { AGENTS, normalizeConfig, detect, models, run, stop, stopOwnedBy, stopAll };
