import { describe, expect, it } from "vitest";
import {
  Downsampler,
  FrameAccumulator,
  base64ToBytes,
  bytesToBase64,
  decodeMulaw,
  encodeMulaw,
  linearToMulaw,
  mulawToLinear,
} from "./relay-codec";

describe("relay µ-law codec", () => {
  it("matches the G.711 reference points", () => {
    expect(linearToMulaw(0)).toBe(0xff);
    expect(linearToMulaw(-1)).toBe(0x7f);
    expect(linearToMulaw(32767)).toBe(0x80);
    expect(linearToMulaw(-32768)).toBe(0x00);
    expect(mulawToLinear(0xff)).toBe(0);
    expect(mulawToLinear(0x80)).toBe(32124);
    expect(mulawToLinear(0x00)).toBe(-32124);
  });

  it("round-trips speech-level samples within µ-law's quantisation error", () => {
    const samples = Float32Array.from({ length: 1600 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 16000));
    const decoded = decodeMulaw(encodeMulaw(samples));
    let signal = 0;
    let noise = 0;
    for (let i = 0; i < samples.length; i += 1) {
      signal += samples[i] ** 2;
      noise += (samples[i] - decoded[i]) ** 2;
    }
    const snrDb = 10 * Math.log10(signal / noise);
    expect(snrDb).toBeGreaterThan(30);
  });

  it("clamps out-of-range input instead of wrapping", () => {
    const decoded = decodeMulaw(encodeMulaw(Float32Array.from([2, -2])));
    expect(decoded[0]).toBeGreaterThan(0.95);
    expect(decoded[1]).toBeLessThan(-0.95);
  });

  it("base64 round-trips binary frames, including large ones", () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 37) % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe("relay downsampler and framing", () => {
  it("produces 16 kHz from 48 kHz and 44.1 kHz with no drift across chunks", () => {
    for (const rate of [48_000, 44_100]) {
      const down = new Downsampler(rate, 16_000);
      let produced = 0;
      for (let chunk = 0; chunk < 100; chunk += 1) produced += down.process(new Float32Array(4096)).length;
      const expected = (100 * 4096 * 16_000) / rate;
      expect(Math.abs(produced - expected)).toBeLessThanOrEqual(1);
    }
  });

  it("keeps a DC level and averages away content above the new band", () => {
    const down = new Downsampler(48_000, 16_000);
    expect([...down.process(new Float32Array(300).fill(0.25))].every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true);
    // 16 kHz tone at 48 kHz (period 3 samples) is removed by the 3-sample box.
    const tone = Float32Array.from({ length: 3000 }, (_, i) => Math.sin((2 * Math.PI * i) / 3));
    const out = new Downsampler(48_000, 16_000).process(tone);
    expect(Math.max(...out.map(Math.abs))).toBeLessThan(1e-6);
  });

  it("emits exact-size frames across uneven pushes", () => {
    const frames: number[] = [];
    const acc = new FrameAccumulator(4800);
    for (const size of [1000, 3000, 2000, 5000, 400]) acc.push(new Float32Array(size), (f) => frames.push(f.length));
    expect(frames).toEqual([4800, 4800]);
  });
});
