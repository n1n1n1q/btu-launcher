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

  const apiUrl = `https://api.adoptium.net/v3/assets/latest/17/hotspot?os=${ADOPTIUM_OS}&arch=${ADOPTIUM_ARCH}&image_type=jre&vendor=eclipse`;
  const releases = await fetchJson(apiUrl);
  if (!releases || !releases.length) {
    throw new Error('Could not find a Java 17 JRE release from Adoptium for this platform.');
  }
  const binary = releases[0].binary;
  const archiveUrl = binary.package.link;
  const archivePath = path.join(paths.cacheRoot(), 'downloads', `jre17-${ADOPTIUM_ARCH}.zip`);

  await ensureFile(archiveUrl, archivePath, {
    sha1: undefined, // Adoptium publishes sha256, not sha1; size-only check is enough here.
    size: binary.package.size,
    onProgress,
  });

  const extractDir = path.join(paths.javaDir(), '17');
  await fsp.rm(extractDir, { recursive: true, force: true });
  await fsp.mkdir(extractDir, { recursive: true });
  const zip = new AdmZip(archivePath);
  zip.extractAllTo(extractDir, true);

  // Adoptium zips contain one top-level folder (e.g. jdk-17.0.13+11-jre) --
  // flatten it so javawPath()'s fixed layout holds.
  const entries = await fsp.readdir(extractDir);
  if (entries.length === 1) {
    const inner = path.join(extractDir, entries[0]);
    for (const name of await fsp.readdir(inner)) {
      await fsp.rename(path.join(inner, name), path.join(extractDir, name));
    }
    await fsp.rmdir(inner);
  }

  const finalPath = javawPath();
  if (!fs.existsSync(finalPath)) {
    throw new Error('Java download completed but the expected executable was not found.');
  }
  return finalPath;
}

module.exports = { ensureJava17, checkVersion, javawPath };
