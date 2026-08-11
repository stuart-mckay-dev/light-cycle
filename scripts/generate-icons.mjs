/**
 * Generates the PWA icon set with zero dependencies.
 *
 * Draws a Tron-style light trail procedurally and writes it out as PNG using
 * node's built-in zlib. Re-run with `npm run icons` if the mark changes.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public', 'icons');

const BG = [0x05, 0x07, 0x0d];
const GRID = [0x12, 0x1c, 0x2b];
const TRAIL = [0x00, 0xe5, 0xff];

/** The light-cycle path, in normalised icon space. */
const PATH = [
  [0.14, 0.8],
  [0.46, 0.8],
  [0.46, 0.34],
  [0.84, 0.34],
];

// --- geometry ---------------------------------------------------------------

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function distToPath(px, py) {
  let best = Infinity;
  for (let i = 0; i < PATH.length - 1; i++) {
    best = Math.min(best, distToSegment(px, py, ...PATH[i], ...PATH[i + 1]));
  }
  return best;
}

const mix = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * Math.max(0, Math.min(1, t))));

// --- drawing ----------------------------------------------------------------

function render(size, inset) {
  // `inset` shrinks the artwork for maskable icons, which get cropped to a circle.
  const scale = 1 - inset * 2;
  const rgba = Buffer.alloc(size * size * 4);

  const core = 0.05 * scale;
  const glow = 0.2 * scale;
  const [hx, hy] = PATH[PATH.length - 1];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Pixel centre, mapped back into normalised artwork space.
      const nx = ((x + 0.5) / size - inset) / scale;
      const ny = ((y + 0.5) / size - inset) / scale;

      let color = BG;

      // Faint background grid — reads as a street map.
      const gridDist = Math.min(
        Math.abs((nx * 8) % 1 < 0.5 ? (nx * 8) % 1 : 1 - ((nx * 8) % 1)),
        Math.abs((ny * 8) % 1 < 0.5 ? (ny * 8) % 1 : 1 - ((ny * 8) % 1)),
      );
      if (nx > 0 && nx < 1 && ny > 0 && ny < 1) {
        color = mix(color, GRID, gridDist < 0.02 ? 1 : 0);
      }

      // Trail glow, then the solid core on top.
      const d = distToPath(nx, ny);
      if (d < glow) {
        const falloff = Math.pow(1 - d / glow, 2.2);
        color = mix(color, TRAIL, falloff * 0.55);
      }
      if (d < core) {
        color = mix(color, TRAIL, 1);
      }

      // Bright head at the leading end of the trail.
      const headDist = Math.hypot(nx - hx, ny - hy);
      if (headDist < core * 1.9) {
        color = mix(color, [0xff, 0xff, 0xff], 1 - headDist / (core * 1.9));
      }

      const o = (y * size + x) * 4;
      rgba[o] = color[0];
      rgba[o + 1] = color[1];
      rgba[o + 2] = color[2];
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  // Prefix every scanline with filter type 0 (none).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- output -----------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const icons = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 0.12],
  ['apple-touch-icon.png', 180, 0],
];

for (const [name, size, inset] of icons) {
  const png = encodePng(size, render(size, inset));
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
