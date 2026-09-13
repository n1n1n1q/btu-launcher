// Launcher self-update via electron-updater's "generic" provider: it just
// needs a directory on your VPS containing the electron-builder output
// (latest.yml + the installer) -- `npm run dist:win` produces exactly that
// layout under dist/. Point publish.url at it in electron-builder.yml.
const { autoUpdater } = require('electron-updater');

function initSelfUpdater(onStatus = () => {}) {
  autoUpdater.autoDownload = true;
  autoUpdater.on('checking-for-update', () => onStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => onStatus({ state: 'available', info }));
  autoUpdater.on('update-not-available', () => onStatus({ state: 'up-to-date' }));
  autoUpdater.on('download-progress', (progress) => onStatus({ state: 'downloading', progress }));
  autoUpdater.on('update-downloaded', () => onStatus({ state: 'ready' }));
  autoUpdater.on('error', (err) => onStatus({ state: 'error', error: err.message }));
  return autoUpdater;
}

module.exports = { initSelfUpdater, autoUpdater };
