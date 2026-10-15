// Renders build/icon.png (1024×1024) for electron-builder, which turns it into the .icns.
// Run with: npx electron scripts/make-icon.js

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const BUILD = path.join(__dirname, "..", "build");
const font = fs.readFileSync(path.join(BUILD, "jetbrains-mono-latin.woff2")).toString("base64");

// macOS icon grid: an 824px rounded square centred on a 1024px transparent canvas.
const html = `<!doctype html><html><head><style>
  @font-face { font-family: Mono; font-weight: 100 800; src: url(data:font/woff2;base64,${font}) format("woff2"); }
  html, body { margin: 0; width: 1024px; height: 1024px; background: transparent; }
  .tile {
    position: absolute; left: 100px; top: 100px; width: 824px; height: 824px; border-radius: 185px;
    background: linear-gradient(#fdfcfa, #f1eee7); box-shadow: inset 0 0 0 2px rgba(43,38,32,.08), 0 18px 40px rgba(43,38,32,.22);
    display: flex; align-items: center; justify-content: center;
    font: 800 330px/1 Mono; letter-spacing: -0.04em; color: #2b2620;
  }
</style></head><body><div class="tile">{c}</div></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
  await win.webContents.executeJavaScript("document.fonts.ready.then(() => new Promise(r => setTimeout(r, 200)))");
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(path.join(BUILD, "icon.png"), image.resize({ width: 1024, height: 1024 }).toPNG());
  console.log("wrote build/icon.png");
  app.quit();
});
