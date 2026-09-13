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

async function installLegacyAssets(assetIndexMeta, gameDirPath, onProgress) {
  const index = await fetchJson(assetIndexMeta.url);
  const objects = Object.entries(index.objects || {});
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

module.exports = { installLegacyAssets };
