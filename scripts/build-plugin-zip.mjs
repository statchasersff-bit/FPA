/**
 * Build the StatChasers Data Tools WordPress plugin zip.
 *
 * Packages artifacts/wordpress-plugin/statchasers-data-tools/ into
 * artifacts/wordpress-plugin/statchasers-data-tools.zip with the standard
 * WordPress layout (a single top-level plugin folder inside the archive).
 *
 * Pure Node — no `zip` binary required. Entries are STORED (uncompressed);
 * WordPress unpacks them fine and it keeps this builder dependency-free.
 *
 * Usage: node scripts/build-plugin-zip.mjs
 */

import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const PLUGIN_DIR = "artifacts/wordpress-plugin/statchasers-data-tools";
const OUT_ZIP = "artifacts/wordpress-plugin/statchasers-data-tools.zip";
const ROOT_PREFIX = "statchasers-data-tools"; // top-level folder inside the zip

// Skip junk that should never ship in a plugin build.
const SKIP = new Set([".DS_Store", "node_modules", ".git"]);

// ─── CRC-32 (IEEE) ──────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ─── Collect files ──────────────────────────────────────────────────────────
function walk(dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (st.isFile()) acc.push(full);
  }
  return acc;
}

const files = walk(PLUGIN_DIR).map((full) => {
  // Path inside the zip: "statchasers-data-tools/<relative path>", forward slashes.
  const rel = relative(PLUGIN_DIR, full).split(sep).join("/");
  return { zipPath: `${ROOT_PREFIX}/${rel}`, data: readFileSync(full) };
});

// ─── Write the ZIP ──────────────────────────────────────────────────────────
const localParts = [];
const centralParts = [];
let offset = 0;

// Fixed DOS timestamp (2020-01-01 00:00:00) so builds are reproducible.
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

for (const f of files) {
  const nameBuf = Buffer.from(f.zipPath, "utf8");
  const crc = crc32(f.data);
  const size = f.data.length;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // local file header signature
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // flags: UTF-8 filename
  local.writeUInt16LE(0, 8); // method: store
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(size, 18); // compressed size
  local.writeUInt32LE(size, 22); // uncompressed size
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28); // extra length
  localParts.push(local, nameBuf, f.data);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); // central dir signature
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0x0800, 8); // flags: UTF-8
  central.writeUInt16LE(0, 10); // method: store
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(size, 20);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30); // extra length
  central.writeUInt16LE(0, 32); // comment length
  central.writeUInt16LE(0, 34); // disk number start
  central.writeUInt16LE(0, 36); // internal attrs
  central.writeUInt32LE(0, 38); // external attrs
  central.writeUInt32LE(offset, 42); // local header offset
  centralParts.push(central, nameBuf);

  offset += local.length + nameBuf.length + f.data.length;
}

const centralBuf = Buffer.concat(centralParts);
const localBuf = Buffer.concat(localParts);

const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
eocd.writeUInt16LE(0, 4); // disk number
eocd.writeUInt16LE(0, 6); // central dir start disk
eocd.writeUInt16LE(files.length, 8); // entries on this disk
eocd.writeUInt16LE(files.length, 10); // total entries
eocd.writeUInt32LE(centralBuf.length, 12); // central dir size
eocd.writeUInt32LE(localBuf.length, 16); // central dir offset
eocd.writeUInt16LE(0, 20); // comment length

writeFileSync(OUT_ZIP, Buffer.concat([localBuf, centralBuf, eocd]));
console.log(`[build-plugin-zip] wrote ${OUT_ZIP} — ${files.length} files`);
for (const f of files) console.log(`  ${f.zipPath}`);
