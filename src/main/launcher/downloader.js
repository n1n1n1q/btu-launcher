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

async function hashFile(filePath, algorithm) {
  const hash = crypto.createHash(algorithm);
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

// Everything in the Mojang/BTA meta publishes sha1; Adoptium publishes sha256
// only. Take whichever the caller was given -- a size-only check is NOT
// integrity: a download can arrive the right length and still be corrupt
// (that's exactly how a bad JRE zip once got cached permanently, since the
// size matched on every subsequent run and it was never re-fetched).
function pickDigest({ sha1, sha256 }) {
  if (sha256) return { algorithm: 'sha256', value: sha256 };
  if (sha1) return { algorithm: 'sha1', value: sha1 };
  return null;
}

async function fileMatches(filePath, { sha1, sha256, size } = {}) {
  try {
    const digest = pickDigest({ sha1, sha256 });
    if (digest) {
      // The hash is authoritative and a declared size is only advisory: BTA's
      // meta publishes a `size` 5892 bytes larger than the client.jar it
      // actually serves, so checking the size too would decide the file was
      // stale and re-download 58 MB on every single launch.
      const actual = await hashFile(filePath, digest.algorithm);
      return actual.toLowerCase() === digest.value.toLowerCase();
    }
    // No hash to check against, so length is the only signal we have.
    const stat = await fsp.stat(filePath);
    return typeof size !== 'number' || stat.size === size;
  } catch {
    return false;
  }
}

// Destinations currently being downloaded, so concurrent callers can share one
// download instead of racing. See ensureFile.
const inFlight = new Map();

/**
 * Downloads `url` to `destPath` if it's missing or doesn't match the expected
 * hash/size, otherwise leaves the existing file alone. Writes to a temp file
 * and renames on success so a crash mid-download can't leave a corrupt file
 * that silently "matches" on next run.
 *
 * Concurrent calls for the same destination share a single download: pressing
 * Play twice during the first (multi-minute) fetch used to start two complete
 * install pipelines side by side, each re-fetching every file the other was
 * already fetching.
 */
function ensureFile(url, destPath, options = {}) {
  const existing = inFlight.get(destPath);
  if (existing) return existing;

  const task = withRetry(() => downloadToFile(url, destPath, options)).finally(() =>
    inFlight.delete(destPath)
  );
  inFlight.set(destPath, task);
  return task;
}

// A failed hash check means the bytes we have are wrong, and the next attempt
// starts from scratch (the temp file is already gone), so retrying is the whole
// repair strategy -- both for a flaky connection and for a bad write.
const MAX_ATTEMPTS = 3;

async function withRetry(attempt) {
  let lastError;
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
      if (i < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  throw lastError;
}

async function downloadToFile(url, destPath, { sha1, sha256, size, onProgress } = {}) {
  const digest = pickDigest({ sha1, sha256 });
  if (await fileMatches(destPath, { sha1, sha256, size })) return { skipped: true };

  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`);
  }

  // Unique per attempt. A shared `${destPath}.part` is a mutable path that two
  // writers can hold open at once -- a second launcher process, or this one
  // racing itself -- and each verifies only its own in-memory stream, so
  // whatever the interleaving leaves on disk is renamed into place unchecked.
  // Distinct temp files plus an atomic rename make that unrepresentable: the
  // loser is simply overwritten by a file that was verified end to end.
  const partPath = `${destPath}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.part`;
  const total = Number(res.headers.get('content-length')) || size || 0;
  let downloaded = 0;

  // Hashing the stream only proves the *transfer* was clean -- it says nothing
  // about what reached the disk. The finished file is re-read and hashed below
  // for that; this one just gives a precise error when the network is at fault.
  const hash = digest ? crypto.createHash(digest.algorithm) : null;

  // Every chunk is copied before it goes anywhere near the write stream.
  // In the main process `fetch` is served by Chromium's network stack, and the
  // chunks it yields can be views onto a buffer it reuses for the next read.
  // Hashing happens synchronously here and so always saw the right bytes, but
  // the write stream only gets around to writing that chunk later -- by which
  // point the buffer may already hold different data. That produced files of
  // exactly the right length with the wrong contents, and a stream hash that
  // cheerfully matched. Buffer.from() detaches from the shared backing store.
  async function* detachedChunks(source) {
    for await (const chunk of source) {
      const owned = Buffer.from(chunk);
      downloaded += owned.length;
      if (hash) hash.update(owned);
      if (onProgress) onProgress({ downloaded, total, url });
      yield owned;
    }
  }

  try {
    await pipeline(detachedChunks(Readable.fromWeb(res.body)), fs.createWriteStream(partPath));
  } catch (err) {
    // A dropped connection shouldn't leave a stray temp file behind, and since
    // the temp name is unique nothing else will ever pick it up.
    await fsp.unlink(partPath).catch(() => {});
    throw err;
  }

  const fail = async (message) => {
    await fsp.unlink(partPath).catch(() => {});
    throw new Error(message);
  };

  const streamed = hash ? hash.digest('hex') : null;
  if (digest) {
    if (streamed.toLowerCase() !== digest.value.toLowerCase()) {
      await fail(
        `${digest.algorithm} mismatch for ${url}: expected ${digest.value}, got ${streamed}`
      );
    }
    // The transfer was clean, so anything wrong now happened on the way to
    // disk. Read the file back and hash it before publishing it to destPath --
    // without this, a file that is written wrong is cached as verified and
    // every later run re-reads the same wreck.
    const written = await hashFile(partPath, digest.algorithm);
    if (written.toLowerCase() !== digest.value.toLowerCase()) {
      await fail(
        `${url} downloaded correctly but was corrupted on write ` +
          `(expected ${digest.value}, file on disk is ${written})`
      );
    }
  } else if (typeof size === 'number' && downloaded !== size) {
    // Without a hash, a truncated response is the only corruption still
    // detectable: a body that ends early still ends the stream cleanly.
    await fail(`Incomplete download for ${url}: expected ${size} bytes, got ${downloaded}`);
  }

  await fsp.rename(partPath, destPath);
  return { skipped: false, hash: streamed };
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

module.exports = { ensureFile, fileMatches, hashFile, pool, fetchJson };
