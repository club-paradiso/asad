import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { encodeQr, qrToSvgPath } from "./qr";
import { joinUrl } from "@/counter/codes";

/**
 * Round-trip the encoder through an INDEPENDENT decoder.
 *
 * Structural assertions (finder patterns in the right places, correct size)
 * would pass on a code that no phone can read. The only assertion worth making
 * about a QR encoder is that something else can decode it — a code that fails
 * silently at a counter is worse than no code.
 */
function decode(text: string, scale = 4): string | null {
  const matrix = encodeQr(text);
  const quiet = 4; // the specification's required quiet zone
  const dimension = (matrix.size + quiet * 2) * scale;

  // RGBA, white background, dark modules painted black.
  const data = new Uint8ClampedArray(dimension * dimension * 4).fill(255);
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.modules[row][col]) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const y = (row + quiet) * scale + dy;
          const x = (col + quiet) * scale + dx;
          const i = (y * dimension + x) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }
  }

  return jsQR(data, dimension, dimension)?.data ?? null;
}

describe("QR encoder round-trip", () => {
  it("encodes a counter join URL that a scanner can read", () => {
    const url = joinUrl("https://tong-yuck.example.com", "AC34");
    expect(decode(url)).toBe(url);
  });

  it("handles the shortest realistic payload", () => {
    expect(decode("https://x.io/c/AC34")).toBe("https://x.io/c/AC34");
  });

  it("handles a long deployment URL", () => {
    const url = joinUrl(
      "https://tong-yuck-preview-abc123def456.some-team.vercel.app",
      "WXYZ",
    );
    expect(decode(url)).toBe(url);
  });

  it("survives at a small render scale, as on a phone screen", () => {
    const url = joinUrl("https://tong-yuck.example.com", "QR79");
    expect(decode(url, 2)).toBe(url);
  });

  it("encodes non-ASCII via UTF-8 byte mode", () => {
    expect(decode("접수 창구 2 · TY-AC34")).toBe("접수 창구 2 · TY-AC34");
  });

  it("picks a version large enough for the payload", () => {
    const short = encodeQr("https://x.io/c/AC34");
    const long = encodeQr(`https://x.io/c/AC34?${"p=1&".repeat(30)}`);
    expect(long.size).toBeGreaterThan(short.size);
    // Version n has size 4n+17, so every size is congruent to 1 mod 4.
    expect((short.size - 17) % 4).toBe(0);
  });

  it("writes decodable BCH version information for version 7 and above", () => {
    // 110 byte-mode characters select version 7-M (size 45).
    const payload = "v".repeat(110);
    const matrix = encodeQr(payload);
    expect(matrix.size).toBe(45);
    expect(decode(payload)).toBe(payload);

    // Version 7's encoded 18-bit value is 0x07C94. The two copies occupy the
    // mirrored 3×6 areas adjacent to the top-right and bottom-left finders.
    const expected = 0x07c94;
    for (let i = 0; i < 18; i += 1) {
      const bit = ((expected >>> i) & 1) === 1;
      const edge = matrix.size - 11 + (i % 3);
      const offset = Math.floor(i / 3);
      expect(matrix.modules[offset][edge]).toBe(bit);
      expect(matrix.modules[edge][offset]).toBe(bit);
    }
  });

  it("refuses oversized input rather than emitting an unscannable code", () => {
    expect(() => encodeQr("x".repeat(1000))).toThrow(/too long/i);
  });
});

describe("SVG rendering", () => {
  it("emits one path covering every dark module", () => {
    const matrix = encodeQr("https://x.io/c/AC34");
    const path = qrToSvgPath(matrix);
    const dark = matrix.modules.flat().filter(Boolean).length;
    expect(path.split("M").length - 1).toBe(dark);
    expect(path.startsWith("M")).toBe(true);
  });
});
