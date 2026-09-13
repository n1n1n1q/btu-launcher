// "Reinstall" support: deletes the content the launcher downloaded so the next
// launch fetches it again from scratch. This is the escape hatch for a cache
// that has gone bad in a way verification can't repair on its own.
//
// Player data is never in scope. Worlds, screenshots, options.txt and the
// multiplayer server list all live directly in the instance's minecraft/ dir
// and are deliberately not reachable from any target below -- only the folders
// the modpack manifest already owns (see updater/modpack.js) are.
const fsp = require('node:fs/promises');
const path = require('node:path');
const paths = require('./paths');
const config = require('./config');
const { MANAGED_PREFIXES } = require('./updater/modpack');

/**
 * Removes the cache from its old home inside Chromium's userData/Cache folder
 * (see paths.cacheRoot). Anything left there is both unreachable and suspect,
 * since Chromium was free to rewrite it. Deletes only the subdirectories the
 * launcher itself created -- never Cache_Data, which is Chromium's.
 */
async function purgeLegacyCache() {
  let freed = 0;
  for (const name of paths.CACHE_SUBDIRS) {
    const dir = path.join(paths.legacyCacheRoot(), name);
    const size = await dirSize(dir);
    if (!size && !(await exists(dir))) continue;
    freed += size;
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return freed;
}

async function exists(p) {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * The delete targets, grouped the way they're offered in the UI. Every path is
 * a directory; missing ones are simply skipped.
 */
function targetsFor(btaVersion) {
  const gameDirPath = paths.gameDir(btaVersion);
  return {
    // Base game jar, BTA jarmod, merged jars, loader libraries, legacy assets,
    // cached meta, and the natives re-extracted from the libraries each launch.
    game: [paths.cacheRoot(), paths.nativesDir(btaVersion)],
    // The bundled Temurin JRE.
    runtime: [paths.javaDir()],
    // Exactly the folders the modpack manifest syncs -- nothing else.
    modpack: MANAGED_PREFIXES.map((prefix) =>
      path.join(gameDirPath, prefix.replace(/\/$/, ''))
    ),
  };
}

const GROUPS = ['game', 'runtime', 'modpack'];

async function dirSize(dirPath) {
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0; // absent directory contributes nothing
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else {
      try {
        total += (await fsp.stat(full)).size;
      } catch {
        /* vanished mid-walk; ignore */
      }
    }
  }
  return total;
}

async function groupSize(dirs) {
  let total = 0;
  for (const dir of dirs) total += await dirSize(dir);
  return total;
}

/** Bytes currently occupied by each group, for the UI to show before deleting. */
async function usage(btaVersion) {
  const targets = targetsFor(btaVersion);
  const result = {};
  for (const group of GROUPS) result[group] = await groupSize(targets[group]);
  return result;
}

/**
 * Deletes the selected groups. Returns how many bytes were freed so the UI can
 * report something concrete rather than a bare "done".
 */
async function reinstall(btaVersion, selected) {
  const groups = GROUPS.filter((g) => selected.includes(g));
  if (!groups.length) throw new Error('Nothing was selected to reinstall.');

  const targets = targetsFor(btaVersion);
  let freed = 0;
  for (const group of groups) {
    for (const dir of targets[group]) {
      // Measure before removing -- afterwards there's nothing left to stat.
      freed += await dirSize(dir);
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }
  return { freed, groups };
}

/** Where game content currently lives, and whether that's the default spot. */
function dataLocation() {
  const current = paths.root();
  return {
    path: current,
    isDefault: path.resolve(current) === path.resolve(paths.defaultRoot()),
    defaultPath: paths.defaultRoot(),
  };
}

const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** True when `child` is inside `parent` (or is `parent`). */
function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Copy rather than rename: the whole point is moving to another drive, where
// rename fails with EXDEV. Reports bytes as it goes so the UI can show real
// progress on what may be several hundred MB.
async function copyTree(src, dest, onBytes) {
  const entries = await fsp.readdir(src, { withFileTypes: true });
  await fsp.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to, onBytes);
    } else if (entry.isFile()) {
      await fsp.copyFile(from, to);
      const { size } = await fsp.stat(to);
      onBytes(size);
    }
    // Symlinks and other special entries aren't something the launcher creates.
  }
}

/**
 * Moves game content into `parentDir`/BTU Launcher. Copies everything first and
 * only deletes the originals once the copy is complete and verified by size --
 * an interrupted move must never be able to lose a player's worlds. Returns the
 * new data directory.
 */
async function moveDataDir(parentDir, onProgress) {
  return moveDataDirTo(path.join(parentDir, paths.DATA_DIR_NAME), onProgress);
}

/** Returns game content to the default location inside userData. */
async function resetDataDir(onProgress) {
  return moveDataDirTo(paths.defaultRoot(), onProgress);
}

async function moveDataDirTo(to, onProgress = () => {}) {
  const from = paths.root();

  if (samePath(from, to)) return { path: to, moved: 0, unchanged: true };
  if (isInside(to, from)) {
    throw new Error('Choose a folder outside the current installation folder.');
  }

  // Fail early and clearly if the destination isn't usable.
  await fsp.mkdir(to, { recursive: true });
  const probe = path.join(to, '.write-test');
  try {
    await fsp.writeFile(probe, 'ok');
    await fsp.unlink(probe);
  } catch (err) {
    throw new Error(`Cannot write to ${to}: ${err.message}`);
  }

  const sources = [];
  for (const name of paths.DATA_DIRS) {
    const dir = path.join(from, name);
    if (await exists(dir)) sources.push([name, dir, await dirSize(dir)]);
  }
  const total = sources.reduce((sum, [, , size]) => sum + size, 0);

  let copied = 0;
  for (const [name, dir] of sources) {
    onProgress({ phase: 'copy', name, copied, total });
    await copyTree(dir, path.join(to, name), (bytes) => {
      copied += bytes;
      onProgress({ phase: 'copy', name, copied, total });
    });
  }

  // Verify before deleting anything.
  for (const [name, , size] of sources) {
    const destSize = await dirSize(path.join(to, name));
    if (destSize !== size) {
      throw new Error(
        `Copy of "${name}" is incomplete (${destSize} of ${size} bytes); ` +
          'the original files have been left untouched.'
      );
    }
  }

  // Point at the new location before deleting the old one: if removal fails
  // partway (a locked file, say), the launcher still uses a complete copy.
  // Storing null for the default keeps the setting meaningful if the OS ever
  // reports a different userData path.
  config.set('dataDir', samePath(to, paths.defaultRoot()) ? null : to);

  onProgress({ phase: 'cleanup', copied: total, total });
  for (const [, dir] of sources) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  return { path: to, moved: total, unchanged: false };
}

module.exports = {
  usage,
  reinstall,
  purgeLegacyCache,
  dataLocation,
  moveDataDir,
  resetDataDir,
  GROUPS,
  targetsFor,
};
