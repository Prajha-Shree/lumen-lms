// Generates the PWA PNG icons from the logo geometry, with no image dependencies.
//   node scripts/generate-icons.mjs
// Output: public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, draw) {
  const px = Buffer.alloc(size * size * 4);
  draw((x, y, [r, g, b, a]) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  });
  // Each scanline is prefixed with filter byte 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const VIOLET = [0x5b, 0x4d, 0xe0, 255];
const WHITE = [255, 255, 255, 255];
const GOLD = [0xff, 0xd1, 0x66, 255];

/** Draws the logo on a 32-unit grid (same geometry as public/favicon.svg), 4× supersampled. */
function logo(size, { maskable = false } = {}) {
  const pad = maskable ? size * 0.1 : 0; // keep the mark inside the maskable safe zone
  const unit = (size - (maskable ? 0 : 0)) / 32;
  const inner = (size - 2 * pad) / 32;
  return png(size, (set) => {
    const S = 4;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const acc = [0, 0, 0, 0];
        for (let sy = 0; sy < S; sy++) {
          for (let sx = 0; sx < S; sx++) {
            const px = x + (sx + 0.5) / S;
            const py = y + (sy + 0.5) / S;
            let c = [0, 0, 0, 0];
            // Background: full-bleed for maskable, rounded square otherwise.
            const bx = px / unit, by = py / unit, r = 8;
            const dx = Math.max(r - bx, 0, bx - (32 - r)), dy = Math.max(r - by, 0, by - (32 - r));
            if (maskable || dx * dx + dy * dy <= r * r) c = VIOLET;
            // Mark, scaled into the (possibly padded) inner box.
            const ux = (px - pad) / inner, uy = (py - pad) / inner;
            const inL = (ux >= 9 && ux <= 12 && uy >= 10 && uy <= 22) || (ux >= 9 && ux <= 19 && uy >= 19.5 && uy <= 22);
            if (inL) c = WHITE;
            if ((ux - 22.5) ** 2 + (uy - 11.5) ** 2 <= 2.5 ** 2) c = GOLD;
            for (let k = 0; k < 4; k++) acc[k] += c[k];
          }
        }
        set(x, y, acc.map((v) => Math.round(v / (S * S))));
      }
    }
  });
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', logo(192));
writeFileSync('public/icons/icon-512.png', logo(512));
writeFileSync('public/icons/maskable-512.png', logo(512, { maskable: true }));
writeFileSync('public/icons/apple-touch-icon.png', logo(180, { maskable: true }));
console.log('Icons written to public/icons/');
