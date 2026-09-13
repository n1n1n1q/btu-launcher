(async () => {
  const $ = (id) => document.getElementById(id);
  const { t, setLanguage, LANGUAGES } = window.I18N;

  const state = {
    profile: null,
    manifest: null,
    running: false,
    preparing: false,
    reinstalling: false,
    serverAddress: '',
    usage: { game: 0, runtime: 0, modpack: 0 },
    location: null,
  };

  const RESET_GROUPS = ['game', 'runtime', 'modpack'];

  // Dynamic (runtime-generated) strings are kept as {key, vars} so they can be
  // re-rendered when the language changes, instead of being frozen as text.
  const messages = {
    modpack: { key: 'modpack.checking', vars: {}, kind: 'busy' },
    launch: null,
    updater: null,
    reinstall: null,
    location: null,
  };

  // IPC rejections arrive as "Error invoking remote method 'x': TypeError: ..."
  // -- strip that wrapper so the UI shows the actual cause.
  function cleanError(err) {
    return String((err && err.message) || err)
      .replace(/^Error invoking remote method '[^']*':\s*/, '')
      .replace(/^(TypeError|Error):\s*/, '');
  }

  // ---- Console -------------------------------------------------------------
  // Game logs can run to tens of thousands of lines; keep a bounded buffer so a
  // long session can't grow the DOM node without limit.
  const MAX_LOG_LINES = 2000;
  const logLines = [];

  function log(chunk) {
    for (const line of String(chunk).split('\n')) {
      if (line.trim() === '') continue;
      logLines.push(line);
    }
    if (logLines.length > MAX_LOG_LINES) logLines.splice(0, logLines.length - MAX_LOG_LINES);

    const el = $('log');
    const pinned = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    el.textContent = logLines.join('\n');
    $('log-count').textContent = logLines.length;
    if (pinned) el.scrollTop = el.scrollHeight;
  }

  $('log-toggle').addEventListener('click', () => {
    const open = $('console').classList.toggle('open');
    $('log').classList.toggle('hidden', !open);
    $('log-toggle').setAttribute('aria-expanded', String(open));
    if (open) $('log').scrollTop = $('log').scrollHeight;
  });

  // ---- Settings dialog -----------------------------------------------------
  function setSettingsOpen(open) {
    $('settings').classList.toggle('hidden', !open);
    $('settings-backdrop').classList.toggle('hidden', !open);
    $('settings-btn').setAttribute('aria-expanded', String(open));
    if (open) {
      // Sizes go stale while the dialog is closed (a launch downloads files),
      // so refresh on open rather than polling.
      refreshUsage();
      refreshLocation();
      $('settings-close').focus();
    } else {
      $('settings-btn').focus();
    }
  }

  $('settings-btn').addEventListener('click', () => setSettingsOpen(true));
  $('settings-close').addEventListener('click', () => setSettingsOpen(false));
  $('settings-backdrop').addEventListener('click', () => setSettingsOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('settings').classList.contains('hidden')) setSettingsOpen(false);
  });

  // ---- Window controls -----------------------------------------------------
  if (window.btu.platform === 'darwin') document.body.classList.add('is-mac');

  $('win-min').addEventListener('click', () => window.btu.win.minimize());
  $('win-max').addEventListener('click', () => window.btu.win.toggleMaximize());
  $('win-close').addEventListener('click', () => window.btu.win.close());

  // ---- Rendering -----------------------------------------------------------
  const formatRam = (mb) =>
    t('memory.gb', { value: mb % 1024 === 0 ? mb / 1024 : (mb / 1024).toFixed(1) });

  // Intl gives us the localized unit ("1.2 GB" / "1,2 ГБ") without another
  // string table entry per unit.
  function formatBytes(bytes) {
    const [value, unit] =
      bytes >= 1024 ** 3 ? [bytes / 1024 ** 3, 'gigabyte'] : [bytes / 1024 ** 2, 'megabyte'];
    return new Intl.NumberFormat(window.I18N.current, {
      style: 'unit',
      unit,
      unitDisplay: 'short',
      maximumFractionDigits: value < 10 ? 1 : 0,
    }).format(value);
  }

  const selectedGroups = () =>
    [...document.querySelectorAll('#reinstall-card input[type="checkbox"]')]
      .filter((cb) => cb.checked)
      .map((cb) => cb.dataset.group);

  const selectedBytes = () =>
    selectedGroups().reduce((sum, group) => sum + (state.usage[group] || 0), 0);

  function renderDynamic() {
    const m = messages.modpack;
    $('modpack-status').textContent = m ? t(m.key, m.vars) : '';
    $('modpack-status-row').className = `status-strip${m && m.kind ? ` ${m.kind}` : ''}`;

    $('launch-status').textContent = messages.launch
      ? t(messages.launch.key, messages.launch.vars)
      : '';

    $('updater-status').textContent = messages.updater
      ? t(messages.updater.key, messages.updater.vars)
      : '-';

    $('ram-value').textContent = formatRam(Number($('ram-range').value));

    const btn = $('play-btn');
    if (state.running) {
      btn.disabled = true;
      $('play-label').textContent = t('play.running');
    } else if (state.preparing) {
      btn.disabled = true;
      $('play-label').textContent = t('play.preparing');
    } else {
      btn.disabled = !state.profile;
      $('play-label').textContent = t(state.profile ? 'play.play' : 'play.signIn');
    }

    if (state.profile) {
      $('profile-badge').textContent = state.profile.mode === 'microsoft'
        ? t('account.microsoft').toUpperCase()
        : t('account.offline').toUpperCase();
    }

    const address = (state.serverAddress || '').replace(/:25565$/, '');
    $('server-address').textContent = address || t('hero.notConfigured');

    // ---- Reinstall card ----
    for (const group of RESET_GROUPS) {
      $(`size-${group}`).textContent = formatBytes(state.usage[group] || 0);
    }
    $('reinstall-confirm-text').textContent = t('reinstall.confirm', {
      size: formatBytes(selectedBytes()),
    });
    $('reinstall-btn').disabled = state.running || state.preparing || state.reinstalling;
    $('reinstall-yes').disabled = state.reinstalling;

    const r = messages.reinstall;
    $('reinstall-result').textContent = r ? t(r.key, r.vars) : '';
    $('reinstall-result').classList.toggle('hidden', !r);
    $('reinstall-result').classList.toggle('error', Boolean(r && r.isError));

    // ---- Installation folder ----
    if (state.location) {
      $('data-dir').textContent = state.location.path;
      $('data-dir').title = state.location.path;
      $('reset-dir-btn').classList.toggle('hidden', state.location.isDefault);
    }
    const l = messages.location;
    $('location-status').textContent = l
      ? t(l.key, l.vars)
      : state.location
        ? t(state.location.isDefault ? 'location.default' : 'location.custom')
        : '';
    $('location-status').classList.toggle('error', Boolean(l && l.isError));
    $('change-dir-btn').disabled = state.running || state.preparing || state.reinstalling;
    $('reset-dir-btn').disabled = $('change-dir-btn').disabled;
  }

  const setModpack = (key, vars = {}, kind = '') => {
    messages.modpack = { key, vars, kind };
    renderDynamic();
  };
  const setLaunch = (key, vars = {}) => {
    messages.launch = key ? { key, vars } : null;
    renderDynamic();
  };

  // ---- Progress ------------------------------------------------------------
  function setProgress(done, total) {
    const el = $('progress');
    el.classList.remove('hidden', 'indeterminate');
    $('progress-bar').style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  }

  function setProgressIndeterminate() {
    const el = $('progress');
    el.classList.remove('hidden');
    el.classList.add('indeterminate');
    $('progress-bar').style.width = '';
  }

  function clearProgress() {
    $('progress').classList.add('hidden');
    $('progress').classList.remove('indeterminate');
    $('progress-bar').style.width = '0%';
  }

  function showProfile(profile) {
    state.profile = profile;
    $('login-card').classList.add('hidden');
    $('profile-card').classList.remove('hidden');
    $('profile-name').textContent = profile.username;
    $('profile-avatar').textContent = (profile.username || '?').charAt(0).toUpperCase();
    $('profile-badge').classList.toggle('offline', profile.mode !== 'microsoft');
    renderDynamic();
  }

  // ---- Tabs ----------------------------------------------------------------
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $('tab-microsoft').classList.toggle('hidden', btn.dataset.tab !== 'microsoft');
      $('tab-offline').classList.toggle('hidden', btn.dataset.tab !== 'offline');
    });
  });

  // ---- Config --------------------------------------------------------------
  const config = await window.btu.config.getAll();

  // ---- Language ------------------------------------------------------------
  const langSwitch = $('lang-switch');
  for (const { code, label } of LANGUAGES) {
    const btn = document.createElement('button');
    btn.className = 'lang-btn';
    btn.dataset.lang = code;
    btn.textContent = label;
    btn.addEventListener('click', () => applyLanguage(code, true));
    langSwitch.appendChild(btn);
  }

  function applyLanguage(code, persist) {
    const active = setLanguage(code); // re-translates all data-i18n markup
    langSwitch.querySelectorAll('.lang-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.lang === active);
    });
    // Placeholder is a proper name, not a translated string.
    $('offline-username').placeholder = 'Steve';
    renderDynamic();
    if (persist) window.btu.config.set('language', active);
  }

  applyLanguage(config.language || 'en', false);

  // ---- Settings ------------------------------------------------------------
  const RAM_MIN = 1024;
  const RAM_MAX = 16384;
  const ram = $('ram-range');
  ram.value = Math.min(RAM_MAX, Math.max(RAM_MIN, Number(config.ramMb) || 3072));
  ram.addEventListener('input', renderDynamic);
  ram.addEventListener('change', () => window.btu.config.set('ramMb', Number(ram.value)));

  $('offline-username').value = config.lastOfflineUsername || '';
  $('bta-version').textContent = config.btaVersion || '-';
  state.serverAddress = config.serverAddress || '';
  renderDynamic();

  // ---- Auth ----------------------------------------------------------------
  $('ms-login-btn').addEventListener('click', async () => {
    const btn = $('ms-login-btn');
    btn.disabled = true;
    btn.textContent = t('account.msSigningIn');
    try {
      showProfile(await window.btu.auth.microsoftLogin());
      setLaunch(null);
    } catch (err) {
      log(`[auth] ${cleanError(err)}`);
      setLaunch('account.failed', { error: cleanError(err) });
    } finally {
      btn.disabled = false;
      btn.textContent = t('account.msButton');
    }
  });

  $('offline-login-btn').addEventListener('click', async () => {
    const username = $('offline-username').value.trim();
    try {
      showProfile(await window.btu.auth.offlineLogin(username));
      setLaunch(null);
    } catch (err) {
      log(`[auth] ${cleanError(err)}`);
      setLaunch('account.failed', { error: cleanError(err) });
    }
  });

  $('offline-username').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('offline-login-btn').click();
  });

  $('switch-account-btn').addEventListener('click', () => {
    state.profile = null;
    $('profile-card').classList.add('hidden');
    $('login-card').classList.remove('hidden');
    setLaunch(null);
  });

  // Try a silent Microsoft re-login if we have a cached account.
  if (config.lastLoginMode === 'microsoft') {
    try {
      const profile = await window.btu.auth.microsoftTryRefresh();
      if (profile) showProfile(profile);
    } catch {
      /* fall through to manual login */
    }
  } else if (config.lastLoginMode === 'offline') {
    document.querySelector('.tab-btn[data-tab="offline"]').click();
  }

  // ---- Launcher self-update ------------------------------------------------
  window.btu.updater.onStatus((s) => {
    const key = {
      checking: 'updater.checking',
      available: 'updater.available',
      'up-to-date': 'updater.upToDate',
      downloading: 'updater.downloading',
      ready: 'updater.ready',
      error: 'updater.error',
    }[s.state];
    if (!key) return;
    messages.updater = {
      key,
      vars: { percent: s.progress ? Math.round(s.progress.percent) : 0 },
    };
    renderDynamic();
  });

  // ---- Modpack -------------------------------------------------------------
  async function checkModpack() {
    setModpack('modpack.checking', {}, 'busy');
    try {
      const manifest = await window.btu.modpack.checkUpdate();
      state.manifest = manifest;
      $('modpack-version').textContent = manifest.version;
      setModpack('modpack.ready', { version: manifest.version, count: manifest.files.length }, 'ok');
    } catch (err) {
      setModpack('modpack.failed', { error: cleanError(err) }, 'error');
    }
  }

  window.btu.modpack.onProgress((p) => {
    if (p.phase === 'download') {
      setModpack('modpack.updating', { done: p.done, total: p.total }, 'busy');
      setProgress(p.done, p.total);
    } else if (p.removed) {
      setModpack('modpack.cleaned', { count: p.removed }, 'ok');
    } else {
      setModpack('modpack.upToDate', {}, 'ok');
    }
  });

  checkModpack();

  // ---- Reinstall -----------------------------------------------------------
  async function refreshUsage() {
    try {
      state.usage = await window.btu.maintenance.usage();
    } catch (err) {
      log(`[reinstall] ${cleanError(err)}`);
    }
    renderDynamic();
  }

  const showConfirm = (show) => {
    $('reinstall-confirm').classList.toggle('hidden', !show);
    $('reinstall-btn').classList.toggle('hidden', show);
  };

  document.querySelectorAll('#reinstall-card input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', renderDynamic);
  });

  $('reinstall-btn').addEventListener('click', () => {
    if (!selectedGroups().length) {
      messages.reinstall = { key: 'reinstall.nothing', vars: {}, isError: true };
      renderDynamic();
      return;
    }
    messages.reinstall = null;
    renderDynamic();
    showConfirm(true);
  });

  $('reinstall-no').addEventListener('click', () => showConfirm(false));

  $('reinstall-yes').addEventListener('click', async () => {
    const groups = selectedGroups();
    state.reinstalling = true;
    messages.reinstall = { key: 'reinstall.working', vars: {} };
    renderDynamic();
    try {
      const { freed } = await window.btu.maintenance.reinstall(groups);
      messages.reinstall = { key: 'reinstall.done', vars: { size: formatBytes(freed) } };
      log(`[reinstall] removed ${groups.join(', ')} (${formatBytes(freed)})`);
    } catch (err) {
      messages.reinstall = { key: 'reinstall.failed', vars: { error: cleanError(err) }, isError: true };
      log(`[reinstall] ${cleanError(err)}`);
    } finally {
      state.reinstalling = false;
      showConfirm(false);
      await refreshUsage(); // also re-renders
    }
    // The manifest is still valid, but the files it describes may be gone --
    // re-check so the status strip reflects what's actually on disk now.
    checkModpack();
  });

  refreshUsage();

  // ---- Installation folder -------------------------------------------------
  async function refreshLocation() {
    try {
      state.location = await window.btu.maintenance.dataLocation();
    } catch (err) {
      log(`[location] ${cleanError(err)}`);
    }
    renderDynamic();
  }

  window.btu.maintenance.onMoveProgress((p) => {
    if (p.phase === 'cleanup') {
      messages.location = { key: 'location.cleaning', vars: {} };
    } else {
      messages.location = {
        key: 'location.moving',
        vars: { percent: p.total ? Math.floor((p.copied / p.total) * 100) : 0 },
      };
    }
    renderDynamic();
  });

  // Both buttons run the same move; they differ only in where it lands.
  async function relocate(run) {
    state.reinstalling = true;
    messages.location = { key: 'location.moving', vars: { percent: 0 } };
    renderDynamic();
    try {
      const result = await run();
      messages.location = result.unchanged
        ? { key: 'location.unchanged', vars: {} }
        : { key: 'location.moved', vars: { size: formatBytes(result.moved) } };
      log(`[location] now at ${result.path}`);
    } catch (err) {
      messages.location = { key: 'location.failed', vars: { error: cleanError(err) }, isError: true };
      log(`[location] ${cleanError(err)}`);
    } finally {
      state.reinstalling = false;
      await refreshLocation();
      await refreshUsage();
    }
  }

  $('change-dir-btn').addEventListener('click', async () => {
    const parentDir = await window.btu.maintenance.chooseDataDir();
    if (!parentDir) return; // dialog cancelled
    await relocate(() => window.btu.maintenance.moveDataDir(parentDir));
  });

  $('reset-dir-btn').addEventListener('click', () =>
    relocate(() => window.btu.maintenance.resetDataDir())
  );

  refreshLocation();

  // ---- Game events ---------------------------------------------------------
  window.btu.game.onStatus((p) => {
    // Main-process progress text isn't translated -- show it verbatim.
    $('launch-status').textContent = p.message;
    messages.launch = null;
    if ($('progress').classList.contains('hidden')) setProgressIndeterminate();
  });
  window.btu.game.onLog((line) => log(line));
  window.btu.game.onStarted(() => {
    state.preparing = false;
    state.running = true;
    clearProgress();
    setLaunch('game.running');
    refreshUsage(); // a first launch just pulled down a lot of files
  });
  window.btu.game.onExit(({ code }) => {
    state.running = false;
    state.preparing = false;
    clearProgress();
    setLaunch(code === 0 ? 'game.closed' : 'game.exited', { code });
  });

  // ---- Play ----------------------------------------------------------------
  $('play-btn').addEventListener('click', async () => {
    if (!state.profile || state.running || state.preparing) return;
    state.preparing = true;
    renderDynamic();
    setProgressIndeterminate();
    try {
      if (state.manifest) await window.btu.modpack.applyUpdate(state.manifest);
      await window.btu.game.launch(state.profile);
    } catch (err) {
      log(`[launch] ${cleanError(err)}`);
      setLaunch('play.failed', { error: cleanError(err) });
      clearProgress();
      state.preparing = false;
      state.running = false;
      renderDynamic();
    }
  });
})();
