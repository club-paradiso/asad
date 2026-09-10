/**
 * Rate-limit and quota tracking.
 *
 * Free tiers are where this earns its keep. Minute-level limits are useful hard
 * routing signals because this process can measure them accurately. Daily
 * request caps are different when a provider ALSO publishes a minute-level
 * limit: on serverless a single process sees only part of the account's daily
 * traffic, and OpenRouter's free-model daily allowance can change with account
 * funding. Treating that local estimate as an authoritative hard stop can bench
 * a healthy provider while the account still has capacity.
 *
 * A provider whose ONLY documented request ceiling is daily keeps the historic
 * hard-cap behaviour. There is no stronger provider-specific scheduling signal
 * available in that case, and preserving it avoids silently weakening other
 * adapters while fixing OpenRouter's mixed RPM+RPD case.
 *
 * NOTHING here stores transcript content. Counts and timestamps only.
 */
import type { FreeTierQuota } from "./capabilities";
import type { LlmProviderId, RateLimitSnapshot } from "./types";

export interface QuotaPressure {
  /**
   * Enforceable 0–1 pressure. Existing router callers intentionally read this
   * field, so it contains only signals safe enough to make routing decisions.
   */
  level: number;
  /** Max pressure including advisory daily estimates, for diagnostics only. */
  advisoryLevel: number;
  /** Binding enforceable limit, when one exists. */
  binding?: "rpm" | "tpm" | "rpd";
  /** Human-readable detail for the enforceable score. */
  detail: string;
  /** Advisory daily detail, when RPD is known but not enforceable. */
  advisoryDetail?: string;
}

interface Window {
  startedAt: number;
  requests: number;
  tokens: number;
}

interface PressureScore {
  level: number;
  hard: boolean;
  binding?: "rpm" | "tpm" | "rpd";
  detail: string;
}

/**
 * Tracks our own usage against a provider's documented free-tier quota, and
 * folds in whatever the provider tells us via headers.
 */
export class RateLimitTracker {
  private minute: Window;
  private day: Window;
  private observed?: RateLimitSnapshot;
  private recent429s: number[] = [];

  constructor(
    readonly provider: LlmProviderId,
    private readonly quota: FreeTierQuota | undefined,
    private readonly now: () => number = Date.now,
  ) {
    const t = this.now();
    this.minute = { startedAt: t, requests: 0, tokens: 0 };
    this.day = { startedAt: t, requests: 0, tokens: 0 };
  }

  private roll(): void {
    const t = this.now();
    if (t - this.minute.startedAt >= 60_000) {
      this.minute = { startedAt: t, requests: 0, tokens: 0 };
    }
    if (t - this.day.startedAt >= 86_400_000) {
      this.day = { startedAt: t, requests: 0, tokens: 0 };
    }
    // Only the last five minutes of 429s are interesting.
    this.recent429s = this.recent429s.filter((at) => t - at < 5 * 60_000);
  }

  recordRequest(tokens: number): void {
    this.roll();
    this.minute.requests += 1;
    this.minute.tokens += tokens;
    this.day.requests += 1;
    this.day.tokens += tokens;
  }

  recordRateLimited(): void {
    this.roll();
    this.recent429s.push(this.now());
  }

  /** Fold in the provider's own view, which outranks our token estimate. */
  observe(snapshot: RateLimitSnapshot | undefined): void {
    if (snapshot) this.observed = snapshot;
  }

  get recentRateLimitCount(): number {
    this.roll();
    return this.recent429s.length;
  }

  /**
   * How close we are to limits.
   *
   * `level` may be used to route away from a provider. `advisoryLevel` may not:
   * for mixed RPM+RPD providers it includes a per-instance daily estimate that
   * is useful on a diagnostics screen but is not an account-wide fact.
   */
  pressure(): QuotaPressure {
    this.roll();

    const scores: PressureScore[] = [];

    // Token headers are useful when the provider's documented limit is TPM and
    // are more authoritative than our pre-dispatch token estimate.
    if (this.observed?.tokensRemaining !== undefined && this.quota?.tokensPerMinute) {
      const used = 1 - this.observed.tokensRemaining / this.quota.tokensPerMinute;
      scores.push({
        level: clamp(used),
        hard: true,
        binding: "tpm",
        detail: `${this.observed.tokensRemaining.toLocaleString()} tokens left this minute (reported).`,
      });
    } else if (this.quota?.tokensPerMinute) {
      scores.push({
        level: clamp(this.minute.tokens / this.quota.tokensPerMinute),
        hard: true,
        binding: "tpm",
        detail: `${this.minute.tokens.toLocaleString()}/${this.quota.tokensPerMinute.toLocaleString()} tokens this minute (estimated).`,
      });
    }

    // Do NOT treat x-ratelimit-remaining-requests as RPM here. Groq documents
    // that header as RPD, and OpenRouter does not promise a common window for
    // it. Our own one-minute counter is unambiguous and cheap.
    if (this.quota?.requestsPerMinute) {
      scores.push({
        level: clamp(this.minute.requests / this.quota.requestsPerMinute),
        hard: true,
        binding: "rpm",
        detail: `${this.minute.requests}/${this.quota.requestsPerMinute} requests this minute (estimated).`,
      });
    }

    if (this.quota?.requestsPerDay) {
      const dailyOnly =
        this.quota.requestsPerMinute === undefined &&
        this.quota.tokensPerMinute === undefined;
      scores.push({
        level: clamp(this.day.requests / this.quota.requestsPerDay),
        hard: dailyOnly,
        binding: "rpd",
        detail: dailyOnly
          ? `${this.day.requests}/${this.quota.requestsPerDay} requests today (estimated).`
          : `${this.day.requests}/${this.quota.requestsPerDay} requests seen by this instance today (advisory).`,
      });
    }

    // A recent 429 is hard evidence that beats any estimate.
    if (this.recent429s.length > 0) {
      scores.push({
        level: Math.min(1, 0.85 + this.recent429s.length * 0.05),
        hard: true,
        detail: `${this.recent429s.length} rate-limit response(s) in the last 5 minutes.`,
      });
    }

    if (scores.length === 0) {
      return {
        level: 0,
        advisoryLevel: 0,
        detail: "No documented quota to track.",
      };
    }

    const hardScores = scores.filter((score) => score.hard);
    const hardWorst = hardScores.length
      ? hardScores.reduce((a, b) => (b.level > a.level ? b : a))
      : undefined;
    const advisoryWorst = scores.reduce((a, b) => (b.level > a.level ? b : a));
    const advisoryDaily = scores.find((score) => score.binding === "rpd" && !score.hard);

    return {
      level: hardWorst?.level ?? 0,
      advisoryLevel: advisoryWorst.level,
      binding: hardWorst?.binding,
      detail: hardWorst?.detail ?? "No documented quota to track.",
      advisoryDetail: advisoryDaily?.detail,
    };
  }

  snapshot() {
    const pressure = this.pressure();
    return {
      provider: this.provider,
      requestsThisMinute: this.minute.requests,
      tokensThisMinute: this.minute.tokens,
      requestsToday: this.day.requests,
      recentRateLimits: this.recent429s.length,
      reported: this.observed,
      pressure,
    };
  }
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Pressure above this means: compact the context. */
export const PRESSURE_COMPACT = 0.6;
/** Pressure above this means: stop using this provider. */
export const PRESSURE_ABANDON = 0.9;
