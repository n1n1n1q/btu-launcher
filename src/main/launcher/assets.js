// Beta 1.7.3 predates Mojang's modern assets system entirely -- its launch
// args (see net.minecraft.json's "minecraftArguments") don't even take an
// --assetsDir flag. The client just expects a flat `resources/` folder next
// to the world saves containing real-named files (sound/*.ogg, lang/en_US.lang,
// etc). The asset *index* Mojang serves is the modern hash-addressed format,
// so we download each object once into a shared content-addressed cache, then
// copy (not move -- the cache is shared across instances) each one to its
// real filename under `<gameDir>/resources/`.
const fsp = require('node:fs/promises');
const path = require('node:path');
const { fetchJson, ensureFile, pool } = require('./downloader');
const paths = require('../paths');

// The pre-1.6 index carries the same sound three times over, once per
// sound-engine generation Mojang shipped: "sound/" (the original beta set),
// "sound3/" and "newsound/". The client asks for none of those prefixes -- it
// loads a bare path like "random/click.ogg" or "step/grass1.ogg" -- so copying
// each entry verbatim buried every modern file under a directory nothing ever
// reads, and left the bare paths either missing or holding only the handful of
// files the oldest "sound/" scheme happened to define. In game that surfaced as
// "Source 'sound_164' was not created because a sound buffer was not found for
// random/click.ogg", i.e. silence or wrong audio for most effects.
const SOUND_SCHEME_PREFIXES = ['newsound/', 'sound3/', 'sound/'];

// Later entries win, so order this worst -> best and let the better scheme
// overwrite: newsound is the most recent set the client expects.
const SCHEME_RANK = { 'sound/': 0, 'sound3/': 1, 'newsound/': 2 };

/** Maps an index path to where the client actually looks for it. */
function resolveAssetPath(assetPath) {
  for (const prefix of SOUND_SCHEME_PREFIXES) {
    if (assetPath.startsWith(prefix)) return assetPath.slice(prefix.length);
  }
  return assetPath;
}

function schemeRankOf(assetPath) {
  for (const prefix of SOUND_SCHEME_PREFIXES) {
    if (assetPath.startsWith(prefix)) return SCHEME_RANK[prefix];
  }
  return -1; // not a sound entry -- nothing competes for its destination
}

/**
 * Collapses the three sound schemes onto one destination each, keeping the
 * highest-ranked scheme when several map to the same file. Returns
 * [destRelPath, { hash, size }] pairs ready to copy.
 */
function dedupeObjects(objects) {
  const chosen = new Map(); // destPath -> { entry, rank }
  for (const [assetPath, meta] of objects) {
    const dest = resolveAssetPath(assetPath);
    const rank = schemeRankOf(assetPath);
    const existing = chosen.get(dest);
    if (existing && existing.rank >= rank) continue;
    chosen.set(dest, { entry: [dest, meta], rank });
  }
  return [...chosen.values()].map((v) => v.entry);
}

async function installLegacyAssets(assetIndexMeta, gameDirPath, onProgress) {
  const index = await fetchJson(assetIndexMeta.url);
  const objects = dedupeObjects(Object.entries(index.objects || {}));
  const objectsDir = paths.assetsObjectsDir();
  const resourcesDir = path.join(gameDirPath, 'resources');

  let done = 0;
  await pool(
    objects,
    async ([assetPath, { hash, size }]) => {
      const hashPrefix = hash.slice(0, 2);
      const cachePath = path.join(objectsDir, hashPrefix, hash);
      const url = `https://resources.download.minecraft.net/${hashPrefix}/${hash}`;
      await ensureFile(url, cachePath, { sha1: hash, size });

      const destPath = path.join(resourcesDir, assetPath);
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      // Skip the copy if it's already there with the right size -- cheap check,
      // avoids re-copying thousands of small files on every launch.
      const alreadyPresent = await fsp
        .stat(destPath)
        .then((s) => s.size === size)
        .catch(() => false);
      if (!alreadyPresent) await fsp.copyFile(cachePath, destPath);

      done += 1;
      if (onProgress) onProgress({ done, total: objects.length });
    },
    16
  );
}

module.exports = { installLegacyAssets, resolveAssetPath, dedupeObjects };
