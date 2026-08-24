/**
 * Generates the PWA icons.
 *
 * Written as a raw PNG encoder rather than pulling in a rasteriser: the mark
 * is three stacked bars — the committed / current / anticipated chunk states
 * that the whole product is built around — and drawing that needs a pixel
 * buffer, not a canvas library.
 *
 * Run with `npm run icons`.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const BG = [0x06, 0x08, 0x0b];
const COMMITTED = [0x5d, 0x68, 0x74];
const CURRENT = [0xf0, 0xb4, 0x29];
const ANTICIPATED = [0x33, 0x3c, 0x47];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Draw the mark: three horizontal bars of decreasing prominence, the middle
 * one live amber, inside a rounded field.
 *
 * `inset` reserves the maskable safe area (icons get cropped to a circle on
 * Android, so the mark has to live inside the middle 80%).
 */
function drawIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : size * 0.22;

  const put = (x, y, [r, g, b], a = 255) => {
    const i = (y * size + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = a;
  };

  const insideRounded = (x, y) => {
    if (radius <= 0) return true;
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (insideRounded(x + 0.5, y + 0.5)) put(x, y, BG);
      else put(x, y, BG, 0);
    }
  }

  // Safe area: maskable icons keep the mark inside the middle 80%.
  const pad = maskable ? size * 0.26 : size * 0.2;
  const inner = size - pad * 2;
  const barHeight = inner * 0.15;
  const gap = inner * 0.115;
  const totalHeight = barHeight * 3 + gap * 2;
  const top = (size - totalHeight) / 2;
  const corner = barHeight / 2;

  const bars = [
    { colour: COMMITTED, width: inner * 0.62 },
    { colour: CURRENT, width: inner },
    { colour: ANTICIPATED, width: inner * 0.44 },
  ];

  bars.forEach((bar, index) => {
    const y0 = top + index * (barHeight + gap);
    const x0 = pad;
    for (let y = Math.floor(y0); y < Math.ceil(y0 + barHeight); y += 1) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + bar.width); x += 1) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        // Round the bar ends.
        const localX = x + 0.5 - x0;
        const localY = y + 0.5 - y0;
        const cx = Math.min(Math.max(localX, corner), bar.width - corner);
        const cy = Math.min(Math.max(localY, corner), barHeight - corner);
        const dx = localX - cx;
        const dy = localY - cy;
        if (dx * dx + dy * dy > corner * corner) continue;
        put(x, y, bar.colour);
      }
    }
  });

  return encodePng(size, size, rgba);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "icon-192.png"), drawIcon(192));
writeFileSync(join(OUT, "icon-512.png"), drawIcon(512));
writeFileSync(join(OUT, "icon-maskable-512.png"), drawIcon(512, { maskable: true }));
writeFileSync(join(OUT, "favicon.png"), drawIcon(64));
console.log("Wrote icons to public/icons");
