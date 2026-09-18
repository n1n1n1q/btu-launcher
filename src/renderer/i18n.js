// UI strings. Static markup is translated via data-i18n* attributes in
// index.html; anything built at runtime goes through t().
//
// Adding a language: add a block here and an entry to LANGUAGES -- the toggle
// in the title bar is generated from it.
window.I18N = (() => {
  const LANGUAGES = [
    { code: 'en', label: 'EN' },
    { code: 'uk', label: 'UK' },
  ];

  const STRINGS = {
    en: {
      'win.minimize': 'Minimize',
      'win.maximize': 'Maximize',
      'win.close': 'Close',

      'account.title': 'Account',
      'account.microsoft': 'Microsoft',
      'account.offline': 'Offline',
      'account.msHint': 'Sign in with your Microsoft / Minecraft account.',
      'account.msButton': 'Sign in with Microsoft',
      'account.msSigningIn': 'Signing in...',
      'account.username': 'Username',
      'account.continue': 'Continue',
      'account.signedIn': 'Signed in',
      'account.switch': 'Switch account',
      'account.failed': 'Sign-in failed: {error}',

      'memory.title': 'Memory',
      'memory.hint': 'Allocated to the game.',
      'memory.gb': '{value} GB',

      'settings.title': 'Settings',
      'settings.close': 'Close settings',
      'settings.language': 'Language',

      'location.title': 'Installation folder',
      'location.change': 'Change...',
      'location.reset': 'Default',
      'location.default': 'Default location.',
      'location.custom': 'Custom location.',
      'location.moving': 'Moving files... {percent}%',
      'location.cleaning': 'Cleaning up the old folder...',
      'location.moved': 'Moved {size} to the new folder.',
      'location.unchanged': 'Already in that folder.',
      'location.failed': 'Could not move: {error}',

      'reinstall.title': 'Reinstall',
      'reinstall.hint':
        'Deletes downloaded files so the next launch fetches them again. Worlds, options and your server list are kept.',
      'reinstall.groupGame': 'Game files',
      'reinstall.groupRuntime': 'Java runtime',
      'reinstall.groupModpack': 'Modpack files',
      'reinstall.button': 'Reinstall selected',
      'reinstall.confirm': 'Delete {size} and download it again?',
      'reinstall.confirmYes': 'Delete',
      'reinstall.confirmNo': 'Cancel',
      'reinstall.working': 'Deleting...',
      'reinstall.done': 'Freed {size}. It will download again on the next launch.',
      'reinstall.failed': 'Reinstall failed: {error}',
      'reinstall.nothing': 'Select at least one item.',

      'meta.modpack': 'Modpack',
      'meta.bta': 'BTA',
      'meta.launcher': 'Launcher',

      'hero.eyebrow': 'Better than Adventure',
      'hero.sub': 'A survival Minecraft community where every season tells its own story.',
      'hero.notConfigured': 'not configured',

      'modpack.checking': 'Checking for modpack updates...',
      'modpack.ready': 'Modpack {version} ready ({count} files).',
      'modpack.updating': 'Updating modpack... {done}/{total} files',
      'modpack.cleaned': 'Cleaned up {count} removed file(s).',
      'modpack.upToDate': 'Modpack up to date.',
      'modpack.failed': 'Could not check for modpack updates — {error}',

      'updater.checking': 'Checking...',
      'updater.available': 'Downloading update',
      'updater.upToDate': 'Up to date',
      'updater.downloading': 'Updating {percent}%',
      'updater.ready': 'Restart to update',
      'updater.error': 'Update check failed',
      'updater.checkNow': 'Check for launcher updates',

      'play.signIn': 'Sign in to play',
      'play.play': 'Play',
      'play.preparing': 'Preparing',
      'play.running': 'Running',
      'play.launcherUpdating': 'Updating launcher',
      'play.failed': 'Failed to launch: {error}',
      'play.needsModpack': 'the modpack manifest could not be fetched. Check your connection and try again.',
      'play.checkMods': 'Check for mod updates',

      'game.running': 'Game running.',
      'game.closed': 'Game closed.',
      'game.exited': 'Game exited with code {code}.',

      'console.title': 'Console',
    },

    uk: {
      'win.minimize': 'Згорнути',
      'win.maximize': 'Розгорнути',
      'win.close': 'Закрити',

      'account.title': 'Обліковий запис',
      'account.microsoft': 'Microsoft',
      'account.offline': 'Офлайн',
      'account.msHint': 'Увійдіть через обліковий запис Microsoft / Minecraft.',
      'account.msButton': 'Увійти через Microsoft',
      'account.msSigningIn': 'Вхід...',
      'account.username': 'Ім’я користувача',
      'account.continue': 'Продовжити',
      'account.signedIn': 'Ви увійшли',
      'account.switch': 'Змінити акаунт',
      'account.failed': 'Не вдалося увійти: {error}',

      'memory.title': 'Пам’ять',
      'memory.hint': 'Виділено для гри.',
      'memory.gb': '{value} ГБ',

      'settings.title': 'Налаштування',
      'settings.close': 'Закрити налаштування',
      'settings.language': 'Мова',

      'location.title': 'Тека встановлення',
      'location.change': 'Змінити...',
      'location.reset': 'За умовчанням',
      'location.default': 'Стандартне розташування.',
      'location.custom': 'Власне розташування.',
      'location.moving': 'Перенесення файлів... {percent}%',
      'location.cleaning': 'Очищення старої теки...',
      'location.moved': 'Перенесено {size} до нової теки.',
      'location.unchanged': 'Файли вже в цій теці.',
      'location.failed': 'Не вдалося перенести: {error}',

      'reinstall.title': 'Перевстановлення',
      'reinstall.hint':
        'Видаляє завантажені файли, щоб наступний запуск отримав їх заново. Світи, налаштування та список серверів залишаються.',
      'reinstall.groupGame': 'Файли гри',
      'reinstall.groupRuntime': 'Середовище Java',
      'reinstall.groupModpack': 'Файли модпака',
      'reinstall.button': 'Перевстановити вибране',
      'reinstall.confirm': 'Видалити {size} і завантажити знову?',
      'reinstall.confirmYes': 'Видалити',
      'reinstall.confirmNo': 'Скасувати',
      'reinstall.working': 'Видалення...',
      'reinstall.done': 'Звільнено {size}. Файли завантажаться під час наступного запуску.',
      'reinstall.failed': 'Не вдалося перевстановити: {error}',
      'reinstall.nothing': 'Виберіть хоча б один пункт.',

      'meta.modpack': 'Модпак',
      'meta.bta': 'BTA',
      'meta.launcher': 'Лаунчер',

      'hero.eyebrow': 'Better than Adventure',
      'hero.sub': 'Спільнота виживання в Minecraft, де кожен сезон розповідає власну історію.',
      'hero.notConfigured': 'не налаштовано',

      'modpack.checking': 'Перевірка оновлень модпака...',
      'modpack.ready': 'Модпак {version} готовий ({count} файлів).',
      'modpack.updating': 'Оновлення модпака... {done}/{total} файлів',
      'modpack.cleaned': 'Видалено застарілих файлів: {count}.',
      'modpack.upToDate': 'Модпак актуальний.',
      'modpack.failed': 'Не вдалося перевірити оновлення модпака — {error}',

      'updater.checking': 'Перевірка...',
      'updater.available': 'Завантаження оновлення',
      'updater.upToDate': 'Актуальна версія',
      'updater.downloading': 'Оновлення {percent}%',
      'updater.ready': 'Перезапустіть для оновлення',
      'updater.error': 'Не вдалося перевірити оновлення',
      'updater.checkNow': 'Перевірити оновлення лаунчера',

      'play.signIn': 'Увійдіть, щоб грати',
      'play.play': 'Грати',
      'play.preparing': 'Підготовка',
      'play.running': 'Гра запущена',
      'play.launcherUpdating': 'Оновлення лаунчера',
      'play.failed': 'Не вдалося запустити: {error}',
      'play.needsModpack': 'не вдалося отримати маніфест модпака. Перевірте з’єднання та спробуйте ще раз.',
      'play.checkMods': 'Перевірити оновлення модів',

      'game.running': 'Гра запущена.',
      'game.closed': 'Гру закрито.',
      'game.exited': 'Гра завершилася з кодом {code}.',

      'console.title': 'Консоль',
    },
  };

  let current = 'en';

  function t(key, vars) {
    const table = STRINGS[current] || STRINGS.en;
    let text = table[key] ?? STRINGS.en[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  }

  // Re-translates every element carrying a data-i18n* attribute.
  function applyStatic(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const text = t(el.dataset.i18nTitle);
      el.title = text;
      el.setAttribute('aria-label', text);
    });
  }

  function setLanguage(code) {
    current = STRINGS[code] ? code : 'en';
    document.documentElement.lang = current;
    applyStatic();
    return current;
  }

  return { LANGUAGES, t, applyStatic, setLanguage, get current() { return current; } };
})();
