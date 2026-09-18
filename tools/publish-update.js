#!/usr/bin/env node
// Turns a real Minecraft instance folder (e.g. your Prism/MultiMC BTA
// instance's `minecraft/` directory) into a manifest.json + files/ folder
// ready to upload to your VPS. The launcher's src/main/updater/modpack.js
// downloads exactly what this produces.
//
// Usage:
//   node tools/publish-update.js \
//     --source "C:\Users\you\AppData\Roaming\PrismLauncher\instances\bta_fabric_instance_8.0.1\minecraft" \
//     --out ./update-staging \
//     --base-url https://updates.example.com/modpack \
//     --version 2025.09.13-1
//
// Then upload the contents of --out (manifest.json + files/) to wherever
// --base-url points, e.g.:
//   rsync -av update-staging/ you@your-vps:/var/www/updates/modpack/
//
// Re-run this any time your mods/config change; it automatically figures out
// which files were removed since the last publish (by diffing against the
// manifest.json already sitting in --out, if any) and adds them to
// manifest.remove so players' installs get cleaned up too.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MANAGED_PREFIXES = ['mods', 'config', 'coremods', 'datapacks', 'discpack', 'resourcepacks'];

// A source instance's mods/ folder tends to accumulate things that are not
// mods -- disabled jars renamed to .jar.disabled, old pre-Fabric resource
// zips, editor backups, .DS_Store. Publishing those pushes files the loader
// either ignores or chokes on to every player, so mods/ ships .jar only.
// The other managed folders legitimately hold mixed file types (config/ is
// .cfg/.json/.toml, resourcepacks/ is .zip, datapacks/ is whole trees), so
// they are copied as-is.
const PREFIX_FILE_FILTERS = {
  mods: (relPath) => relPath.toLowerCase().endsWith('.jar'),
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      args[key] = value;
      if (value !== true) i += 1;
    }
  }
  return args;
}

async function sha1(filePath) {
  const hash = crypto.createHash('sha1');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function walk(dir, relBase = '') {
  const out = [];
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, rel)));
    else out.push(rel);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = args.source;
  const outDir = args.out || './update-staging';
  const baseUrl = args['base-url'];
  const version = args.version || new Date().toISOString().replace(/[:.]/g, '-');
  const btaVersion = args['bta-version'] || '8.0.1';

  if (!source || !baseUrl) {
    console.error('Usage: node tools/publish-update.js --source <instance/minecraft dir> --base-url <public URL prefix> [--out ./update-staging] [--version X] [--bta-version 8.0.1]');
    process.exit(1);
  }

  const manifestPath = path.join(outDir, 'manifest.json');
  const previousFiles = new Map();
  if (fs.existsSync(manifestPath)) {
    const prev = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    for (const f of prev.files || []) previousFiles.set(f.path, f);
  }

  const filesDir = path.join(outDir, 'files');
  await fsp.mkdir(filesDir, { recursive: true });

  const manifestFiles = [];
  const seenPaths = new Set();

  for (const prefix of MANAGED_PREFIXES) {
    const relPaths = await walk(path.join(source, prefix), prefix);
    const accepts = PREFIX_FILE_FILTERS[prefix];
    for (const relPath of relPaths) {
      if (accepts && !accepts(relPath)) {
        console.log(`  skipped ${relPath} (not a .jar)`);
        continue;
      }
      const srcFile = path.join(source, ...relPath.split('/'));
      const stat = await fsp.stat(srcFile);
      const hash = await sha1(srcFile);

      const destFile = path.join(filesDir, ...relPath.split('/'));
      await fsp.mkdir(path.dirname(destFile), { recursive: true });
      await fsp.copyFile(srcFile, destFile);

      manifestFiles.push({
        path: relPath,
        sha1: hash,
        size: stat.size,
        url: `${baseUrl.replace(/\/$/, '')}/files/${relPath}`,
      });
      seenPaths.add(relPath);
      console.log(`+ ${relPath} (${hash.slice(0, 8)})`);
    }
  }

  const remove = [...previousFiles.keys()].filter((p) => !seenPaths.has(p));
  for (const p of remove) console.log(`- ${p} (removed since last publish)`);

  const manifest = { version, btaVersion, files: manifestFiles, remove };
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`\nWrote ${manifestFiles.length} files, ${remove.length} removal(s) to ${outDir}`);
  console.log(`Manifest version: ${version}`);
  console.log(`Now upload the contents of "${outDir}" to ${baseUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
