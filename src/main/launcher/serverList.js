// Pre-seeds <gameDir>/servers_new.dat with the BTU server so it's already in
// the in-game Multiplayer list on first launch, instead of making every
// player type the address in themselves.
//
// This is NOT vanilla b1.7.3's server list format (that's a flat "servers"
// list of {name, ip} compounds in a file called "servers.dat"). This BTA
// build tracks servers by UUID instead, in a gzipped NBT file structured as:
//
//   ServerData: Compound        -- one child Compound per server, keyed by
//                                   a random UUID string
//     <uuid>: Compound
//       Address: String         -- "host" or "host:port"
//       ShowIp: Byte
//   History: Compound           -- <uuid>: Long (epoch millis last joined)
//   Favorites: List<String>     -- UUIDs, pinned/starred order
//
// Reverse-engineered from a real servers_new.dat produced by this client
// (History/Favorites entries created once the player actually connects) --
// there's no public spec for it. We only ever *create* the file, never
// overwrite it: once it exists, it's the player's own list and Minecraft
// itself is the only thing that should touch it after that.
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const TAG = { END: 0, BYTE: 1, LONG: 4, STRING: 8, LIST: 9, COMPOUND: 10 };

// Minimal big-endian NBT writer -- just enough tag types to build a
// servers_new.dat. Not a general-purpose NBT library.
class NbtWriter {
  constructor() {
    this.chunks = [];
  }
  raw(buf) {
    this.chunks.push(buf);
    return this;
  }
  byte(v) {
    return this.raw(Buffer.from([v & 0xff]));
  }
  int32(v) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(v, 0);
    return this.raw(b);
  }
  str(v) {
    const utf8 = Buffer.from(v, 'utf8');
    const len = Buffer.alloc(2);
    len.writeUInt16BE(utf8.length, 0);
    return this.raw(len).raw(utf8);
  }
  // Writes the payload for `type` (no tag/name header -- callers write that
  // themselves for named tags, or nothing for list elements).
  payload(type, value) {
    switch (type) {
      case TAG.BYTE:
        return this.byte(value);
      case TAG.STRING:
        return this.str(value);
      case TAG.LIST: {
        const [elemType, items] = value;
        this.byte(elemType).int32(items.length);
        for (const item of items) this.payload(elemType, item);
        return this;
      }
      case TAG.COMPOUND: {
        for (const { type: childType, name, value: childValue } of value) {
          this.byte(childType).str(name);
          this.payload(childType, childValue);
        }
        return this.byte(TAG.END);
      }
      default:
        throw new Error(`Unsupported NBT tag type: ${type}`);
    }
  }
  toBuffer() {
    return Buffer.concat(this.chunks);
  }
}

const entry = (type, name, value) => ({ type, name, value });

function buildServersNew(serverAddress, uuid) {
  const w = new NbtWriter();
  w.byte(TAG.COMPOUND).str(''); // root compound, unnamed
  w.payload(TAG.COMPOUND, [
    entry(TAG.COMPOUND, 'ServerData', [
      entry(TAG.COMPOUND, uuid, [
        entry(TAG.STRING, 'Address', serverAddress),
        entry(TAG.BYTE, 'ShowIp', 1),
      ]),
    ]),
    entry(TAG.COMPOUND, 'History', []), // player hasn't connected yet
    entry(TAG.LIST, 'Favorites', [TAG.STRING, [uuid]]),
  ]);
  return w.toBuffer();
}

/**
 * Writes `<gameDirPath>/servers_new.dat` with a single entry for
 * `serverAddress`, but only if that file doesn't exist yet. No-op if
 * `serverAddress` is falsy.
 */
async function seedServerList(gameDirPath, serverAddress) {
  if (!serverAddress) return;

  await fs.mkdir(gameDirPath, { recursive: true });
  const destPath = path.join(gameDirPath, 'servers_new.dat');
  const data = zlib.gzipSync(buildServersNew(serverAddress, crypto.randomUUID()));

  try {
    await fs.writeFile(destPath, data, { flag: 'wx' }); // wx: fail if it already exists
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    // Already there -- leave whatever the player has alone.
  }
}

module.exports = { seedServerList };
