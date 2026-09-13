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

function mergedJarName(vanillaSha1, jarmodSha1) {
  const key = crypto
    .createHash('sha1')
    .update(`${vanillaSha1}:${jarmodSha1}`)
    .digest('hex')
    .slice(0, 16);
  return `merged-${key}.jar`;
}

async function buildMergedJar(vanillaJarPath, vanillaSha1, jarmodJarPath, jarmodSha1) {
  const outPath = path.join(paths.jarsDir(), mergedJarName(vanillaSha1, jarmodSha1));
  if (fs.existsSync(outPath)) return outPath;

  const entries = new Map(); // path -> Buffer

  // Signature files reference exact original entry hashes -- once we start
  // overwriting entries the JVM will refuse to load the jar ("invalid
  // signature file"/SecurityException) unless these are dropped. We pass an
  // explicit -cp ourselves, so MANIFEST.MF's Class-Path isn't needed either.
  const isSignatureOrManifest = (entryName) =>
    entryName === 'META-INF/MANIFEST.MF' || /^META-INF\/.*\.(SF|RSA|DSA)$/i.test(entryName);

  const base = new AdmZip(vanillaJarPath);
  for (const entry of base.getEntries()) {
    if (entry.isDirectory || isSignatureOrManifest(entry.entryName)) continue;
    entries.set(entry.entryName, entry.getData());
  }

  const overlay = new AdmZip(jarmodJarPath);
  for (const entry of overlay.getEntries()) {
    if (entry.isDirectory || isSignatureOrManifest(entry.entryName)) continue;
    entries.set(entry.entryName, entry.getData()); // BTA entries win on conflict
  }

  const out = new AdmZip();
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
