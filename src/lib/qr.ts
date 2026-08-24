/**
 * Minimal QR code encoder.
 *
 * Written rather than pulled in as a dependency for one reason that matters
 * here: the QR encodes a URL that opens a private conversation, and generating
 * it client-side means no image service and no third party ever sees the code.
 *
 * Scope is exactly what Counter Mode needs and no more — byte mode, error
 * correction level M, versions 1–10, which comfortably covers a join URL of up
 * to ~200 characters. Anything larger throws rather than silently producing an
 * unscannable code.
 */

/* --- Galois field arithmetic (GF(256), primitive polynomial 0x11d) ------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const mul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];

/** Reed–Solomon generator polynomial of the given degree. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= mul(poly[j], 1);
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function reedSolomon(data: number[], eccLength: number): number[] {
  const generator = generatorPoly(eccLength);
  const remainder = new Array<number>(eccLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let i = 0; i < generator.length - 1; i += 1) {
        remainder[i] ^= mul(generator[i + 1], factor);
      }
    }
  }
  return remainder;
}

/* --- Version tables (error correction level M) ---------------------------- */

/** [total codewords, ecc per block, group1 blocks, group1 data, g2 blocks, g2 data] */
const VERSIONS: Array<[number, number, number, number, number, number]> = [
  [26, 10, 1, 16, 0, 0], // 1
  [44, 16, 1, 28, 0, 0], // 2
  [70, 26, 1, 44, 0, 0], // 3
  [100, 18, 2, 32, 0, 0], // 4
  [134, 24, 2, 43, 0, 0], // 5
  [172, 16, 4, 27, 0, 0], // 6
  [196, 18, 4, 31, 0, 0], // 7
  [242, 22, 2, 38, 2, 39], // 8
  [292, 22, 3, 36, 2, 37], // 9
  [346, 26, 4, 43, 1, 44], // 10
];

const ALIGNMENT: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

const size = (version: number) => version * 4 + 17;

const capacity = (version: number): number => {
  const [total, ecc, g1, g1d, g2, g2d] = VERSIONS[version - 1];
  void total;
  void ecc;
  return g1 * g1d + g2 * g2d;
};

/* --- Encoding ------------------------------------------------------------- */

class BitBuffer {
  private bits: number[] = [];
  put(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }
  get length(): number {
    return this.bits.length;
  }
  padToByte(): void {
    while (this.bits.length % 8 !== 0) this.bits.push(0);
  }
  toBytes(): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (this.bits[i + j] ?? 0);
      bytes.push(byte);
    }
    return bytes;
  }
}

function encodeData(text: string, version: number): number[] {
  const utf8 = new TextEncoder().encode(text);
  const buffer = new BitBuffer();
  buffer.put(0b0100, 4); // byte mode
  buffer.put(utf8.length, version <= 9 ? 8 : 16);
  for (const byte of utf8) buffer.put(byte, 8);

  const dataCapacity = capacity(version) * 8;
  // Terminator, up to four zero bits.
  buffer.put(0, Math.min(4, Math.max(0, dataCapacity - buffer.length)));
  buffer.padToByte();

  const bytes = buffer.toBytes();
  // Alternating pad bytes, per the specification.
  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (bytes.length < capacity(version)) {
    bytes.push(PAD[padIndex % 2]);
    padIndex += 1;
  }
  return bytes;
}

/** Interleave data and ECC blocks in the order the spec requires. */
function buildCodewords(data: number[], version: number): number[] {
  const [, eccLength, g1, g1d, g2, g2d] = VERSIONS[version - 1];
  const blocks: Array<{ data: number[]; ecc: number[] }> = [];

  let offset = 0;
  for (let i = 0; i < g1; i += 1) {
    const slice = data.slice(offset, offset + g1d);
    offset += g1d;
    blocks.push({ data: slice, ecc: reedSolomon(slice, eccLength) });
  }
  for (let i = 0; i < g2; i += 1) {
    const slice = data.slice(offset, offset + g2d);
    offset += g2d;
    blocks.push({ data: slice, ecc: reedSolomon(slice, eccLength) });
  }

  const out: number[] = [];
  const maxData = Math.max(g1d, g2d);
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  }
  for (let i = 0; i < eccLength; i += 1) {
    for (const block of blocks) out.push(block.ecc[i]);
  }
  return out;
}

/* --- Matrix --------------------------------------------------------------- */

type Cell = 0 | 1 | null;

function buildMatrix(codewords: number[], version: number, mask: number): Cell[][] {
  const n = size(version);
  const matrix: Cell[][] = Array.from({ length: n }, () => new Array<Cell>(n).fill(null));
  const reserved: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));

  const place = (row: number, col: number, value: Cell, reserve = true) => {
    matrix[row][col] = value;
    if (reserve) reserved[row][col] = true;
  };

  // Finder patterns plus separators.
  const finder = (top: number, left: number) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const row = top + r;
        const col = left + c;
        if (row < 0 || row >= n || col < 0 || col >= n) continue;
        const on =
          r >= 0 && r <= 6 && (c === 0 || c === 6) ? 1
          : c >= 0 && c <= 6 && (r === 0 || r === 6) ? 1
          : r >= 2 && r <= 4 && c >= 2 && c <= 4 ? 1
          : 0;
        place(row, col, on as Cell);
      }
    }
  };
  finder(0, 0);
  finder(0, n - 7);
  finder(n - 7, 0);

  // Timing patterns.
  for (let i = 8; i < n - 8; i += 1) {
    place(6, i, (i % 2 === 0 ? 1 : 0) as Cell);
    place(i, 6, (i % 2 === 0 ? 1 : 0) as Cell);
  }

  // Alignment patterns.
  const centres = ALIGNMENT[version];
  for (const r of centres) {
    for (const c of centres) {
      // Skip the three that would collide with the finders.
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0;
          place(r + dr, c + dc, on as Cell);
        }
      }
    }
  }

  // Dark module.
  place(n - 8, 8, 1);

  // Reserve format information areas.
  for (let i = 0; i < 9; i += 1) {
    if (matrix[8][i] === null) place(8, i, 0);
    if (matrix[i][8] === null) place(i, 8, 0);
  }
  for (let i = 0; i < 8; i += 1) {
    if (matrix[8][n - 1 - i] === null) place(8, n - 1 - i, 0);
    if (matrix[n - 1 - i][8] === null) place(n - 1 - i, 8, 0);
  }

  // Data, snaking up and down in two-column strips.
  let bitIndex = 0;
  let upward = true;
  for (let right = n - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1; // skip the vertical timing column
    for (let step = 0; step < n; step += 1) {
      const row = upward ? n - 1 - step : step;
      for (let c = 0; c < 2; c += 1) {
        const col = right - c;
        if (reserved[row][col]) continue;
        const byte = codewords[bitIndex >>> 3] ?? 0;
        let bit = (byte >>> (7 - (bitIndex & 7))) & 1;
        bitIndex += 1;
        if (maskAt(mask, row, col)) bit ^= 1;
        matrix[row][col] = bit as Cell;
      }
    }
    upward = !upward;
  }

  writeFormat(matrix, mask, n);
  return matrix;
}

function maskAt(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

/** Format information for error correction level M, with BCH and masking. */
function writeFormat(matrix: Cell[][], mask: number, n: number): void {
  const data = (0b00 << 3) | mask; // 00 = level M
  let bits = data << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if (bits & (1 << (i + 10))) bits ^= 0b10100110111 << i;
  }
  const format = ((data << 10) | bits) ^ 0b101010000010010;

  for (let i = 0; i < 15; i += 1) {
    const bit = ((format >>> (14 - i)) & 1) as Cell;
    // Around the top-left finder.
    if (i < 6) matrix[8][i] = bit;
    else if (i === 6) matrix[8][7] = bit;
    else if (i === 7) matrix[8][8] = bit;
    else if (i === 8) matrix[7][8] = bit;
    else matrix[14 - i][8] = bit;
    // Duplicated along the other two finders.
    if (i < 8) matrix[n - 1 - i][8] = bit;
    else matrix[8][n - 15 + i] = bit;
  }
}

/* --- Public API ----------------------------------------------------------- */

export interface QrMatrix {
  size: number;
  /** Row-major; true means a dark module. */
  modules: boolean[][];
}

/**
 * Encode text as a QR matrix.
 *
 * Throws for input too large for version 10 rather than emitting something
 * that will not scan — a QR that fails silently at a counter is worse than an
 * error at build time.
 */
export function encodeQr(text: string): QrMatrix {
  const byteLength = new TextEncoder().encode(text).length;

  let version = 0;
  for (let v = 1; v <= VERSIONS.length; v += 1) {
    const headerBytes = v <= 9 ? 2 : 3;
    if (byteLength + headerBytes <= capacity(v)) {
      version = v;
      break;
    }
  }
  if (version === 0) {
    throw new Error(`Text is too long for a QR code of version ≤10 (${byteLength} bytes).`);
  }

  const codewords = buildCodewords(encodeData(text, version), version);
  // Mask 0 is deterministic and adequate here: the payload is a short URL and
  // full mask-penalty evaluation would be a lot of code for no scan benefit.
  const matrix = buildMatrix(codewords, version, 0);

  return {
    size: size(version),
    modules: matrix.map((row) => row.map((cell) => cell === 1)),
  };
}

/**
 * Render a QR matrix as an SVG path string.
 *
 * One path for the whole code keeps the DOM tiny even at 45×45 modules.
 */
export function qrToSvgPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (matrix.modules[row][col]) parts.push(`M${col} ${row}h1v1h-1z`);
    }
  }
  return parts.join("");
}
