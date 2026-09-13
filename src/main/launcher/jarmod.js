// BTA is distributed as a "jarmod": a full client.jar whose entries should be
// layered on top of the vanilla client.jar, overwriting any file with the
// same path. This is the same technique MultiMC/Prism's "jar mods" feature
// uses. We merge once and cache the result, keyed by both source files' sha1
// so a change to either input produces a fresh merge.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const paths = require('../paths');

// Bump when the merge itself changes shape, so installs carrying a jar built
// by an older (buggier) merge rebuild instead of reusing it. v2 kept directory
// entries, without which BTA finds no language packs.
const MERGE_FORMAT = 2;

function mergedJarName(vanillaSha1, jarmodSha1) {
  const key = crypto
    .createHash('sha1')
    .update(`${vanillaSha1}:${jarmodSha1}:v${MERGE_FORMAT}`)
    .digest('hex')
    .slice(0, 16);
  return `merged-${key}.jar`;
}

async function buildMergedJar(vanillaJarPath, vanillaSha1, jarmodJarPath, jarmodSha1) {
  const outPath = path.join(paths.jarsDir(), mergedJarName(vanillaSha1, jarmodSha1));
  if (fs.existsSync(outPath)) return outPath;

  const entries = new Map(); // path -> Buffer
  const directories = new Set(); // explicit directory entries, see below

  // Signature files reference exact original entry hashes -- once we start
  // overwriting entries the JVM will refuse to load the jar ("invalid
  // signature file"/SecurityException) unless these are dropped. We pass an
  // explicit -cp ourselves, so MANIFEST.MF's Class-Path isn't needed either.
  const isSignatureOrManifest = (entryName) =>
    entryName === 'META-INF/MANIFEST.MF' || /^META-INF\/.*\.(SF|RSA|DSA)$/i.test(entryName);

  const collect = (jarPath) => {
    for (const entry of new AdmZip(jarPath).getEntries()) {
      if (isSignatureOrManifest(entry.entryName)) continue;
      // Directory entries carry no data but are NOT redundant: BTA enumerates
      // its language packs by listing the directories under
      // assets/minecraft/lang/, so a jar without them loads with every string
      // untranslated ("gui.main_menu.button.singleplayer" in place of "Singleplayer").
      if (entry.isDirectory) directories.add(entry.entryName);
      else entries.set(entry.entryName, entry.getData()); // later jars win on conflict
    }
  };

  collect(vanillaJarPath);
  collect(jarmodJarPath);

  const out = new AdmZip();
  // Directories first, so every entry is preceded by its parent the way a
  // normal archiver writes them.
  for (const dir of [...directories].sort()) {
    out.addFile(dir, Buffer.alloc(0));
  }
  for (const [entryName, data] of entries) {
    out.addFile(entryName, data);
  }

  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.tmp`;
  out.writeZip(tmpPath);
  await fsp.rename(tmpPath, outPath);
  return outPath;
}

module.exports = { buildMergedJar };
