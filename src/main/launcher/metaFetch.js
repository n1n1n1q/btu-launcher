// Fetches the official BTA instance-meta patch files (see versions.js) for a
// given BTA version and caches them on disk. A git tag is immutable, so once
// fetched for a given ref we never need to re-fetch -- only a version bump
// (new ref) triggers a new fetch.
const fsp = require('node:fs/promises');
const path = require('node:path');
const paths = require('../paths');
const { fetchJson } = require('./downloader');
const { resolveRef } = require('./versions');

function rawUrl(metaRepo, ref, filePath) {
  return `https://raw.githubusercontent.com/${metaRepo}/${ref}/${filePath}`;
}

async function cachedJson(cacheFile, url) {
  try {
    const cached = await fsp.readFile(cacheFile, 'utf8');
    return JSON.parse(cached);
  } catch {
    // fall through to network fetch
  }
  const data = await fetchJson(url);
  await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
  await fsp.writeFile(cacheFile, JSON.stringify(data));
  return data;
}

/**
 * Returns the four patch documents that fully describe how to build and
 * launch a given BTA version: minecraft (vanilla base), lwjgl, jarmod (BTA
 * itself), and loader (Babric/Fabric loader + its libraries).
 */
async function fetchInstanceMeta(btaVersion) {
  const { ref, metaRepo } = resolveRef(btaVersion);
  const cacheDir = path.join(paths.metaCacheDir(), metaRepo.replace('/', '_'), ref);

  const [minecraft, lwjgl, jarmod, loader] = await Promise.all([
    cachedJson(
      path.join(cacheDir, 'net.minecraft.json'),
      rawUrl(metaRepo, ref, 'client/patches/net.minecraft.json')
    ),
    cachedJson(
      path.join(cacheDir, 'org.lwjgl.json'),
      rawUrl(metaRepo, ref, 'client/patches/org.lwjgl.json')
    ),
    cachedJson(
      path.join(cacheDir, 'custom.jarmod.bta.json'),
      rawUrl(metaRepo, ref, 'client/patches/custom.jarmod.bta.json')
    ),
    cachedJson(
      path.join(cacheDir, 'net.fabricmc.fabric-loader.json'),
      rawUrl(metaRepo, ref, 'client/patches/net.fabricmc.fabric-loader.json')
    ),
  ]);

  return { minecraft, lwjgl, jarmod, loader };
}

module.exports = { fetchInstanceMeta };
