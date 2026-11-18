const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("host", {
  call: (command, data) => ipcRenderer.invoke("command", command, data),
  events: (fn) => ipcRenderer.on("event", (_, e) => fn(e)),
});
