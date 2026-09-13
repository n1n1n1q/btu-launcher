// Narrow, explicit bridge between the sandboxed renderer and the main
// process -- the renderer never gets raw ipcRenderer, only these calls.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('btu', {
  platform: process.platform,
  win: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChanged: (cb) => ipcRenderer.on('window:maximized-changed', (_e, v) => cb(v)),
  },
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
  updater: {
    onStatus: (cb) => ipcRenderer.on('updater:status', (_e, p) => cb(p)),
  },
  maintenance: {
    usage: () => ipcRenderer.invoke('maintenance:usage'),
    reinstall: (groups) => ipcRenderer.invoke('maintenance:reinstall', groups),
    dataLocation: () => ipcRenderer.invoke('maintenance:data-location'),
    chooseDataDir: () => ipcRenderer.invoke('maintenance:choose-data-dir'),
    moveDataDir: (parentDir) => ipcRenderer.invoke('maintenance:move-data-dir', parentDir),
    resetDataDir: () => ipcRenderer.invoke('maintenance:reset-data-dir'),
    onMoveProgress: (cb) => ipcRenderer.on('maintenance:move-progress', (_e, p) => cb(p)),
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
