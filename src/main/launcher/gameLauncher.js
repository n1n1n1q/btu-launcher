// Orchestrates a full launch: resolve meta -> ensure Java -> ensure jars/libs/
// assets are on disk -> build the JVM command line -> spawn the game.
// Every ensure* step is a no-op if the file is already present and verified,
// so a "launch" after the first one is just a quick integrity check.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const paths = require('../paths');
const { fetchInstanceMeta } = require('./metaFetch');
const { ensureJava17 } = require('./java');
const { ensureFile } = require('./downloader');
const { resolveLibraries, libraryCachePath } = require('./libraryResolver');
const { buildMergedJar } = require('./jarmod');
const { extractNatives } = require('./natives');
const { installLegacyAssets } = require('./assets');

function substituteArgs(template, values) {
  return template.split(' ').map((token) =>
    token.replace(/\$\{(\w+)\}/g, (_, key) => {
      if (!(key in values)) throw new Error(`Unknown launch arg placeholder: \${${key}}`);
      return values[key];
    })
  );
}

async function ensureInstanceFiles(btaVersion, report) {
  const meta = await fetchInstanceMeta(btaVersion);

  report('Checking Java...');
  const javaBin = await ensureJava17((p) => report(`Downloading Java runtime... ${pct(p)}`));

  report('Checking base game files...');
  const vanillaArtifact = meta.minecraft.mainJar.downloads.artifact;
  const vanillaPath = path.join(paths.jarsDir(), `vanilla-${btaVersion}.jar`);
  await ensureFile(vanillaArtifact.url, vanillaPath, {
    sha1: vanillaArtifact.sha1,
    size: vanillaArtifact.size,
    onProgress: (p) => report(`Downloading Minecraft base... ${pct(p)}`),
  });

  report('Checking BTA files...');
  const jarmodArtifact = meta.jarmod.jarMods[0].downloads.artifact;
  const jarmodPath = path.join(paths.jarsDir(), `bta-${btaVersion}.jar`);
  await ensureFile(jarmodArtifact.url, jarmodPath, {
    sha1: jarmodArtifact.sha1,
    size: jarmodArtifact.size,
    onProgress: (p) => report(`Downloading Better than Adventure... ${pct(p)}`),
  });

  report('Merging game files...');
  const mergedJarPath = await buildMergedJar(
    vanillaPath,
    vanillaArtifact.sha1,
    jarmodPath,
    jarmodArtifact.sha1
  );

  report('Checking mod loader libraries...');
  const libs = [
    ...resolveLibraries(meta.lwjgl.libraries),
    ...resolveLibraries(meta.loader.libraries),
  ];
  for (const lib of libs) {
    const dest = libraryCachePath(paths.librariesDir(), lib);
    await ensureFile(lib.url, dest, {
      sha1: lib.sha1,
      size: lib.size,
      onProgress: (p) => report(`Downloading libraries... ${lib.name} ${pct(p)}`),
    });
  }

  const nativesDirPath = paths.nativesDir(btaVersion);
  const nativeJarPaths = libs
    .filter((l) => l.isNatives)
    .map((l) => libraryCachePath(paths.librariesDir(), l));
  await extractNatives(nativeJarPaths, nativesDirPath);

  const classpathJarPaths = libs.filter((l) => !l.isNatives).map((l) => libraryCachePath(paths.librariesDir(), l));

  report('Checking assets (first launch can take a while)...');
  const gameDirPath = paths.gameDir(btaVersion);
  fs.mkdirSync(gameDirPath, { recursive: true });
  await installLegacyAssets(meta.minecraft.assetIndex, gameDirPath, (p) =>
    report(`Downloading assets... ${p.done}/${p.total}`)
  );

  return {
    meta,
    javaBin,
    mergedJarPath,
    classpathJarPaths,
    nativesDirPath,
    gameDirPath,
  };
}

function pct({ downloaded, total }) {
  if (!total) return '';
  return `${Math.floor((downloaded / total) * 100)}%`;
}

/**
 * Launches the game. `profile` is the object returned by auth/offline.js or
 * auth/microsoft.js. Returns the child process; caller should listen to its
 * stdout/stderr/exit for logging and to know when to re-enable the Play button.
 */
async function launch({ btaVersion, profile, ramMb, report = () => {} }) {
  const { meta, javaBin, mergedJarPath, classpathJarPaths, nativesDirPath, gameDirPath } =
    await ensureInstanceFiles(btaVersion, report);

  const classpath = [mergedJarPath, ...classpathJarPaths].join(path.delimiter);

  const gameArgs = substituteArgs(meta.minecraft.minecraftArguments, {
    auth_player_name: profile.username,
    auth_session: profile.session,
    game_directory: gameDirPath,
    auth_uuid: profile.uuid,
  });

  // NOTE: vanilla b1.7.3 has no CLI flag to auto-join a server -- players
  // still pick it from the in-game multiplayer list. A nice follow-up is
  // pre-seeding <gameDir>/servers_new.dat with the BTU server entry (it's a
  // small NBT list) so it's there on first launch; not done yet.
  const jvmArgs = [
    `-Xmx${ramMb}M`,
    `-Xms${Math.min(ramMb, 1024)}M`,
    `-Djava.library.path=${nativesDirPath}`,
    '-cp',
    classpath,
    meta.loader.mainClass,
    ...gameArgs,
  ];

  const child = spawn(javaBin, jvmArgs, {
    cwd: gameDirPath,
    windowsHide: true,
  });

  return child;
}

module.exports = { launch, ensureInstanceFiles };
