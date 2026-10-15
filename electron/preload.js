// The only bridge between the page and the Mac. See src/lib/desktop.ts for the typed side.

const { contextBridge, ipcRenderer } = require("electron");

const info = ipcRenderer.sendSync("char:info");

// Subscribes to a main-process event; returns the unsubscribe function.
const listen = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

// Full screen hides the traffic lights, so the layout stops leaving room for them (see globals.css).
ipcRenderer.on("char:fullscreen", (_e, on) => document.documentElement.toggleAttribute("data-fullscreen", !!on));

contextBridge.exposeInMainWorld("char", {
  userName: info.userName,
  dataPath: info.dataPath,
  version: info.version,

  load: () => ipcRenderer.invoke("workspace:load"),
  save: (data) => ipcRenderer.invoke("workspace:save", data),
  revealData: () => ipcRenderer.send("workspace:reveal"),

  onMenu: (cb) => listen("char:menu", cb),
  onOpen: (cb) => {
    ipcRenderer.invoke("char:take-pending-open").then((target) => target && cb(target));
    return listen("char:open", cb);
  },
  allowAI: (baseUrl) => ipcRenderer.invoke("ai:allow", baseUrl),
  onUpdate: (cb) => listen("char:update", cb),

  agent: {
    detect: () => ipcRenderer.invoke("agent:detect"),
    models: (agentId) => ipcRenderer.invoke("agent:models", agentId),
    getConfig: () => ipcRenderer.invoke("agent:get-config"),
    setConfig: (config) => ipcRenderer.invoke("agent:set-config", config),
    pickFolder: () => ipcRenderer.invoke("agent:pick-folder"),
    run: (runId, prompt) => ipcRenderer.invoke("agent:run", { runId, prompt }),
    stop: (runId) => ipcRenderer.invoke("agent:stop", runId),
    onEvent: (cb) => listen("agent:event", cb),
  },
});
