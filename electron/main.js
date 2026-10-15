// char for macOS: a window around the static Next.js export in out/, plus a JSON file for the notes.

const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// `npm run app:dev` points this at `next dev`; packaged builds serve out/ over app://char.
const DEV_URL = process.env.CHAR_DEV_URL;
const ORIGIN = DEV_URL || "app://char";
const OUT = path.join(__dirname, "..", "out");

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

/* ---------- notes on disk ---------- */

// Lets a second copy (or a test run) use its own notes instead of ~/Library/Application Support/char.
if (process.env.CHAR_DATA_DIR) app.setPath("userData", path.resolve(process.env.CHAR_DATA_DIR));

const dataFile = () => path.join(app.getPath("userData"), "workspace.json");
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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Keep the file as it was at launch, in case a bad save needs undoing.
  if (!backedUp && fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  backedUp = true;
  // Write then rename, so a crash mid-write can't leave half a file.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// "Jay Katariya" → "Jay", for the greeting. Falls back to the short account name.
function firstName() {
  try {
    const full = execFileSync("id", ["-F"], { encoding: "utf8" }).trim();
    if (full) return full.split(/\s+/)[0];
  } catch {}
  return os.userInfo().username;
}

ipcMain.on("char:info", (e) => {
  e.returnValue = { userName: firstName(), dataPath: dataFile() };
});
ipcMain.handle("workspace:load", () => loadWorkspace());
ipcMain.handle("workspace:save", (_e, data) => saveWorkspace(data));
ipcMain.on("workspace:reveal", () => {
  if (fs.existsSync(dataFile())) shell.showItemInFolder(dataFile());
  else shell.openPath(path.dirname(dataFile()));
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

/* ---------- window ---------- */

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
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
    },
  });
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => (win = null));

  // Links in notes open in the default browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin === new URL(ORIGIN).origin) return;
    e.preventDefault();
    if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
  });

  win.loadURL(`${ORIGIN}/notes`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    // The renderer owns ⌘N, ⌘K, ⌘J and ⌘\, so the menu stays to the standard roles.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: "appMenu" }, { role: "fileMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }]),
    );
    if (!DEV_URL) serveApp();
    createWindow();
    app.on("activate", () => {
      if (!win) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
