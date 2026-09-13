// Extracts platform native libraries (.dll/.so/.dylib) out of the LWJGL
// natives jars into a flat directory that gets passed to the JVM as
// -Djava.library.path. Flat on purpose: LWJGL loads these by bare filename.
const fsp = require('node:fs/promises');
const path = require('node:path');
const AdmZip = require('adm-zip');

const NATIVE_EXTENSIONS = new Set(['.dll', '.so', '.dylib']);

async function extractNatives(nativeJarPaths, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  for (const jarPath of nativeJarPaths) {
    const zip = new AdmZip(jarPath);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const ext = path.extname(entry.entryName);
      if (!NATIVE_EXTENSIONS.has(ext)) continue;
      const destPath = path.join(destDir, path.basename(entry.entryName));
      await fsp.writeFile(destPath, entry.getData());
    }
  }
}

module.exports = { extractNatives };
