export type InputLevelState = "silent" | "low" | "good" | "hot";

export interface InputLevelReading {
  rms: number;
  meter: number;
  state: InputLevelState;
  label: string;
}

/**
 * Turn a time-domain RMS value into a deliberately coarse booth-facing meter.
 *
 * This is not a calibrated dBFS meter. Browser capture paths and USB devices
 * vary too much for fake precision to be useful. The interpreter only needs to
 * know whether the selected feed is absent, weak, usable, or likely clipping.
 */
export function classifyInputLevel(rms: number): InputLevelReading {
  const safe = Number.isFinite(rms) ? Math.max(0, rms) : 0;
  const meter = Math.min(1, safe * 5);

  if (safe < 0.008) {
    return { rms: safe, meter, state: "silent", label: "No signal" };
  }
  if (safe < 0.025) {
    return { rms: safe, meter, state: "low", label: "Signal is low" };
  }
  if (safe < 0.22) {
    return { rms: safe, meter, state: "good", label: "Signal looks usable" };
  }
  return { rms: safe, meter, state: "hot", label: "Signal is very hot" };
}

export function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}
