// Generic verified-download helpers used by every fetch path in the launcher
// (loader meta, libraries, the BTA jarmod, legacy assets, modpack updates).
// Centralizing this means hash verification and resumable/parallel behavior
// only has to be gotten right once.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

async function sha1File(filePath) {
  const hash = crypto.createHash('sha1');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function fileMatches(filePath, expectedSha1, expectedSize) {
  try {
    const stat = await fsp.stat(filePath);
    if (typeof expectedSize === 'number' && stat.size !== expectedSize) return false;
    if (!expectedSha1) return true; // size-only check when no hash is known
    const actual = await sha1File(filePath);
    return actual.toLowerCase() === expectedSha1.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Downloads `url` to `destPath` if it's missing or doesn't match the expected
 * hash/size, otherwise leaves the existing file alone. Writes to a .part file
 * and renames on success so a crash mid-download can't leave a corrupt file
 * that silently "matches" on next run.
 */
async function ensureFile(url, destPath, { sha1, size, onProgress } = {}) {
  if (await fileMatches(destPath, sha1, size)) return { skipped: true };

  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`);
  }

  const partPath = `${destPath}.part`;
  const total = Number(res.headers.get('content-length')) || size || 0;
  let downloaded = 0;

  const hash = crypto.createHash('sha1');
  const nodeStream = Readable.fromWeb(res.body);
  nodeStream.on('data', (chunk) => {
    downloaded += chunk.length;
    hash.update(chunk);
    if (onProgress) onProgress({ downloaded, total, url });
  });

  await pipeline(nodeStream, fs.createWriteStream(partPath));

  const actualSha1 = hash.digest('hex');
  if (sha1 && actualSha1.toLowerCase() !== sha1.toLowerCase()) {
    await fsp.unlink(partPath).catch(() => {});
    throw new Error(`Hash mismatch for ${url}: expected ${sha1}, got ${actualSha1}`);
  }

  await fsp.rename(partPath, destPath);
  return { skipped: false, sha1: actualSha1 };
}

/** Runs `items` through `worker` with bounded concurrency. */
async function pool(items, worker, concurrency = 8) {
  let index = 0;
  const runners = new Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
    for (;;) {
      const i = index++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

module.exports = { ensureFile, fileMatches, sha1File, pool, fetchJson };
