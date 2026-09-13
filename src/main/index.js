const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const config = require('./config');
const { registerIpc } = require('./ipc');
const { initSelfUpdater } = require('./updater/selfUpdate');

let mainWindow = null;

function createWindow() {
  const bounds = config.get('windowBounds');
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: '#111318',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('resize', () => {
    const [width, height] = mainWindow.getSize();
    config.set('windowBounds', { width, height });
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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
