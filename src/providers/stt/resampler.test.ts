import { describe, expect, it } from "vitest";
import { Resampler, designLowPass, frameLevel } from "./audio";

/** Push a sine through the resampler in AudioWorklet-sized (128) quanta. */
function run(fromRate: number, hz: number, seconds: number, amplitude = 0.5): Float32Array {
  const resampler = new Resampler(fromRate, 16_000);
  const total = Math.floor(fromRate * seconds);
  const pieces: Float32Array[] = [];
  let length = 0;
  for (let start = 0; start + 128 <= total; start += 128) {
    const block = new Float32Array(128);
    for (let i = 0; i < 128; i += 1) {
      block[i] = amplitude * Math.sin((2 * Math.PI * hz * (start + i)) / fromRate);
    }
    const out = resampler.process(block);
    pieces.push(out);
    length += out.length;
  }
  const joined = new Float32Array(length);
  let offset = 0;
  for (const piece of pieces) {
    joined.set(piece, offset);
    offset += piece.length;
  }
  return joined;
}

const rms = (samples: Float32Array, skip = 0) => {
  let sum = 0;
  for (let i = skip; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length - skip));
};

/** Frequency estimate from zero crossings, in Hz at the OUTPUT rate. */
const zeroCrossingHz = (samples: Float32Array, rate: number) => {
  let crossings = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if ((samples[i - 1] < 0) !== (samples[i] < 0)) crossings += 1;
  }
  return crossings / 2 / (samples.length / rate);
};

describe("Resampler", () => {
  it("emits exactly the target rate across 128-sample quanta at 48 kHz", () => {
    // 750 quanta = 96,000 input samples = 2.000 s → 32,000 output samples.
    // The stateless floor-per-call resampler emitted 42 × 750 = 31,500, i.e. a
    // stream labelled 16 kHz that carried 15,750 samples per second.
    const out = run(48_000, 1_000, 2);
    expect(out.length).toBe(32_000);
  });

  it("emits the target rate across quanta at 44.1 kHz, where the ratio is fractional", () => {
    const blocks = Math.floor((44_100 * 2) / 128); // 689 quanta
    const out = run(44_100, 1_000, 2);
    const expected = (blocks * 128) / (44_100 / 16_000);
    expect(Math.abs(out.length - expected)).toBeLessThanOrEqual(1);
  });

  it("preserves pitch: a 1 kHz tone stays 1 kHz instead of drifting 1.6% sharp", () => {
    const out = run(48_000, 1_000, 2);
    expect(zeroCrossingHz(out, 16_000)).toBeCloseTo(1_000, -1); // within ±5 Hz
  });

  it("passes the speech band at full level", () => {
    const out = run(48_000, 1_000, 1);
    // Skip the first frame so the filter's start-up transient is excluded.
    expect(rms(out, 800)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("removes content that would alias into the speech band", () => {
    // 12 kHz at 48 kHz sits exactly on the alias of 4 kHz at 16 kHz. Plain
    // decimation delivered it to the recogniser at full level; it must now be
    // below -40 dB relative to the passband.
    const passband = rms(run(48_000, 1_000, 1), 800);
    const aliased = rms(run(48_000, 12_000, 1), 800);
    expect(20 * Math.log10(aliased / passband)).toBeLessThan(-40);
  });

  it("also attenuates a 44.1 kHz source's near-Nyquist content", () => {
    const passband = rms(run(44_100, 1_000, 1), 800);
    const aliased = rms(run(44_100, 11_000, 1), 800);
    expect(20 * Math.log10(aliased / passband)).toBeLessThan(-40);
  });

  it("is a pass-through at the target rate and below", () => {
    const same = new Resampler(16_000, 16_000);
    const input = new Float32Array([0.1, -0.2, 0.3]);
    expect(same.process(input)).toBe(input);
    expect(new Resampler(8_000, 16_000).process(input)).toBe(input);
  });

  it("handles quanta shorter than the filter without losing continuity", () => {
    const resampler = new Resampler(48_000, 16_000);
    let total = 0;
    for (let i = 0; i < 300; i += 1) total += resampler.process(new Float32Array(16)).length;
    expect(total).toBe((300 * 16) / 3);
  });

  it("designs a unity-gain low-pass", () => {
    const taps = designLowPass(0.15, 47);
    const sum = Array.from(taps).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(taps[23]).toBeGreaterThan(taps[0]);
  });
});

describe("frameLevel", () => {
  it("reports rms and peak for a frame", () => {
    const level = frameLevel([0.5, -0.5, 0.5, -0.5], 1234);
    expect(level.rms).toBeCloseTo(0.5, 6);
    expect(level.peak).toBe(0.5);
    expect(level.at).toBe(1234);
  });

  it("is zero for an empty frame", () => {
    expect(frameLevel([], 0)).toEqual({ rms: 0, peak: 0, at: 0 });
  });
});
