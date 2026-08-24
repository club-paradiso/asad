/**
 * Latency and token telemetry.
 *
 * The Phase 2 question — "is this fast enough to interpret with?" — cannot be
 * answered philosophically, so it is measured. This module holds the
 * measurements.
 *
 * PRIVACY: nothing here ever holds transcript content. Durations, token counts,
 * provider ids and failure kinds only. That is a hard rule, not a preference —
 * see docs/privacy.md.
 */

/** The stages the live path is measured across. */
export type LatencyStage =
  /** Stabilised Korean available → interpretation request dispatched. */
  | "trigger_to_dispatch"
  /** Request dispatched → complete validated provider response. */
  | "provider_response"
  /** Stabilised Korean → safe English available to render. */
  | "stable_to_safe"
  /** Stabilised Korean → anticipated English available to render. */
  | "stable_to_anticipated";

export interface LatencySample {
  stage: LatencyStage;
  ms: number;
  at: number;
  provider?: string;
  model?: string;
}

export interface TokenSample {
  at: number;
  provider: string;
  systemTokens: number;
  contextTokens: number;
  pendingTokens: number;
  outputTokens?: number;
  totalTokens: number;
  /** Whether the provider reported these or we estimated them. */
  reported: boolean;
}

export interface Percentiles {
  count: number;
  p50: number;
  p90: number;
  p95: number;
  max: number;
  mean: number;
}

/** Nearest-rank percentile. Exact for the small samples a session produces. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function summarise(values: number[]): Percentiles {
  if (values.length === 0) {
    return { count: 0, p50: 0, p90: 0, p95: 0, max: 0, mean: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}

/**
 * Service level objectives for live interpretation.
 *
 * These are engineering targets, not guarantees. A provider that misses them is
 * recorded as missing them.
 */
export const LATENCY_SLO = {
  /** Stabilised Korean → safe English on screen. */
  stable_to_safe: { p50: 2500, p95: 4500 },
  /** Provider round trip alone. */
  provider_response: { p50: 1500, p95: 3000 },
} as const;

export interface SloVerdict {
  stage: string;
  target: { p50: number; p95: number };
  actual: Percentiles;
  p50Met: boolean;
  p95Met: boolean;
}

/** Bounded ring buffer — a 70-minute session must not grow without limit. */
const MAX_SAMPLES = 600;

export class TelemetryRecorder {
  private latency: LatencySample[] = [];
  private tokens: TokenSample[] = [];
  private failures = new Map<string, number>();
  private schemaAttempts = 0;
  private schemaFailures = 0;

  recordLatency(sample: Omit<LatencySample, "at"> & { at?: number }): void {
    this.latency.push({ ...sample, at: sample.at ?? Date.now() });
    if (this.latency.length > MAX_SAMPLES) this.latency.shift();
  }

  recordTokens(sample: Omit<TokenSample, "at"> & { at?: number }): void {
    this.tokens.push({ ...sample, at: sample.at ?? Date.now() });
    if (this.tokens.length > MAX_SAMPLES) this.tokens.shift();
  }

  recordFailure(kind: string): void {
    this.failures.set(kind, (this.failures.get(kind) ?? 0) + 1);
  }

  recordSchemaResult(ok: boolean): void {
    this.schemaAttempts += 1;
    if (!ok) this.schemaFailures += 1;
  }

  stage(stage: LatencyStage, provider?: string): Percentiles {
    return summarise(
      this.latency
        .filter((s) => s.stage === stage && (!provider || s.provider === provider))
        .map((s) => s.ms),
    );
  }

  /** Whether the measured latency meets the SLO. */
  sloVerdicts(): SloVerdict[] {
    return (Object.keys(LATENCY_SLO) as Array<keyof typeof LATENCY_SLO>).map((stage) => {
      const actual = this.stage(stage);
      const target = LATENCY_SLO[stage];
      return {
        stage,
        target,
        actual,
        // An empty sample set has not met anything — do not report a pass we
        // did not measure.
        p50Met: actual.count > 0 && actual.p50 <= target.p50,
        p95Met: actual.count > 0 && actual.p95 <= target.p95,
      };
    });
  }

  get schemaSuccessRate(): number | null {
    return this.schemaAttempts === 0
      ? null
      : (this.schemaAttempts - this.schemaFailures) / this.schemaAttempts;
  }

  tokenSummary() {
    if (this.tokens.length === 0) return null;
    const totals = this.tokens.map((t) => t.totalTokens);
    const reported = this.tokens.filter((t) => t.reported).length;
    return {
      calls: this.tokens.length,
      perCall: summarise(totals),
      sessionTotal: totals.reduce((a, b) => a + b, 0),
      reportedFraction: reported / this.tokens.length,
      lastBreakdown: this.tokens[this.tokens.length - 1],
    };
  }

  snapshot() {
    return {
      latency: {
        trigger_to_dispatch: this.stage("trigger_to_dispatch"),
        provider_response: this.stage("provider_response"),
        stable_to_safe: this.stage("stable_to_safe"),
        stable_to_anticipated: this.stage("stable_to_anticipated"),
      },
      slo: this.sloVerdicts(),
      tokens: this.tokenSummary(),
      schemaSuccessRate: this.schemaSuccessRate,
      failures: Object.fromEntries(this.failures),
    };
  }

  reset(): void {
    this.latency = [];
    this.tokens = [];
    this.failures.clear();
    this.schemaAttempts = 0;
    this.schemaFailures = 0;
  }
}

/**
 * Estimate tokens for Korean/English mixed text.
 *
 * Korean is roughly 1.4 characters per token; English closer to 4. Splitting
 * the difference by script gives a usable estimate without a tokenizer
 * dependency, which matters because this runs on every live turn.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let hangul = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0xac00 && code <= 0xd7a3) hangul += 1;
  }
  const other = text.length - hangul;
  return Math.ceil(hangul / 1.4 + other / 4);
}

/** Process-wide recorder. One small web app; no store needed. */
export const telemetry = new TelemetryRecorder();
