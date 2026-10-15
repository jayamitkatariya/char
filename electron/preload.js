// The only bridge between the page and the Mac: read and write the notes file. See src/lib/desktop.ts.

const { contextBridge, ipcRenderer } = require("electron");

const info = ipcRenderer.sendSync("char:info");

contextBridge.exposeInMainWorld("char", {
  load: () => ipcRenderer.invoke("workspace:load"),
  save: (data) => ipcRenderer.invoke("workspace:save", data),
  userName: info.userName,
  dataPath: info.dataPath,
  revealData: () => ipcRenderer.send("workspace:reveal"),
});
