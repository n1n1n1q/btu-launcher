(async () => {
  const $ = (id) => document.getElementById(id);

  const state = {
    profile: null,
    manifest: null,
  };

  function log(line) {
    const el = $('log');
    el.textContent += line.endsWith('\n') ? line : `${line}\n`;
    el.scrollTop = el.scrollHeight;
  }

  function setLaunchStatus(text) {
    $('launch-status').textContent = text;
  }

  function refreshPlayButton() {
    $('play-btn').disabled = !state.profile;
    $('play-btn').textContent = state.profile ? 'Play' : 'Sign in to play';
  }

  function showProfile(profile) {
    state.profile = profile;
    $('profile-card').classList.remove('hidden');
    $('profile-name').textContent = profile.username;
    const badge = $('profile-badge');
    badge.textContent = profile.mode === 'microsoft' ? 'MICROSOFT' : 'OFFLINE';
    badge.classList.toggle('offline', profile.mode !== 'microsoft');
    refreshPlayButton();
  }

  // ---- Tabs ----
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $('tab-microsoft').classList.toggle('hidden', btn.dataset.tab !== 'microsoft');
      $('tab-offline').classList.toggle('hidden', btn.dataset.tab !== 'offline');
    });
  });

  // ---- Auth ----
  $('ms-login-btn').addEventListener('click', async () => {
    $('ms-login-btn').disabled = true;
    $('ms-login-btn').textContent = 'Signing in...';
    try {
      const profile = await window.btu.auth.microsoftLogin();
      showProfile(profile);
    } catch (err) {
      log(`[auth] ${err.message || err}`);
    } finally {
      $('ms-login-btn').disabled = false;
      $('ms-login-btn').textContent = 'Sign in with Microsoft';
    }
  });

  $('offline-login-btn').addEventListener('click', async () => {
    const username = $('offline-username').value.trim();
    try {
      const profile = await window.btu.auth.offlineLogin(username);
      showProfile(profile);
    } catch (err) {
      log(`[auth] ${err.message || err}`);
    }
  });

  $('switch-account-btn').addEventListener('click', () => {
    state.profile = null;
    $('profile-card').classList.add('hidden');
    refreshPlayButton();
  });

  // ---- Settings ----
  const config = await window.btu.config.getAll();
  $('ram-input').value = config.ramMb;
  $('ram-input').addEventListener('change', (e) => {
    const value = Number(e.target.value) || 3072;
    window.btu.config.set('ramMb', value);
  });
  $('offline-username').value = config.lastOfflineUsername || '';

  // Try a silent Microsoft re-login if we have a cached account.
  if (config.lastLoginMode === 'microsoft') {
    try {
      const profile = await window.btu.auth.microsoftTryRefresh();
      if (profile) showProfile(profile);
    } catch {
      /* fall through to manual login */
    }
  }

  // ---- Modpack update check ----
  async function checkModpack() {
    try {
      const manifest = await window.btu.modpack.checkUpdate();
      state.manifest = manifest;
      $('modpack-status').textContent = `Modpack ${manifest.version} available.`;
    } catch (err) {
      $('modpack-status').textContent = `Could not check for modpack updates: ${err.message || err}`;
    }
  }
  window.btu.modpack.onProgress((p) => {
    if (p.phase === 'download') {
      $('modpack-status').textContent = `Updating modpack... ${p.done}/${p.total} files`;
    } else {
      $('modpack-status').textContent = `Cleaned up ${p.removed} removed file(s).`;
    }
  });
  checkModpack();

  // ---- Game events ----
  window.btu.game.onStatus((p) => setLaunchStatus(p.message));
  window.btu.game.onLog((line) => log(line));
  window.btu.game.onStarted(() => {
    setLaunchStatus('Game running.');
    $('play-btn').textContent = 'Running...';
  });
  window.btu.game.onExit(({ code }) => {
    setLaunchStatus(code === 0 ? 'Game closed.' : `Game exited with code ${code}.`);
    refreshPlayButton();
  });

  // ---- Play ----
  $('play-btn').addEventListener('click', async () => {
    if (!state.profile) return;
    $('play-btn').disabled = true;
    $('play-btn').textContent = 'Preparing...';
    $('log').textContent = '';
    try {
      if (state.manifest) {
        await window.btu.modpack.applyUpdate(state.manifest);
      }
      await window.btu.game.launch(state.profile);
    } catch (err) {
      setLaunchStatus(`Failed to launch: ${err.message || err}`);
      $('play-btn').disabled = false;
      $('play-btn').textContent = 'Play';
    }
  });
})();
