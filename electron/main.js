// char for macOS: a window around the static Next.js export in out/, a JSON file for the notes,
// and @charlie, which hands tasks to a coding agent installed on this Mac (see ./agents.js).

const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, screen, session, shell } = require("electron");
const { execFile, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const agents = require("./agents");

// `npm run app:dev` points this at `next dev`; packaged builds serve out/ over app://char.
const DEV_URL = process.env.CHAR_DEV_URL;
const ORIGIN = DEV_URL || "app://char";
const OUT = path.join(__dirname, "..", "out");

// Lets a second copy (or a test run) use its own notes instead of ~/Library/Application Support/char.
if (process.env.CHAR_DATA_DIR) app.setPath("userData", path.resolve(process.env.CHAR_DATA_DIR));

// Same policy the site used on Firebase Hosting: only the AI provider you configure is reachable.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const userFile = (name) => path.join(app.getPath("userData"), name);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Write then rename, so a crash mid-write can't leave half a file.
function writeJsonAtomic(file, data, pretty = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/* ---------- notes on disk ---------- */

const dataFile = () => userFile("workspace.json");
let backedUp = false;

function loadWorkspace() {
  try {
    return JSON.parse(fs.readFileSync(dataFile(), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null; // first launch
    // A corrupt file is reported, never replaced with an empty workspace.
    throw new Error(`${dataFile()} couldn't be read (${e.message})`);
  }
}

function saveWorkspace(data) {
  if (!data || !Array.isArray(data.folders) || !Array.isArray(data.notes)) throw new Error("Refusing to save malformed notes");
  const file = dataFile();
  // Keep the file as it was at launch, in case a bad save needs undoing.
  if (!backedUp && fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  backedUp = true;
  writeJsonAtomic(file, data);
}

// "Jay Katariya" → "Jay", for the greeting. Falls back to the short account name.
function firstName() {
  try {
    const full = execFileSync("id", ["-F"], { encoding: "utf8" }).trim();
    if (full) return full.split(/\s+/)[0];
  } catch {}
  return os.userInfo().username;
}

// Only char's own page may use the bridge (not, say, a page an external link somehow loaded).
const fromApp = (e) => {
  try {
    return new URL(e.senderFrame?.url ?? "").origin === new URL(ORIGIN).origin;
  } catch {
    return false;
  }
};
const guard = (fn) => (e, ...args) => {
  if (!fromApp(e)) throw new Error("Not allowed");
  return fn(e, ...args);
};

ipcMain.on("char:info", (e) => {
  e.returnValue = fromApp(e) ? { userName: firstName(), dataPath: dataFile(), version: app.getVersion() } : {};
});
ipcMain.handle("workspace:load", guard(() => loadWorkspace()));
ipcMain.handle("workspace:save", guard((_e, data) => saveWorkspace(data)));
ipcMain.on("workspace:reveal", (e) => {
  if (!fromApp(e)) return;
  if (fs.existsSync(dataFile())) shell.showItemInFolder(dataFile());
  else shell.openPath(path.dirname(dataFile()));
});

/* ---------- @charlie ---------- */

const agentFile = () => userFile("agent.json");
const getAgentConfig = () => agents.normalizeConfig(readJson(agentFile(), {}));

// Asked by the page once it can navigate, so a link that launched the app isn't lost.
ipcMain.handle("char:take-pending-open", (e) => {
  if (!fromApp(e)) return null;
  const target = pendingOpen;
  pendingOpen = null;
  return target;
});

ipcMain.handle("agent:detect", guard(() => agents.detect()));
ipcMain.handle("agent:status", guard((_e, agentId) => agents.status(agentId)));
ipcMain.handle("agent:models", guard((_e, agentId) => agents.models(agentId)));
ipcMain.handle("agent:mcp", guard((_e, agentId) => agents.mcpList(agentId)));
ipcMain.handle("agent:transcript", guard((_e, runId) => agents.transcript(String(runId))));
ipcMain.handle("agent:get-config", guard(() => getAgentConfig()));

const ownerWindow = (e) => BrowserWindow.fromWebContents(e.sender) ?? undefined;
const LEVEL_WORDS = { read: "read files", edit: "edit files in it", full: "edit files and run commands there without asking" };

// Settings that let charlie run something new, or do more somewhere new, are confirmed in a
// native dialog the page can't click through itself.
ipcMain.handle(
  "agent:set-config",
  guard(async (e, config) => {
    const old = getAgentConfig();
    const next = agents.normalizeConfig(config);
    const was = agents.effectiveLevel(old);
    const now = agents.effectiveLevel(next);
    const rank = (l) => agents.LEVELS.indexOf(l);
    const newCommand = next.agent === "custom" && (old.agent !== "custom" || old.custom !== next.custom);
    const newPower = now !== "read" && (rank(now) > rank(was) || old.cwd !== next.cwd || old.agent !== next.agent || newCommand);
    if (newCommand || newPower) {
      const who = next.agent === "custom" ? `the command “${next.custom}”` : agents.AGENTS[next.agent].label;
      const { response } = await dialog.showMessageBox(ownerWindow(e), {
        type: now === "full" ? "warning" : "question",
        message: now === "full" ? `Let charlie run ${who} with full access?` : `Let charlie run ${who}?`,
        detail: `It will run in ${next.cwd} and can ${LEVEL_WORDS[now]}, each time you send it a task from a note.${
          next.agent === "hermes" ? " Hermes approves its own actions in one-shot mode, so it always runs with full access." : ""
        }`,
        buttons: ["Allow", "Cancel"],
        defaultId: 1,
        cancelId: 1,
      });
      if (response !== 0) return old;
    }
    writeJsonAtomic(agentFile(), next);
    return next;
  }),
);
ipcMain.handle("agent:pick-folder", async (e) => {
  if (!fromApp(e)) return null;
  const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: "Where should charlie work?",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: getAgentConfig().cwd,
  });
  return res.canceled ? null : res.filePaths[0];
});

function startRun(e, runId, prompt, opts) {
  const target = e.sender;
  watchOwner(target);
  agents.run(
    runId,
    prompt,
    getAgentConfig(),
    (event) => {
      if (!target.isDestroyed()) target.send("agent:event", { runId, ...event });
    },
    target.id,
    opts,
  );
}

// The renderer sends only the task and the note context; which program runs, where, and with
// which permissions comes from agent.json, which only the Settings screen writes.
ipcMain.handle(
  "agent:run",
  guard((e, { runId, prompt, resume, task }) =>
    startRun(e, String(runId), String(prompt), { resume: typeof resume === "string" ? resume : undefined, task: typeof task === "string" ? task.slice(0, 500) : undefined }),
  ),
);

// Connector setup asks the agent to install and sign in to a tool for itself, which needs full
// access whatever charlie's usual level is, so every one is confirmed natively, showing the prompt.
ipcMain.handle(
  "agent:setup",
  guard(async (e, { runId, name, prompt }) => {
    const config = getAgentConfig();
    const who = config.agent === "custom" ? config.custom : agents.AGENTS[config.agent].label;
    const { response } = await dialog.showMessageBox(ownerWindow(e), {
      type: "warning",
      message: `Let ${who} set up ${String(name).slice(0, 60)} with full access?`,
      detail: `It runs in ${config.cwd} and may install tools, edit its own settings and open your browser to sign in. It will be asked:\n\n${String(prompt).slice(0, 900)}`,
      buttons: ["Set up", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return false;
    startRun(e, String(runId), String(prompt), { level: "full", task: `Set up ${name}` });
    return true;
  }),
);

// Signing in to an agent is interactive (a browser, a code to paste), so it happens in Terminal.
// Only the agent's own fixed sign-in command can be opened, never text from the page.
ipcMain.handle(
  "agent:sign-in",
  guard(async (_e, agentId) => {
    const cmd = agents.signInCommand(agentId);
    if (!cmd) return false;
    const script = `tell application "Terminal"\nactivate\ndo script "${cmd.join(" ")}"\nend tell`;
    execFile("osascript", ["-e", script], () => {});
    return true;
  }),
);
ipcMain.handle("agent:stop", guard((_e, runId) => agents.stop(runId)));

// A run's answer can only land in the page that asked. If that page goes away (window closed,
// reloaded, crashed), its runs stop; the card then offers Retry.
const watched = new WeakSet();
function watchOwner(contents) {
  if (watched.has(contents)) return;
  watched.add(contents);
  const id = contents.id;
  contents.on("destroyed", () => agents.stopOwnedBy(id));
  contents.on("render-process-gone", () => agents.stopOwnedBy(id));
  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) agents.stopOwnedBy(id);
  });
}

/* ---------- which AI provider the page may reach without CORS ---------- */

const aiOrigins = new Set();
ipcMain.handle("ai:allow", (e, baseUrl) => {
  if (!fromApp(e)) return;
  try {
    const u = new URL(baseUrl);
    if (u.protocol === "http:" || u.protocol === "https:") aiOrigins.add(u.origin);
  } catch {}
});

/* ---------- serving out/ ---------- */

// Mirrors static hosting with clean URLs: /notes → notes.html, / → index.html.
function resolveFile(pathname) {
  const rel = decodeURIComponent(pathname).replace(/\/+$/, "") || "/index";
  for (const candidate of [rel, `${rel}.html`, `${rel}/index.html`]) {
    const file = path.join(OUT, candidate);
    if (!file.startsWith(OUT + path.sep)) return null;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

function serveApp() {
  protocol.handle("app", async (req) => {
    const file = resolveFile(new URL(req.url).pathname);
    const res = await net.fetch(pathToFileURL(file ?? path.join(OUT, "404.html")).toString());
    const headers = new Headers(res.headers);
    if (headers.get("content-type")?.startsWith("text/html")) headers.set("Content-Security-Policy", CSP);
    return new Response(res.body, { status: file ? 200 : 404, headers });
  });
}

// AI providers are called straight from the page. Browser CORS would block local servers like
// Ollama or LM Studio unless they're reconfigured, so for the provider set in Settings (and only
// that one) the app vouches for its own requests.
function allowCrossOriginAI() {
  const preflightHeaders = new Map();
  const isProvider = (url) => {
    try {
      return aiOrigins.has(new URL(url).origin);
    } catch {
      return false;
    }
  };
  const ours = (url) => !isProvider(url);
  const filter = { urls: ["http://*/*", "https://*/*"] };
  session.defaultSession.webRequest.onErrorOccurred(filter, (d) => preflightHeaders.delete(d.id));
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (d, done) => {
    if (ours(d.url)) return done({});
    const headers = { ...d.requestHeaders };
    const asked = Object.entries(headers).find(([k]) => k.toLowerCase() === "access-control-request-headers");
    if (asked) preflightHeaders.set(d.id, asked[1]);
    for (const k of Object.keys(headers)) if (k.toLowerCase() === "origin") delete headers[k];
    done({ requestHeaders: headers });
  });
  session.defaultSession.webRequest.onHeadersReceived(filter, (d, done) => {
    if (ours(d.url)) return done({});
    const headers = Object.fromEntries(Object.entries(d.responseHeaders ?? {}).filter(([k]) => !k.toLowerCase().startsWith("access-control-")));
    headers["Access-Control-Allow-Origin"] = ["*"];
    headers["Access-Control-Allow-Methods"] = ["GET, POST, PUT, PATCH, DELETE, OPTIONS"];
    headers["Access-Control-Allow-Headers"] = [preflightHeaders.get(d.id) || "*"];
    headers["Access-Control-Expose-Headers"] = ["*"];
    preflightHeaders.delete(d.id);
    // Some local servers answer preflights with 404/405; the real request is what matters.
    if (d.method === "OPTIONS") return done({ responseHeaders: headers, statusLine: "HTTP/1.1 204 No Content" });
    done({ responseHeaders: headers });
  });
}

/* ---------- window ---------- */

let win = null;
let pendingOpen = null; // a char:// link that arrived before the window was ready

const stateFile = () => userFile("window.json");

function savedBounds() {
  const b = readJson(stateFile(), null);
  if (!b || typeof b.width !== "number") return null;
  // Forget the position if that display is gone.
  const area = screen.getDisplayMatching(b).workArea;
  const visible = b.x < area.x + area.width && b.x + b.width > area.x && b.y < area.y + area.height && b.y + b.height > area.y;
  return visible ? b : { width: b.width, height: b.height };
}

function rememberBounds() {
  if (!win || win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
  try {
    writeJsonAtomic(stateFile(), win.getNormalBounds(), false);
  } catch {}
}

// char://note/<id> and char://folder/<id> open that note in the app.
function openDeepLink(url) {
  const m = /^char:\/\/(note|folder)\/([\w-]+)/.exec(url);
  if (!m) return;
  if (!win || win.webContents.isLoading()) {
    pendingOpen = { kind: m[1], id: m[2] };
    if (!win && app.isReady()) createWindow();
    else if (win) {
      win.show();
      win.focus();
    }
    return;
  }
  win.webContents.send("char:open", { kind: m[1], id: m[2] });
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

const sendMenu = (action) => win?.webContents.send("char:menu", action);

/* ---------- updates ---------- */

const REPO = "jayamitkatariya/char";
let announced = null; // the newer version the page was already told about

// "1.10.0" > "1.9.2"; pre-release suffixes are ignored.
function isNewer(latest, current) {
  const a = latest.split(/[.-]/).map(Number);
  const b = current.split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}

// Asks GitHub Releases for the newest version. Nothing is downloaded or installed automatically.
async function checkForUpdates(manual = false) {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `char/${app.getVersion()}` },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const release = await res.json();
    const latest = String(release.tag_name || "").replace(/^v/, "");
    const url = release.html_url || `https://github.com/${REPO}/releases/latest`;
    if (latest && isNewer(latest, app.getVersion())) {
      if (announced !== latest) win?.webContents.send("char:update", { version: latest, url });
      announced = latest;
      if (manual) {
        const { response } = await dialog.showMessageBox(win ?? undefined, {
          message: `char ${latest} is available`,
          detail: `You have ${app.getVersion()}. Download the new version from GitHub and drag it into Applications.`,
          buttons: ["Download", "Later"],
          defaultId: 0,
        });
        if (response === 0) shell.openExternal(url);
      }
    } else if (manual) {
      dialog.showMessageBox(win ?? undefined, { message: "You're up to date", detail: `char ${app.getVersion()} is the newest version.` });
    }
  } catch (e) {
    if (manual) dialog.showMessageBox(win ?? undefined, { type: "warning", message: "Couldn't check for updates", detail: e.message });
  }
}

function createWindow() {
  const bounds = savedBounds();
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    ...bounds,
    minWidth: 820, // keeps the desktop layout (the UI switches to a phone layout below 768px)
    minHeight: 560,
    title: "char",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#fdfcfa",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  const w = win;
  w.once("ready-to-show", () => w.show());
  w.on("closed", () => {
    if (win === w) win = null;
  });

  let boundsTimer = null;
  const queueBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(rememberBounds, 400);
  };
  w.on("resize", queueBounds);
  w.on("move", queueBounds);
  w.on("close", rememberBounds);

  // The sidebar and top bar make room for the traffic lights, which macOS hides in full screen.
  const sendFullscreen = () => w.webContents.send("char:fullscreen", w.isFullScreen());
  w.on("enter-full-screen", sendFullscreen);
  w.on("leave-full-screen", sendFullscreen);
  w.webContents.on("did-finish-load", () => {
    sendFullscreen();
    if (announced) w.webContents.send("char:update", { version: announced, url: `https://github.com/${REPO}/releases/latest` });
  });

  // Links in notes open in the default browser, never inside the app window.
  const external = (url) => {
    if (url.startsWith("char://")) openDeepLink(url);
    else if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
  };
  w.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith(ORIGIN)) return;
    e.preventDefault();
    external(url);
  });

  // Electron has no right-click menu of its own: spelling, the usual edit actions, and links.
  w.webContents.on("context-menu", (_e, p) => {
    const items = [];
    for (const word of p.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: word, click: () => w.webContents.replaceMisspelling(word) });
    }
    if (p.misspelledWord) {
      if (!p.dictionarySuggestions.length) items.push({ label: "No guesses found", enabled: false });
      items.push({ label: "Learn Spelling", click: () => w.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      items.push({ type: "separator" });
    }
    if (p.linkURL && !p.linkURL.startsWith(ORIGIN)) {
      items.push({ label: "Open Link", click: () => external(p.linkURL) });
      items.push({ label: "Copy Link", click: () => require("electron").clipboard.writeText(p.linkURL) });
      items.push({ type: "separator" });
    }
    if (p.selectionText.trim() && !p.isEditable) {
      items.push({ label: `Look Up “${p.selectionText.trim().slice(0, 24)}”`, click: () => w.showDefinitionForSelection() });
      items.push({ type: "separator" });
    }
    if (p.isEditable) {
      items.push({ role: "cut", enabled: p.editFlags.canCut }, { role: "copy", enabled: p.editFlags.canCopy });
      items.push({ role: "paste", enabled: p.editFlags.canPaste }, { role: "pasteAndMatchStyle", enabled: p.editFlags.canPaste });
      items.push({ role: "selectAll" });
    } else if (p.selectionText.trim()) {
      items.push({ role: "copy" });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: w });
  });

  w.loadURL(`${ORIGIN}/notes`);
}

function buildMenu() {
  // Shortcuts the page already handles show here without registering (registerAccelerator: false),
  // so a key press never fires twice; the click sends the same action to the page.
  const page = (label, action, accelerator) => ({ label, accelerator, registerAccelerator: false, click: () => sendMenu(action) });
  return Menu.buildFromTemplate([
    {
      role: "appMenu",
      submenu: [
        { role: "about" },
        { label: "Check for Updates…", click: () => checkForUpdates(true) },
        { type: "separator" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => sendMenu("settings") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [page("New Note", "new-note", "CmdOrCtrl+N"), { label: "New Folder", click: () => sendMenu("new-folder") }, { type: "separator" }, { role: "close" }],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        page("Search…", "search", "CmdOrCtrl+K"),
        page("Ask char", "ask", "CmdOrCtrl+J"),
        page("Toggle Sidebar", "toggle-sidebar", "CmdOrCtrl+\\"),
        { type: "separator" },
        { label: "Today", accelerator: "CmdOrCtrl+Shift+H", click: () => sendMenu("home") },
        { label: "Back", accelerator: "CmdOrCtrl+[", click: () => win?.webContents.navigationHistory.canGoBack() && win.webContents.navigationHistory.goBack() },
        { label: "Forward", accelerator: "CmdOrCtrl+]", click: () => win?.webContents.navigationHistory.canGoForward() && win.webContents.navigationHistory.goForward() },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" }]),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [{ label: "char on GitHub", click: () => shell.openExternal("https://github.com/jayamitkatariya/char") }],
    },
  ]);
}

// macOS delivers char:// links through open-url, which can fire before the app is ready.
app.on("open-url", (e, url) => {
  e.preventDefault();
  openDeepLink(url);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const link = argv.find((a) => a.startsWith("char://"));
    if (link) return openDeepLink(link);
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    agents.setLogDir(userFile("runs"));
    // Only the installed app claims char:// links; a dev build would otherwise steal them.
    if (app.isPackaged) app.setAsDefaultProtocolClient("char");
    app.setAboutPanelOptions({
      applicationName: "char",
      applicationVersion: app.getVersion(),
      credits: "The AI notepad that gets things done.\nOpen source: github.com/jayamitkatariya/char",
      copyright: "© 2026 Jay Katariya · MIT License",
    });
    Menu.setApplicationMenu(buildMenu());
    allowCrossOriginAI();
    if (!DEV_URL) serveApp();
    createWindow();
    if (app.isPackaged) {
      setTimeout(() => checkForUpdates(), 8000);
      setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000);
    }
    app.on("activate", () => {
      if (!win) createWindow();
    });
  });

  app.on("before-quit", () => agents.stopAll());
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
