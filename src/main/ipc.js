// All main<->renderer wiring lives here so index.js stays a thin bootstrap.
const { ipcMain } = require('electron');
const config = require('./config');
const offlineAuth = require('./auth/offline');
const msAuth = require('./auth/microsoft');
const { launch } = require('./launcher/gameLauncher');
const { fetchManifest, applyUpdate } = require('./updater/modpack');
const paths = require('./paths');

let runningChild = null;

function send(win, channel, payload) {
  if (win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function registerIpc(win) {
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

  ipcMain.handle('game:launch', async (_e, profile) => {
    if (runningChild) throw new Error('The game is already running.');

    const child = await launch({
      btaVersion: config.get('btaVersion'),
      profile,
      ramMb: config.get('ramMb'),
      report: (message) => send(win, 'game:status', { message }),
    });
    runningChild = child;

    child.stdout.on('data', (chunk) => send(win, 'game:log', chunk.toString()));
    child.stderr.on('data', (chunk) => send(win, 'game:log', chunk.toString()));
    child.on('exit', (code) => {
      runningChild = null;
      send(win, 'game:exit', { code });
    });

    send(win, 'game:started', {});
    return true;
  });

  ipcMain.handle('game:is-running', () => Boolean(runningChild));
}

module.exports = { registerIpc };
