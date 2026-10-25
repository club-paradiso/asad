/**
 * A model of where a Counter turn's time goes — stated as a model.
 *
 * Nothing in this file is a measurement of a provider or of a network. It is
 * arithmetic over parameters a deployer can measure for themselves (one Redis
 * round trip, one provider response, one poll interval) and over structure the
 * code determines (how many round trips a turn makes, how often the recipient
 * asks). Its job is to make a structural change's effect visible before and
 * after, with the same inputs, and to show which term dominates.
 *
 * The round-trip counts for the "before" column are read from the message
 * route as it stood on `main` at 2e57a0a; the "after" counts are asserted
 * against the real route handler in `latency.bench.test.ts`.
 */

export interface TurnProfile {
  /** Serial Redis round trips on the sender's path before the response. */
  storeRoundTrips: number;
  /** Recipient poll interval while the conversation is live, ms. */
  pollIntervalMs: number;
}

export interface LatencyInputs {
  /** One Redis REST round trip from the function, ms. */
  redisRttMs: number;
  /** Translation provider response, ms (first useful validated answer). */
  providerMs: number;
  /** Browser ↔ function request, one way, ms. */
  networkOneWayMs: number;
  /** Function CPU for validation, risk spans, JSON, ms. */
  cpuMs: number;
}

/** Message route on `main` (2e57a0a): shared limiter, GET, GET+EVAL profile, GET+EVAL persist, vault EVAL. */
export const BEFORE: TurnProfile = { storeRoundTrips: 7, pollIntervalMs: 1200 };
/** This branch: shared limiter, admission GET, persist GET+EVAL; vault write after the response. */
export const AFTER: TurnProfile = { storeRoundTrips: 4, pollIntervalMs: 500 };

export interface TurnEstimate {
  /** Send pressed → sender sees the stored translation. */
  senderVisibleMs: number;
  /** Send pressed → recipient sees the translation, average over poll phase. */
  recipientMeanMs: number;
  /** Same, worst case over poll phase (a poll just missed the write). */
  recipientWorstMs: number;
}

export function estimateTurn(profile: TurnProfile, inputs: LatencyInputs): TurnEstimate {
  const server = profile.storeRoundTrips * inputs.redisRttMs + inputs.providerMs + inputs.cpuMs;
  const senderVisibleMs = 2 * inputs.networkOneWayMs + server;
  // The write lands at the end of `server`; the recipient's next poll starts
  // uniformly within one interval of it and then costs a round trip.
  const pollRoundTrip = 2 * inputs.networkOneWayMs + inputs.redisRttMs;
  const persisted = inputs.networkOneWayMs + server - inputs.redisRttMs; // persist is the last RTT
  return {
    senderVisibleMs: Math.round(senderVisibleMs),
    recipientMeanMs: Math.round(persisted + profile.pollIntervalMs / 2 + pollRoundTrip),
    recipientWorstMs: Math.round(persisted + profile.pollIntervalMs + pollRoundTrip),
  };
}

/** Deterministic LCG so the Monte Carlo below reproduces exactly. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export interface Distribution {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  mean: number;
}

export function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
  return {
    p50: at(50),
    p90: at(90),
    p95: at(95),
    p99: at(99),
    mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}

export interface SimulationInputs {
  turns: number;
  seed: number;
  redisRttMs: { min: number; max: number };
  /** Log-normal-ish provider latency: median and a spread factor. */
  providerMs: { median: number; spread: number };
  networkOneWayMs: { min: number; max: number };
  cpuMs: number;
}

/**
 * Many turns with jittered inputs, to show distributions rather than a single
 * number. Poll phase is uniform over the interval, as it is in reality.
 */
export function simulateRecipientDelivery(profile: TurnProfile, inputs: SimulationInputs): Distribution {
  const random = seeded(inputs.seed);
  const uniform = (min: number, max: number) => min + (max - min) * random();
  const samples: number[] = [];
  for (let turn = 0; turn < inputs.turns; turn += 1) {
    const redis = uniform(inputs.redisRttMs.min, inputs.redisRttMs.max);
    const network = uniform(inputs.networkOneWayMs.min, inputs.networkOneWayMs.max);
    // Box-Muller normal in log space.
    const u = Math.max(1e-9, random());
    const v = random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    const provider = inputs.providerMs.median * Math.exp(z * Math.log(inputs.providerMs.spread));
    const server = profile.storeRoundTrips * redis + provider + inputs.cpuMs;
    const persisted = network + server - redis;
    const phase = random() * profile.pollIntervalMs;
    samples.push(Math.round(persisted + phase + 2 * network + redis));
  }
  return distribution(samples);
}
