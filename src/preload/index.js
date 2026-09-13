// Narrow, explicit bridge between the sandboxed renderer and the main
// process -- the renderer never gets raw ipcRenderer, only these calls.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('btu', {
  config: {
    getAll: () => ipcRenderer.invoke('config:get-all'),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
  },
  auth: {
    offlineLogin: (username) => ipcRenderer.invoke('auth:offline-login', username),
    microsoftLogin: () => ipcRenderer.invoke('auth:microsoft-login'),
    microsoftTryRefresh: () => ipcRenderer.invoke('auth:microsoft-try-refresh'),
    microsoftLogout: () => ipcRenderer.invoke('auth:microsoft-logout'),
  },
  modpack: {
    checkUpdate: () => ipcRenderer.invoke('modpack:check-update'),
    applyUpdate: (manifest) => ipcRenderer.invoke('modpack:apply-update', manifest),
    onProgress: (cb) => ipcRenderer.on('modpack:update-progress', (_e, p) => cb(p)),
  },
  game: {
    launch: (profile) => ipcRenderer.invoke('game:launch', profile),
    isRunning: () => ipcRenderer.invoke('game:is-running'),
    onStatus: (cb) => ipcRenderer.on('game:status', (_e, p) => cb(p)),
    onLog: (cb) => ipcRenderer.on('game:log', (_e, line) => cb(line)),
    onExit: (cb) => ipcRenderer.on('game:exit', (_e, p) => cb(p)),
    onStarted: (cb) => ipcRenderer.on('game:started', (_e, p) => cb(p)),
  },
});
