// Interprets the standard Mojang/MultiMC-style "library" entries found in the
// patch JSONs (net.minecraft.json, org.lwjgl.json, fabric-loader.json). Two
// shapes show up in practice:
//
//   1. Modern shape: { name, downloads: { artifact: { url, sha1, size } }, rules? }
//   2. Old maven shape: { name, url: "<repo base>", sha1, size } where the
//      actual artifact path is derived from the maven coordinate in `name`.
//
// Both carry an optional `rules` array of { action: "allow"|"disallow", os: { name } }
// that gates whether the library applies to the current OS/arch -- this is how
// a single patch file covers Windows/macOS/Linux and native-library variants.
const path = require('node:path');

function currentOsName() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'osx';
  return 'linux';
}

/** e.g. "windows" + x64 -> "windows"; "windows" + arm64 -> "windows-arm64" (matches how BTA's meta splits native jars per-arch). */
function currentOsRuleNames() {
  const os = currentOsName();
  const arch = process.arch; // 'x64' | 'arm64' | 'ia32'
  const names = [os];
  if (arch === 'arm64') names.push(`${os}-arm64`);
  else if (arch === 'ia32') names.push(`${os}-x86`);
  return names;
}

function ruleAllows(rules) {
  if (!rules || rules.length === 0) return true;
  const applicableNames = currentOsRuleNames();
  let allowed = false;
  for (const rule of rules) {
    const osMatches = !rule.os || !rule.os.name || applicableNames.includes(rule.os.name);
    if (!osMatches) continue;
    allowed = rule.action === 'allow';
  }
  return allowed;
}

function mavenCoordToPath(coord) {
  const parts = coord.split(':');
  const [group, artifact, version] = parts;
  const classifier = parts[3];
  const filename = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`;
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${filename}`;
}

function isNativesLibrary(name) {
  return /:natives-/.test(name) || /-natives-/.test(name);
}

/**
 * Normalizes one library entry into { name, url, sha1, size, isNatives }.
 * Returns null if the entry doesn't apply to the current OS/arch.
 */
function resolveLibrary(entry) {
  if (!ruleAllows(entry.rules)) return null;

  let url;
  let sha1;
  let size;
  if (entry.downloads && entry.downloads.artifact) {
    ({ url, sha1, size } = entry.downloads.artifact);
  } else if (entry.url) {
    url = entry.url.replace(/\/?$/, '/') + mavenCoordToPath(entry.name);
    sha1 = entry.sha1;
    size = entry.size;
  } else {
    return null;
  }

  return {
    name: entry.name,
    url,
    sha1,
    size,
    isNatives: isNativesLibrary(entry.name),
    relativePath: mavenCoordToPath(entry.name),
  };
}

/** Resolves a whole `libraries` array, dropping entries that don't apply here. */
function resolveLibraries(libraries) {
  return (libraries || []).map(resolveLibrary).filter(Boolean);
}

function libraryCachePath(librariesDir, lib) {
  return path.join(librariesDir, ...lib.relativePath.split('/'));
}

module.exports = {
  currentOsName,
  currentOsRuleNames,
  resolveLibrary,
  resolveLibraries,
  libraryCachePath,
  mavenCoordToPath,
};
