/**
 * One-off: produce a transparent-background copy of the brand logo so it merges
 * into any sidebar/header colour instead of sitting in a white box.
 *
 * Pure Node (zlib only) — decodes the source RGB PNG, keys out the white matte
 * (with a feathered edge to avoid a hard fringe), and re-encodes as RGBA.
 *
 *   node client/scripts/make-logo-transparent.cjs <src.png> <out.png>
 */
const fs = require('fs');
const zlib = require('zlib');

const [, , srcPath, outPath] = process.argv;
if (!srcPath || !outPath) { console.error('usage: <src> <out>'); process.exit(1); }

const buf = fs.readFileSync(srcPath);
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');

// ── Parse chunks ────────────────────────────────────────────────────────────
let off = 8;
let ihdr = null;
const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 'IHDR') ihdr = data;
  else if (type === 'IDAT') idat.push(data);
  off += 12 + len;
  if (type === 'IEND') break;
}
const width = ihdr.readUInt32BE(0);
const height = ihdr.readUInt32BE(4);
const bitDepth = ihdr[8];
const colorType = ihdr[9];
const interlace = ihdr[12];
if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
  throw new Error(`unsupported PNG: depth=${bitDepth} color=${colorType} interlace=${interlace}`);
}
const srcCh = colorType === 6 ? 4 : 3;

// ── Inflate + unfilter to raw pixels ────────────────────────────────────────
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = width * srcCh;
const px = Buffer.alloc(height * stride); // unfiltered source channels
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
let pos = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[pos++];
  for (let x = 0; x < stride; x++) {
    const v = raw[pos++];
    const a = x >= srcCh ? px[y * stride + x - srcCh] : 0;
    const b = y > 0 ? px[(y - 1) * stride + x] : 0;
    const c = x >= srcCh && y > 0 ? px[(y - 1) * stride + x - srcCh] : 0;
    let r;
    switch (filter) {
      case 0: r = v; break;
      case 1: r = v + a; break;
      case 2: r = v + b; break;
      case 3: r = v + ((a + b) >> 1); break;
      case 4: r = v + paeth(a, b, c); break;
      default: throw new Error('bad filter ' + filter);
    }
    px[y * stride + x] = r & 0xff;
  }
}

// ── Build RGBA, keying out the white background ─────────────────────────────
// alpha ramps from 0 (pure white, >=250) to 255 (clearly coloured, <=225);
// the in-between band feathers anti-aliased edges so there's no white halo.
const HI = 250, LO = 225;
const out = Buffer.alloc(height * width * 4);
for (let i = 0, j = 0; i < width * height; i++) {
  const base = i * srcCh;
  const r = px[base], g = px[base + 1], b = px[base + 2];
  const m = Math.min(r, g, b);
  let alpha;
  if (m >= HI) alpha = 0;
  else if (m >= LO) alpha = Math.round(((HI - m) / (HI - LO)) * 255);
  else alpha = 255;
  out[j++] = r; out[j++] = g; out[j++] = b; out[j++] = alpha;
}

// ── Re-encode as RGBA PNG ────────────────────────────────────────────────────
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (b) => { let c = ~0; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (~c) >>> 0; };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td), 0);
  return Buffer.concat([len, td, crc]);
}
const newIhdr = Buffer.alloc(13);
newIhdr.writeUInt32BE(width, 0); newIhdr.writeUInt32BE(height, 4);
newIhdr[8] = 8; newIhdr[9] = 6; newIhdr[10] = 0; newIhdr[11] = 0; newIhdr[12] = 0;
const filtered = Buffer.alloc(height * (1 + width * 4));
for (let y = 0; y < height; y++) {
  filtered[y * (1 + width * 4)] = 0; // filter None
  out.copy(filtered, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
}
const png = Buffer.concat([
  SIG,
  chunk('IHDR', newIhdr),
  chunk('IDAT', zlib.deflateSync(filtered, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${width}x${height} RGBA, ${png.length} bytes)`);
