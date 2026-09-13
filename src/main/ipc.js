// All main<->renderer wiring lives here so index.js stays a thin bootstrap.
const { ipcMain, dialog } = require('electron');
const config = require('./config');
const offlineAuth = require('./auth/offline');
const msAuth = require('./auth/microsoft');
const { launch } = require('./launcher/gameLauncher');
const { fetchManifest, applyUpdate } = require('./updater/modpack');
const maintenance = require('./maintenance');
const paths = require('./paths');

let runningChild = null;
let preparing = false; // a launch is downloading/installing but hasn't spawned yet
let reinstalling = false; // a reinstall is deleting files right now
let gameExitHandler = null;

/** True while a spawned game is still alive. */
function isGameRunning() {
  return Boolean(runningChild);
}

/** Called when a spawned game exits, so the app can finish quitting. */
function onGameExit(handler) {
  gameExitHandler = handler;
}

function send(win, channel, payload) {
  if (win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function registerIpc(win) {
  // Window controls for the renderer's custom title bar (the native frame is
  // off -- see src/main/index.js).
  ipcMain.handle('window:minimize', () => {
    if (!win.isDestroyed()) win.minimize();
  });
  ipcMain.handle('window:toggle-maximize', () => {
    if (win.isDestroyed()) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('window:close', () => {
    if (!win.isDestroyed()) win.close();
  });
  ipcMain.handle('window:is-maximized', () => !win.isDestroyed() && win.isMaximized());

  ipcMain.handle('config:get-all', () => config.store);
  ipcMain.handle('config:set', (_e, key, value) => {
    config.set(key, value);
    return true;
  });

  ipcMain.handle('auth:offline-login', (_e, username) => {
    const profile = offlineAuth.login(username);
    config.set('lastLoginMode', 'offline');
    config.set('lastOfflineUsername', username);
    return profile;
  });

  ipcMain.handle('auth:microsoft-login', async () => {
    const profile = await msAuth.login();
    config.set('lastLoginMode', 'microsoft');
    return profile;
  });

  ipcMain.handle('auth:microsoft-try-refresh', () => msAuth.tryRefresh());
  ipcMain.handle('auth:microsoft-logout', () => msAuth.logout());

  ipcMain.handle('modpack:check-update', async () => {
    const manifest = await fetchManifest(config.get('modpackUpdateUrl'));
    return manifest;
  });

  ipcMain.handle('modpack:apply-update', async (_e, manifest) => {
    const gameDirPath = paths.gameDir(config.get('btaVersion'));
    return applyUpdate(manifest, gameDirPath, (progress) =>
      send(win, 'modpack:update-progress', progress)
    );
  });

  ipcMain.handle('maintenance:usage', () => maintenance.usage(config.get('btaVersion')));

  ipcMain.handle('maintenance:data-location', () => maintenance.dataLocation());

  // Relocating game content is the same class of operation as a reinstall --
  // it moves the very files a launch is reading -- so it takes the same guards.
  const assertIdle = (what) => {
    if (runningChild) throw new Error(`Close the game before ${what}.`);
    if (preparing) throw new Error(`Wait for the current launch to finish before ${what}.`);
    if (reinstalling) throw new Error('Another maintenance task is already running.');
  };

  ipcMain.handle('maintenance:choose-data-dir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose where to keep game files',
      properties: ['openDirectory', 'createDirectory'],
    });
    return canceled || !filePaths.length ? null : filePaths[0];
  });

  ipcMain.handle('maintenance:move-data-dir', async (_e, parentDir) => {
    assertIdle('moving the installation folder');
    reinstalling = true;
    try {
      return await maintenance.moveDataDir(parentDir, (p) =>
        send(win, 'maintenance:move-progress', p)
      );
    } finally {
      reinstalling = false;
    }
  });

  ipcMain.handle('maintenance:reset-data-dir', async () => {
    assertIdle('moving the installation folder');
    reinstalling = true;
    try {
      return await maintenance.resetDataDir((p) => send(win, 'maintenance:move-progress', p));
    } finally {
      reinstalling = false;
    }
  });

  ipcMain.handle('maintenance:reinstall', async (_e, groups) => {
    // Deleting the jars/JRE out from under a running game, or from under a
    // download that's mid-flight, is the one way this can do real damage.
    assertIdle('reinstalling');
    reinstalling = true;
    try {
      return await maintenance.reinstall(config.get('btaVersion'), groups || []);
    } finally {
      reinstalling = false;
    }
  });

  ipcMain.handle('game:launch', async (_e, profile) => {
    if (runningChild) throw new Error('The game is already running.');
    if (reinstalling) throw new Error('A reinstall is in progress.');
    // `runningChild` is only set once launch() resolves, which on a first run
    // is several minutes of downloading away. Take this flag synchronously,
    // before the first await, or a second Play starts a whole second install
    // pipeline alongside the first.
    if (preparing) throw new Error('The game is already starting.');
    preparing = true;

    let child;
    try {
      child = await launch({
        btaVersion: config.get('btaVersion'),
        profile,
        ramMb: config.get('ramMb'),
        report: (message) => send(win, 'game:status', { message }),
      });
    } finally {
      preparing = false;
    }
    runningChild = child;

    child.stdout.on('data', (chunk) => send(win, 'game:log', chunk.toString()));
    child.stderr.on('data', (chunk) => send(win, 'game:log', chunk.toString()));
    child.on('exit', (code) => {
      runningChild = null;
      send(win, 'game:exit', { code });
      if (gameExitHandler) gameExitHandler(code);
    });

    send(win, 'game:started', {});
    return true;
  });

  ipcMain.handle('game:is-running', () => Boolean(runningChild));
}

module.exports = { registerIpc, isGameRunning, onGameExit };
