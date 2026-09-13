// "Cracked" / offline login. No network contact with Mojang at all -- this
// only works because the BTU server runs with online-mode=false, so it trusts
// whatever username the client claims (exactly like vanilla offline mode).
const crypto = require('node:crypto');

const VALID_USERNAME = /^[A-Za-z0-9_]{3,16}$/;

/**
 * Mirrors vanilla's offline UUID scheme: an MD5 hash of "OfflinePlayer:<name>",
 * then coerced into a version-3 UUID. Deterministic so the same username
 * always maps to the same UUID (matters for per-player data on the server).
 */
function offlineUuid(username) {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30; // version 3
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant 10
  const hex = hash.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function login(username) {
  if (!VALID_USERNAME.test(username)) {
    throw new Error(
      'Username must be 3-16 characters, letters/numbers/underscore only (same rule vanilla enforces).'
    );
  }
  return {
    mode: 'offline',
    username,
    uuid: offlineUuid(username),
    // Old (pre-1.6) launch protocol just wants *some* session string; the
    // server never validates it in offline-mode, so this is a fixed placeholder.
    session: '-',
  };
}

module.exports = { login, offlineUuid, VALID_USERNAME };
