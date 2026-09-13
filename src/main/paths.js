// Central place for every on-disk path the launcher touches.
// Keeping this in one module means the instance layout can change without
// hunting through every feature module.
const path = require('node:path');
const { app } = require('electron');

function root() {
  // %APPDATA%/BTU Launcher on Windows, ~/Library/Application Support/BTU Launcher on macOS.
  return app.getPath('userData');
}

function cacheRoot() {
  // Shared, content-addressed download cache (vanilla jar, BTA jar, loader libs,
  // assets). Shared across instances/versions so a re-download is never needed
  // just because a modpack update bumped some unrelated file.
  return path.join(root(), 'cache');
}

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
  cacheRoot,
  instanceRoot,
  gameDir,
  nativesDir,
  librariesDir,
  jarsDir,
  assetsObjectsDir,
  metaCacheDir,
  javaDir,
};
