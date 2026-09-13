// Tiny separate store for the Microsoft refresh token, kept apart from
// src/main/config.js so it's obvious this file holds a secret and not a
// setting (makes it easy to wipe on "log out" without touching prefs).
const Store = require('electron-store');

const secrets = new Store({
  name: 'btu-launcher-account',
  // electron-store's built-in "encryptionKey" is only light obfuscation (the
  // key ships in the app), not real secret storage -- it's here to keep the
  // refresh token out of a plaintext-obvious file, not to defeat a local
  // attacker. Good enough for a Minecraft refresh token; don't put anything
  // more sensitive in this store.
  encryptionKey: 'btu-launcher-local-obfuscation',
  defaults: { msaCache: null },
});

module.exports = {
  getCachedMsaToken: () => secrets.get('msaCache'),
  setCachedMsaToken: (token) => secrets.set('msaCache', token),
  clearCachedMsaToken: () => secrets.delete('msaCache'),
};
