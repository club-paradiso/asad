/**
 * Audio codec for the Remote Microphone server relay.
 *
 * 16 kHz mono G.711 µ-law: 16 KB/s, decodable in a few lines anywhere, and
 * the format telephone-grade speech recognition was built on. Twice smaller
 * than PCM16, which matters because every relay byte goes through the shared
 * store twice. Pure functions — no Web Audio here — so they are tested in node.
 */

const BIAS = 0x84;
const CLIP = 32635;

/** One linear PCM16 sample → one µ-law byte (ITU-T G.711). */
export function linearToMulaw(sample: number): number {
  let value = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = value < 0 ? 0x80 : 0;
  if (sign) value = -value;
  if (value > CLIP) value = CLIP;
  value += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (value & mask) === 0 && exponent > 0; mask >>= 1) exponent -= 1;
  const mantissa = (value >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** One µ-law byte → linear PCM16. */
export function mulawToLinear(byte: number): number {
  const value = ~byte & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  const magnitude = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return sign ? -magnitude : magnitude;
}

const DECODE_TABLE = (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) table[i] = mulawToLinear(i) / 32768;
  return table;
})();

export function encodeMulaw(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    out[i] = linearToMulaw(clamped * 32767);
  }
  return out;
}

export function decodeMulaw(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) out[i] = DECODE_TABLE[bytes[i]];
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Streaming downsampler (any rate → 16 kHz). Each output sample is the mean
 * of the input span it covers: a box filter, crude but enough to keep speech
 * above 8 kHz from folding back into the band recognisers use. Keeps its
 * fractional position between calls, so chunk boundaries add no clicks.
 */
export class Downsampler {
  private readonly ratio: number;
  private position = 0;
  private carrySum = 0;
  private carryCount = 0;

  constructor(inputRate: number, readonly outputRate: number) {
    if (!(inputRate > 0) || !(outputRate > 0)) throw new Error("Invalid sample rate.");
    this.ratio = inputRate / outputRate;
  }

  process(input: Float32Array): Float32Array {
    if (this.ratio <= 1) return input.slice();
    const out: number[] = [];
    let sum = this.carrySum;
    let count = this.carryCount;
    for (let i = 0; i < input.length; i += 1) {
      sum += input[i];
      count += 1;
      this.position += 1;
      if (this.position >= this.ratio) {
        out.push(sum / count);
        this.position -= this.ratio;
        sum = 0;
        count = 0;
      }
    }
    this.carrySum = sum;
    this.carryCount = count;
    return Float32Array.from(out);
  }
}

/** Collects samples and emits fixed-size frames. */
export class FrameAccumulator {
  private buffer: Float32Array;
  private filled = 0;

  constructor(readonly frameSize: number) {
    this.buffer = new Float32Array(frameSize);
  }

  push(samples: Float32Array, emit: (frame: Float32Array) => void) {
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(this.frameSize - this.filled, samples.length - offset);
      this.buffer.set(samples.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.frameSize) {
        emit(this.buffer);
        this.buffer = new Float32Array(this.frameSize);
        this.filled = 0;
      }
    }
  }
}
