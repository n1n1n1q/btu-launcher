// Central place for every on-disk path the launcher touches.
// Keeping this in one module means the instance layout can change without
// hunting through every feature module.
const path = require('node:path');
const { app } = require('electron');
const config = require('./config');

function defaultRoot() {
  // %APPDATA%/BTU Launcher on Windows, ~/Library/Application Support/BTU Launcher on macOS.
  return app.getPath('userData');
}

function root() {
  // Game content can be relocated to another drive. The launcher's own settings
  // always stay in userData -- electron-store puts them there, and they're what
  // records this choice, so they can't live at the end of the pointer.
  return config.get('dataDir') || defaultRoot();
}

// The top-level directories under root() that hold game content, and therefore
// the exact set that moves when the install folder changes. Everything else in
// userData (settings, Chromium's own state) stays where it is.
const DATA_DIRS = ['content', 'instances', 'jre'];

// Name of the folder created inside whatever directory the player picks, so
// choosing something broad like D:\ or D:\Games never scatters our files
// through a directory they share with other things.
const DATA_DIR_NAME = 'BTU Launcher';

function cacheRoot() {
  // Shared, content-addressed download cache (vanilla jar, BTA jar, loader libs,
  // assets). Shared across instances/versions so a re-download is never needed
  // just because a modpack update bumped some unrelated file.
  //
  // Deliberately NOT "cache": userData/Cache is Chromium's own HTTP cache, and
  // on Windows/macOS (case-insensitive filesystems) userData/cache is the very
  // same directory. Chromium owns that folder -- it evicts, truncates and
  // clears it whenever it likes -- so game files stored there got silently
  // mangled, which surfaced as unzip errors like "invalid block type" and
  // "unexpected end of file" on perfectly good downloads.
  return path.join(root(), 'content');
}

// Where the cache used to live, inside Chromium's directory. Only still
// referenced so the stale (and possibly corrupt) contents can be cleaned up.
// Always the default root: Chromium's directory never moves.
function legacyCacheRoot() {
  return path.join(defaultRoot(), 'cache');
}

// The subdirectories the launcher creates under its cache root. Named
// explicitly because the legacy location is shared with Chromium's own
// Cache_Data, which must never be touched.
const CACHE_SUBDIRS = ['downloads', 'jars', 'libraries', 'assets', 'meta'];

function instanceRoot(btaVersion) {
  return path.join(root(), 'instances', btaVersion);
}

function gameDir(btaVersion) {
  // This is what gets passed to the game as --gameDir. Mods/config/resourcepacks
  // live directly inside it, matching a normal Prism/MultiMC instance layout.
  return path.join(instanceRoot(btaVersion), 'minecraft');
}

function nativesDir(btaVersion) {
  return path.join(instanceRoot(btaVersion), 'natives');
}

function librariesDir() {
  return path.join(cacheRoot(), 'libraries');
}

function jarsDir() {
  return path.join(cacheRoot(), 'jars');
}

function assetsObjectsDir() {
  return path.join(cacheRoot(), 'assets', 'objects');
}

function metaCacheDir() {
  return path.join(cacheRoot(), 'meta');
}

function javaDir() {
  return path.join(root(), 'jre');
}

module.exports = {
  root,
  defaultRoot,
  DATA_DIRS,
  DATA_DIR_NAME,
  cacheRoot,
  legacyCacheRoot,
  CACHE_SUBDIRS,
  instanceRoot,
  gameDir,
  nativesDir,
  librariesDir,
  jarsDir,
  assetsObjectsDir,
  metaCacheDir,
  javaDir,
};
