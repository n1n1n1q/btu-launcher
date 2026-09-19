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

// On macOS the meta deliberately allows the plain "osx" natives on an arm64
// machine too (see the rules on lwjgl-*-natives-macos: they list only
// { os: "osx" }), so an Apple Silicon run matches BOTH the x86_64
// `-natives-macos` jar and the `-natives-macos-arm64` one. Since natives.js
// extracts every jar into one flat directory keyed by bare filename, the two
// liblwjgl.dylib copies collide -- and the x86_64 one, sorted last, wins. The
// arm64 JVM then dies on a "mach-o file, but is an incompatible architecture"
// when LWJGL tries to load it, which is the "game does not launch" report.
//
// So: whenever an arch-specific native is present for a given artifact, drop
// the generic one. Keyed by the artifact's maven coordinate with the
// `-natives-<platform>` suffix stripped, so lwjgl-glfw and lwjgl are treated
// as separate artifacts rather than one bucket.

// The arch lives in the ARTIFACT segment, not at the end of the coordinate --
// "org.lwjgl:lwjgl-glfw-natives-macos-arm64:3.3.3" ends in the version. So any
// suffix test has to run against parts[1], never the whole name.
function nativesArtifactSegment(name) {
  return name.split(':')[1] || '';
}

// Arch suffixes that can appear on a natives artifact. Anything carrying one of
// these is arch-specific; a natives jar with none of them is the generic build,
// which in practice means x64 (that is what `-natives-macos` and
// `-natives-windows` actually contain).
const ARCH_SUFFIXES = ['-arm64', '-arm32', '-x86'];

function archSuffixOf(name) {
  const artifact = nativesArtifactSegment(name);
  return ARCH_SUFFIXES.find((suffix) => artifact.endsWith(suffix)) || null;
}

/** The suffix this machine's natives must carry; null means the generic (x64) build. */
function wantedArchSuffix() {
  if (process.arch === 'arm64') return '-arm64';
  if (process.arch === 'arm') return '-arm32';
  if (process.arch === 'ia32') return '-x86';
  return null; // x64 -> generic
}

// The meta's OS rules are deliberately loose about arch: the plain "osx" and
// "windows" natives allow the whole platform, so a single machine matches BOTH
// the generic (x64) jar and every arch-specific sibling. natives.js extracts
// them all into one flat directory keyed by bare filename, so those copies
// collide and whichever sorts last silently wins -- handing an arm64 JVM an
// x86_64 liblwjgl.dylib (or an Intel Mac the arm64 one). LWJGL then dies on an
// "incompatible architecture" load error during glfwInit(), which is the
// "nothing happens when I press Play" report.
//
// Keep only the natives whose arch matches this machine: the arch-specific jar
// when this arch has one, otherwise the generic build. Artifacts that ship only
// a generic jar (all of Linux x64 here) are unaffected.
function preferArchSpecificNatives(libs) {
  const wanted = wantedArchSuffix();
  return libs.filter((lib) => {
    if (!lib.isNatives) return true;
    return archSuffixOf(lib.name) === wanted;
  });
}

/** Resolves a whole `libraries` array, dropping entries that don't apply here. */
function resolveLibraries(libraries) {
  const libs = (libraries || []).map(resolveLibrary).filter(Boolean);
  return preferArchSpecificNatives(libs);
}

function libraryCachePath(librariesDir, lib) {
  return path.join(librariesDir, ...lib.relativePath.split('/'));
}

module.exports = {
  currentOsName,
  currentOsRuleNames,
  preferArchSpecificNatives,
  resolveLibrary,
  resolveLibraries,
  libraryCachePath,
  mavenCoordToPath,
};
