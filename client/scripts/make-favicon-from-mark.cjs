/**
 * One-off: extract the square "A" brand mark from the transparent RGBA logo and
 * write it as a square favicon PNG (padded with transparency, no resize — the
 * browser scales it down). The mark is the leftmost cluster of opaque pixels,
 * ending at the first wide fully-transparent column gap before the wordmark.
 *
 *   node client/scripts/make-favicon-from-mark.cjs <logo-rgba.png> <out.png>
 */
const fs = require('fs');
const zlib = require('zlib');

const [, , srcPath, outPath] = process.argv;
if (!srcPath || !outPath) { console.error('usage: <src-rgba> <out>'); process.exit(1); }

const buf = fs.readFileSync(srcPath);
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');

let off = 8, ihdr = null; const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 'IHDR') ihdr = data; else if (type === 'IDAT') idat.push(data);
  off += 12 + len; if (type === 'IEND') break;
}
const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4), colorType = ihdr[9];
if (colorType !== 6) throw new Error('expected RGBA source');

const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = width * 4;
const px = Buffer.alloc(height * stride);
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
let pos = 0;
for (let y = 0; y < height; y++) {
  const f = raw[pos++];
  for (let x = 0; x < stride; x++) {
    const v = raw[pos++];
    const a = x >= 4 ? px[y * stride + x - 4] : 0;
    const b = y > 0 ? px[(y - 1) * stride + x] : 0;
    const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
    let r; switch (f) { case 0: r = v; break; case 1: r = v + a; break; case 2: r = v + b; break; case 3: r = v + ((a + b) >> 1); break; case 4: r = v + paeth(a, b, c); break; default: throw new Error('filter'); }
    px[y * stride + x] = r & 0xff;
  }
}

// Only look at the upper band (mark + wordmark row range). A full-width tagline
// underneath would otherwise bridge the gap between the mark and the wordmark,
// making the detector grab the whole logo. Override via the 3rd CLI arg.
const bandFrac = process.argv[4] ? Number(process.argv[4]) : 0.62;
const bandBottom = Math.max(1, Math.round(height * bandFrac));

// Column opacity counts within the band.
const colOpaque = new Array(width).fill(0);
for (let x = 0; x < width; x++) {
  let n = 0;
  for (let y = 0; y < bandBottom; y++) if (px[(y * width + x) * 4 + 3] > 16) n++;
  colOpaque[x] = n;
}
// Mark start = first opaque column; mark end = first wide transparent gap after it.
let markStart = colOpaque.findIndex((n) => n > 0);
if (markStart < 0) throw new Error('logo is fully transparent');
const GAP = Math.round(width * 0.02); // a real gap between mark and wordmark
let gap = 0, markEnd = width - 1;
for (let x = markStart; x < width; x++) {
  if (colOpaque[x] === 0) { if (++gap >= GAP) { markEnd = x - gap; break; } }
  else gap = 0;
}
// Vertical bounds within the mark columns — band only, so the tagline beneath
// the mark doesn't stretch the crop.
let top = bandBottom, bottom = 0;
for (let y = 0; y < bandBottom; y++) {
  for (let x = markStart; x <= markEnd; x++) {
    if (px[(y * width + x) * 4 + 3] > 16) { if (y < top) top = y; if (y > bottom) bottom = y; break; }
  }
}
const mw = markEnd - markStart + 1, mh = bottom - top + 1;
const side = Math.max(mw, mh);
const padX = Math.floor((side - mw) / 2), padY = Math.floor((side - mh) / 2);

// Compose square RGBA canvas (transparent), centring the mark.
const out = Buffer.alloc(side * side * 4);
for (let y = 0; y < mh; y++) {
  for (let x = 0; x < mw; x++) {
    const s = ((top + y) * width + (markStart + x)) * 4;
    const d = ((padY + y) * side + (padX + x)) * 4;
    out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3];
  }
}

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return (b) => { let c = ~0; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (~c) >>> 0; }; })();
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td), 0); return Buffer.concat([len, td, crc]); };
const newIhdr = Buffer.alloc(13);
newIhdr.writeUInt32BE(side, 0); newIhdr.writeUInt32BE(side, 4);
newIhdr[8] = 8; newIhdr[9] = 6; newIhdr[10] = 0; newIhdr[11] = 0; newIhdr[12] = 0;
const sstride = side * 4;
const filtered = Buffer.alloc(side * (1 + sstride));
for (let y = 0; y < side; y++) { filtered[y * (1 + sstride)] = 0; out.copy(filtered, y * (1 + sstride) + 1, y * sstride, (y + 1) * sstride); }
fs.writeFileSync(outPath, Buffer.concat([SIG, chunk('IHDR', newIhdr), chunk('IDAT', zlib.deflateSync(filtered, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log(`wrote ${outPath} (${side}x${side} square mark)`);
