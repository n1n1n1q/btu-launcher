// Applies your published modpack manifest to a local instance: downloads
// anything new/changed, deletes anything the manifest explicitly removed, and
// fully syncs the "managed" folders (deletes local files under them that
// aren't in the manifest at all -- e.g. a mod you pulled from the pack).
// Folders NOT in MANAGED_PREFIXES (saves, screenshots, options.txt, the
// server list, shaderpacks/texturepacks the player added themselves) are
// never touched. See tools/publish-update.js for how a manifest is produced.
const fsp = require('node:fs/promises');
const path = require('node:path');
const { ensureFile, fetchJson, fileMatches, pool } = require('../launcher/downloader');

const MANAGED_PREFIXES = ['mods/', 'config/', 'coremods/', 'datapacks/', 'discpack/', 'resourcepacks/'];

function isManaged(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  return MANAGED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

async function listLocalManagedFiles(gameDirPath) {
  const results = [];
  async function walk(dir, relBase) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else results.push(rel);
    }
  }
  for (const prefix of MANAGED_PREFIXES) {
    await walk(path.join(gameDirPath, prefix), prefix.replace(/\/$/, ''));
  }
  return results;
}

async function fetchManifest(manifestUrl) {
  return fetchJson(manifestUrl);
}

/**
 * Returns a plan without changing anything on disk -- useful for showing the
 * user "downloading 4 files, removing 1" before committing to it.
 */
async function planUpdate(manifest, gameDirPath) {
  const toDownload = [];
  for (const file of manifest.files) {
    const dest = path.join(gameDirPath, ...file.path.split('/'));
    if (!(await fileMatches(dest, file.sha1, file.size))) toDownload.push(file);
  }

  const manifestPaths = new Set(manifest.files.map((f) => f.path));
  const explicitRemove = new Set(manifest.remove || []);
  const localManaged = await listLocalManagedFiles(gameDirPath);
  const toRemove = localManaged.filter((p) => explicitRemove.has(p) || !manifestPaths.has(p));

  return { toDownload, toRemove };
}

async function applyUpdate(manifest, gameDirPath, onProgress = () => {}) {
  const { toDownload, toRemove } = await planUpdate(manifest, gameDirPath);

  let downloaded = 0;
  await pool(
    toDownload,
    async (file) => {
      const dest = path.join(gameDirPath, ...file.path.split('/'));
      await ensureFile(file.url, dest, { sha1: file.sha1, size: file.size });
      downloaded += 1;
      onProgress({ phase: 'download', done: downloaded, total: toDownload.length, path: file.path });
    },
    6
  );

  for (const relPath of toRemove) {
    await fsp.unlink(path.join(gameDirPath, ...relPath.split('/'))).catch(() => {});
  }
  onProgress({ phase: 'cleanup', removed: toRemove.length });

  return { downloaded: toDownload.length, removed: toRemove.length, version: manifest.version };
}

module.exports = { fetchManifest, planUpdate, applyUpdate, isManaged, MANAGED_PREFIXES };
