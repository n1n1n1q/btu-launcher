const path = require('node:path');
const { app, BrowserWindow, Menu } = require('electron');
const config = require('./config');
const { registerIpc, isGameRunning, onGameExit } = require('./ipc');
const maintenance = require('./maintenance');
const { initSelfUpdater } = require('./updater/selfUpdate');

let mainWindow = null;
// Set once the app is genuinely on its way out, so the close handler below
// stops intercepting.
let quitting = false;

const isMac = process.platform === 'darwin';

function createWindow() {
  const bounds = config.get('windowBounds');
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#10120c',
    icon: path.join(__dirname, '..', '..', 'resources', 'icon.png'),
    // The launcher draws its own title bar (src/renderer) -- no File/Edit/View
    // chrome. On macOS we keep the native traffic lights and just hide the bar,
    // since a fully frameless window there loses the standard close/zoom affordances.
    frame: false,
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('resize', () => {
    // Don't persist maximized/snapped dimensions as the restore size.
    if (mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
    const [width, height] = mainWindow.getSize();
    config.set('windowBounds', { width, height });
  });

  for (const event of ['maximize', 'unmaximize']) {
    mainWindow.on(event, () => {
      if (mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized());
    });
  }

  // Closing the launcher must not take a running game down with it. Rather than
  // fight Windows over whether a spawned process outlives its parent (it
  // doesn't, reliably -- job objects and broken stdio pipes both get a vote),
  // the window just goes away and the process stays alive until the game ends.
  mainWindow.on('close', (event) => {
    if (quitting || !isGameRunning()) return;
    event.preventDefault();
    mainWindow.hide();
  });

  onGameExit(() => {
    // The window was closed while the game ran, so nothing is left to show.
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      quitting = true;
      app.quit();
    }
  });

  registerIpc(mainWindow);

  const updater = initSelfUpdater((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:status', status);
    }
  });
  if (app.isPackaged) {
    updater.checkForUpdates().catch(() => {
      // Non-fatal: launcher just keeps running on its current version.
    });
  }
}

// An explicit quit (Cmd+Q, an updater restart, the task bar) must not be
// swallowed by the close handler above.
app.on('before-quit', () => {
  quitting = true;
});

// While a game is running the window can be hidden rather than closed, and a
// hidden window is easy to forget. Re-running the launcher then has to reveal
// that instance instead of starting a second one alongside it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  // Drops the default File/Edit/View/Window/Help menu (and the Alt-key menu
  // bar on Windows/Linux). macOS keeps its application menu so the standard
  // Cmd+Q / Cmd+C shortcuts still work.
  if (!isMac) Menu.setApplicationMenu(null);

  // The cache used to live inside Chromium's own userData/Cache directory,
  // where it was liable to be rewritten underneath us. Reclaim that space once;
  // the files are re-downloaded on demand and verified, so losing them is safe.
  maintenance.purgeLegacyCache().catch(() => {
    // Best effort -- never block startup on housekeeping.
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  // A hidden window still counts as open, so clicking the dock icon has to
  // bring it back rather than fall through to doing nothing.
  else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
});
