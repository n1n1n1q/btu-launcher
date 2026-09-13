// Persistent launcher settings (electron-store just writes JSON to userData).
// Everything here has a working default so a fresh install "just works"
// against placeholder values -- swap the TODOs before shipping.
const Store = require('electron-store');

const defaults = {
  // Your Minecraft server. Shown as the default in the "Multiplayer" quick-join
  // and used nowhere auth-related (the server stays offline-mode, see docs/SETUP.md).
  serverAddress: 'mc.ucucraft.fun:25565', // TODO: point at your real server

  // Where the launcher checks for modpack content updates. Must serve the
  // manifest.json produced by tools/publish-update.js. See docs/SETUP.md.
  modpackUpdateUrl: 'https://updates.ucucraft.fun/modpack/manifest.json', // TODO

  // Which published BTA base version (see src/main/launcher/versions.js) this
  // install targets. Bumping this is how you move everyone to a new BTA release.
  btaVersion: '8.0.1',

  // Azure AD application (client) ID used for the Microsoft login flow.
  // Free to create at portal.azure.com -- see docs/SETUP.md. Without a real
  // value here, Microsoft login will fail; offline login is unaffected.
  msaClientId: '33e5014a-41cd-4cd8-b9ae-3bd436d1a8f0', // TODO

  // UI language: 'en' | 'uk'.
  language: 'uk',

  // Where game content lives (content/, instances/, jre/). null = alongside the
  // launcher's own settings in userData. Point it at another drive to keep a
  // few hundred MB off the system disk -- see src/main/paths.js.
  dataDir: null,

  ramMb: 3072,
  javaPath: null, // null = auto-detect
  lastLoginMode: null, // 'microsoft' | 'offline'
  lastOfflineUsername: '',
  windowBounds: { width: 980, height: 640 },
};

const store = new Store({ name: 'btu-launcher-config', defaults });

// `defaults` is only written into the JSON for keys absent at creation time --
// it is NOT a read-time fallback, so changing a default here never reaches an
// install that already has the old value on disk. Anyone who ran a build
// carrying the original example.com placeholders keeps pointing at example.com
// forever (exactly how the modpack check ends up failing with ENOTFOUND).
// Rewrite those exact placeholder strings -- and only those, so a deliberately
// customized value is never clobbered -- to today's default.
const SHIPPED_PLACEHOLDERS = {
  serverAddress: ['play.example.com:25565'],
  modpackUpdateUrl: ['https://updates.example.com/modpack/manifest.json'],
  msaClientId: ['YOUR-AZURE-APP-CLIENT-ID'],
};

for (const [key, staleValues] of Object.entries(SHIPPED_PLACEHOLDERS)) {
  const current = store.get(key);
  // `undefined` also covers a key that was deleted rather than rewritten.
  if (current === undefined || staleValues.includes(current)) {
    store.set(key, defaults[key]);
  }
}

module.exports = store;
