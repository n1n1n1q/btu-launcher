// Persistent launcher settings (electron-store just writes JSON to userData).
// Everything here has a working default so a fresh install "just works"
// against placeholder values -- swap the TODOs before shipping.
const Store = require('electron-store');

const store = new Store({
  name: 'btu-launcher-config',
  defaults: {
    // Your Minecraft server. Shown as the default in the "Multiplayer" quick-join
    // and used nowhere auth-related (the server stays offline-mode, see docs/SETUP.md).
    serverAddress: 'play.example.com:25565', // TODO: point at your real server

    // Where the launcher checks for modpack content updates. Must serve the
    // manifest.json produced by tools/publish-update.js. See docs/SETUP.md.
    modpackUpdateUrl: 'https://updates.example.com/modpack/manifest.json', // TODO

    // Which published BTA base version (see src/main/launcher/versions.js) this
    // install targets. Bumping this is how you move everyone to a new BTA release.
    btaVersion: '8.0.1',

    // Azure AD application (client) ID used for the Microsoft login flow.
    // Free to create at portal.azure.com -- see docs/SETUP.md. Without a real
    // value here, Microsoft login will fail; offline login is unaffected.
    msaClientId: 'YOUR-AZURE-APP-CLIENT-ID', // TODO

    ramMb: 3072,
    javaPath: null, // null = auto-detect
    lastLoginMode: null, // 'microsoft' | 'offline'
    lastOfflineUsername: '',
    windowBounds: { width: 980, height: 640 },
  },
});

module.exports = store;
