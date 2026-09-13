// Real Microsoft account login (MSA -> Xbox Live -> XSTS -> Minecraft profile)
// using msmc, which drives the whole chain and pops its own Electron auth
// window. Requires config.msaClientId to be a real Azure AD app registration
// -- see docs/SETUP.md. This never talks to the BTU server; it only proves
// who the player *claims* to be (the server stays offline-mode, per the
// project decision recorded in docs/SETUP.md).
const { Auth } = require('msmc');
const config = require('../config');
const accountStore = require('./store');

function buildAuthManager() {
  const clientId = config.get('msaClientId');
  if (!clientId || clientId.startsWith('YOUR-')) {
    throw new Error(
      'Microsoft login is not configured yet: set msaClientId in config.js to a real Azure app registration (docs/SETUP.md).'
    );
  }
  // "select_account" always shows the account picker instead of silently
  // reusing whatever Microsoft session is active in the popup's cookie jar --
  // avoids surprise logins on shared PCs.
  return new Auth('select_account');
}

function toProfile(token) {
  const mclc = token.mclc();
  return {
    mode: 'microsoft',
    username: mclc.name,
    uuid: mclc.uuid,
    accessToken: mclc.access_token,
    // Old (pre-1.6) launch protocol session string. The server doesn't
    // validate this today, but it's a real token in case that ever changes.
    session: `token:${mclc.access_token}:${mclc.uuid}`,
  };
}

/** Interactive login: opens the Microsoft sign-in window. */
async function login() {
  const authManager = buildAuthManager();
  const xboxManager = await authManager.launch('electron');
  const token = await xboxManager.getMinecraft();
  if (!token.profile) {
    throw new Error('This Microsoft account does not own Minecraft: Java Edition.');
  }
  accountStore.setCachedMsaToken(xboxManager.save());
  return toProfile(token);
}

/** Silent re-login using the last saved refresh token, if any. Returns null if none/expired-past-refresh. */
async function tryRefresh() {
  const cached = accountStore.getCachedMsaToken();
  if (!cached) return null;
  try {
    const authManager = buildAuthManager();
    const xboxManager = await authManager.refresh(cached);
    const token = await xboxManager.getMinecraft();
    if (!token.profile) return null;
    accountStore.setCachedMsaToken(xboxManager.save());
    return toProfile(token);
  } catch {
    accountStore.clearCachedMsaToken();
    return null;
  }
}

function logout() {
  accountStore.clearCachedMsaToken();
}

module.exports = { login, tryRefresh, logout };
