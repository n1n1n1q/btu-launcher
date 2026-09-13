// BTA/Babric requires Java 17 (see net.minecraft.json's compatibleJavaMajors),
// unlike ancient Minecraft's usual Java 8 requirement. Rather than making
// players install a JRE themselves, we download Eclipse Temurin's JRE 17 from
// the Adoptium API and keep it under paths.javaDir() -- fully self-contained.
//
// macOS support is stubbed (see ADOPTIUM_OS below) -- fill in when the macOS
// port happens; the Adoptium API shape is identical, just os=mac and the
// archive layout differs slightly (Contents/Home on macOS).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const AdmZip = require('adm-zip');
const { ensureFile, fetchJson } = require('./downloader');
const paths = require('../paths');
const config = require('../config');

const execFileAsync = promisify(execFile);

const ADOPTIUM_OS = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
const ADOPTIUM_ARCH = { x64: 'x64', arm64: 'aarch64' }[process.arch] || 'x64';

// Adoptium publishes .zip for Windows but .tar.gz for Linux and macOS. Feeding
// a gzip stream to AdmZip yields "Invalid or unsupported zip format. No END
// header found" -- and because the file's own sha256 is correct, ensureFile()
// caches it and every retry replays the same failure.
function archiveKind(pkg) {
  const name = String((pkg && (pkg.name || pkg.link)) || '').toLowerCase();
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return 'tar';
  if (name.endsWith('.zip')) return 'zip';
  return null;
}

async function extractArchive(archivePath, kind, extractDir) {
  if (kind === 'zip') {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(extractDir, true);
    return;
  }
  if (kind !== 'tar') {
    throw new Error(`Unsupported Java archive format: ${archivePath}`);
  }
  // The archive holds one top-level directory (e.g. jdk-17.0.20.1+1-jre);
  // --strip-components=1 drops it so javawPath()'s fixed bin/ layout holds
  // straight away. tar preserves the executable bits on bin/java.
  await execFileAsync('tar', ['-xzf', archivePath, '-C', extractDir, '--strip-components=1']);
}

function javawPath() {
  const exe = process.platform === 'win32' ? 'javaw.exe' : 'java';
  return path.join(paths.javaDir(), '17', 'bin', exe);
}

async function checkVersion(javaBinPath) {
  try {
    const { stderr, stdout } = await execFileAsync(javaBinPath.replace('javaw.exe', 'java.exe'), [
      '-version',
    ]);
    const text = `${stdout}${stderr}`;
    const match = text.match(/version "(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** Returns a usable Java 17 executable path, downloading a JRE if none is configured/found. */
async function ensureJava17(onProgress) {
  const configured = config.get('javaPath');
  if (configured && (await checkVersion(configured)) >= 17) return configured;

  const managed = javawPath();
  if (fs.existsSync(managed) && (await checkVersion(managed)) >= 17) return managed;

  if (!ADOPTIUM_OS) {
    throw new Error(`No managed Java download available for platform "${process.platform}" yet.`);
  }

  // NB: the parameter is "architecture" -- "arch" is silently ignored, and the
  // endpoint then answers with every architecture it has, aarch64 first, so
  // releases[0] handed an x64 machine an ARM JRE that could never execute.
  const apiUrl =
    `https://api.adoptium.net/v3/assets/latest/17/hotspot` +
    `?os=${ADOPTIUM_OS}&architecture=${ADOPTIUM_ARCH}&image_type=jre&vendor=eclipse`;
  const releases = await fetchJson(apiUrl);
  if (!releases || !releases.length) {
    throw new Error('Could not find a Java 17 JRE release from Adoptium for this platform.');
  }
  const release = releases.find((r) => r && r.binary && r.binary.architecture === ADOPTIUM_ARCH);
  const binary = (release || releases[0]).binary;
  const pkg = binary.package;
  const kind = archiveKind(pkg);
  if (!kind) {
    throw new Error(
      `Adoptium returned an unusable Java archive (${pkg.name || pkg.link}). ` +
        'Only .zip and .tar.gz are supported.'
    );
  }
  const archiveUrl = pkg.link;
  const archivePath = path.join(
    paths.cacheRoot(),
    'downloads',
    `jre17-${ADOPTIUM_ARCH}.${kind === 'tar' ? 'tar.gz' : 'zip'}`
  );

  await ensureFile(archiveUrl, archivePath, {
    // Adoptium publishes sha256 rather than sha1. Verify it: a size-only check
    // passes a download that arrived complete in length but corrupt in content,
    // and because the size keeps matching, that bad archive is then cached
    // forever and every launch fails identically on extraction.
    sha256: pkg.checksum,
    size: pkg.size,
    onProgress,
  });

  const extractDir = path.join(paths.javaDir(), '17');
  await fsp.rm(extractDir, { recursive: true, force: true });
  await fsp.mkdir(extractDir, { recursive: true });
  try {
    await extractArchive(archivePath, kind, extractDir);
  } catch (err) {
    // Bin both the archive and the half-extracted tree so the next attempt
    // re-downloads instead of replaying the same failure, and say which step
    // broke -- a bare zlib "invalid block type" tells a player nothing.
    await fsp.rm(archivePath, { force: true }).catch(() => {});
    await fsp.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      `Could not unpack the downloaded Java runtime (${err.message}). ` +
        'The download has been discarded -- press Play again to retry.'
    );
  }

  // Zip archives (Windows) still carry one top-level folder
  // (e.g. jdk-17.0.13+11-jre) -- flatten it so javawPath()'s fixed layout holds.
  const entries = await fsp.readdir(extractDir);
  if (entries.length === 1) {
    const inner = path.join(extractDir, entries[0]);
    for (const name of await fsp.readdir(inner)) {
      await fsp.rename(path.join(inner, name), path.join(extractDir, name));
    }
    await fsp.rmdir(inner);
  }

  // macOS Adoptium archives additionally nest the real JRE under
  // Contents/Home (that's the layout /usr/libexec/java_home expects) --
  // flatten that too so it matches Windows/Linux's flat bin/lib layout.
  const contentsHome = path.join(extractDir, 'Contents', 'Home');
  if (fs.existsSync(contentsHome)) {
    for (const name of await fsp.readdir(contentsHome)) {
      await fsp.rename(path.join(contentsHome, name), path.join(extractDir, name));
    }
    await fsp.rm(path.join(extractDir, 'Contents'), { recursive: true, force: true });
  }

  const finalPath = javawPath();
  if (!fs.existsSync(finalPath)) {
    throw new Error('Java download completed but the expected executable was not found.');
  }
  return finalPath;
}

module.exports = { ensureJava17, checkVersion, javawPath };
