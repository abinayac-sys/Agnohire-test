/**
 * One-off: derive a dark-mode variant of the (transparent RGBA) logo. Only the
 * near-black / navy pixels (the "Agno" wordmark) are lifted to white; the blue
 * mark and "Hire" keep their brand colour. This stays readable on dark sidebars
 * without flattening the whole logo to white.
 *
 *   node client/scripts/make-logo-dark-variant.cjs <src-rgba.png> <out.png>
 */
const fs = require('fs');
const zlib = require('zlib');

const [, , srcPath, outPath] = process.argv;
const buf = fs.readFileSync(srcPath);
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

// Lift only dark/navy pixels toward white; leave coloured (blue) pixels alone.
// "blueness" guards the mark/"Hire": if blue clearly dominates, keep the colour.
const LUM_DARK = 90; // perceived-luminance cutoff for "this is dark text"
for (let i = 0; i < width * height; i++) {
  const o = i * 4;
  const r = px[o], g = px[o + 1], b = px[o + 2], al = px[o + 3];
  if (al === 0) continue;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const blueDominant = b > r + 35 && b > 90; // brand blue → keep
  if (lum < LUM_DARK && !blueDominant) {
    // Blend toward white proportional to how dark it is (keeps anti-aliased
    // edges smooth instead of hard-switching).
    const t = Math.min(1, (LUM_DARK - lum) / LUM_DARK);
    px[o] = Math.round(r + (255 - r) * t);
    px[o + 1] = Math.round(g + (255 - g) * t);
    px[o + 2] = Math.round(b + (255 - b) * t);
  }
}

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return (b) => { let c = ~0; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (~c) >>> 0; }; })();
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td), 0); return Buffer.concat([len, td, crc]); };
const filtered = Buffer.alloc(height * (1 + stride));
for (let y = 0; y < height; y++) { filtered[y * (1 + stride)] = 0; px.copy(filtered, y * (1 + stride) + 1, y * stride, (y + 1) * stride); }
fs.writeFileSync(outPath, Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(filtered, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log(`wrote ${outPath} (dark-mode variant ${width}x${height})`);
