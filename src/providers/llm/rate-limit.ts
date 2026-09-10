/**
 * Rate-limit and quota tracking.
 *
 * Free tiers are where this earns its keep. Minute-level limits are useful hard
 * routing signals because this process can measure them accurately. Daily
 * request caps are different: on serverless a single process sees only part of
 * the account's traffic, and OpenRouter's free-model allowance also changes
 * with account funding. Treating that local estimate as an authoritative hard
 * stop can bench a healthy provider while the account still has capacity.
 *
 * NOTHING here stores transcript content. Counts and timestamps only.
 */
import type { FreeTierQuota } from "./capabilities";
import type { LlmProviderId, RateLimitSnapshot } from "./types";

export interface QuotaPressure {
  /** 0 = plenty of headroom, 1 = at the closest known limit. */
  level: number;
  /**
   * Highest pressure backed by a limit this process can safely enforce.
   *
   * RPM/TPM and recent 429s are hard evidence. A locally estimated RPD is not:
   * serverless instances do not share that counter and some provider plans can
   * raise the daily allowance without changing the API key.
   */
  hardLevel: number;
  /** Which limit is closest to binding. */
  binding?: "rpm" | "tpm" | "rpd";
  detail: string;
}

interface Window {
  startedAt: number;
  requests: number;
  tokens: number;
}

interface PressureScore {
  level: number;
  hard: boolean;
  binding: QuotaPressure["binding"];
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
   * How close we are to the limit, as a 0–1 pressure score.
   *
   * `level` is useful for context compaction. `hardLevel` is the only value the
   * router may use to make a provider ineligible.
   */
  pressure(): QuotaPressure {
    this.roll();

    const scores: PressureScore[] = [];

    // Token headers are used as a TPM signal by the providers we support and
    // are more authoritative than our pre-dispatch estimate.
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
      scores.push({
        level: clamp(this.day.requests / this.quota.requestsPerDay),
        hard: false,
        binding: "rpd",
        detail: `${this.day.requests}/${this.quota.requestsPerDay} requests seen by this instance today (advisory).`,
      });
    }

    // A recent 429 is hard evidence that beats any estimate.
    if (this.recent429s.length > 0) {
      scores.push({
        level: Math.min(1, 0.85 + this.recent429s.length * 0.05),
        hard: true,
        binding: undefined,
        detail: `${this.recent429s.length} rate-limit response(s) in the last 5 minutes.`,
      });
    }

    if (scores.length === 0) {
      return { level: 0, hardLevel: 0, detail: "No documented quota to track." };
    }

    const worst = scores.reduce((a, b) => (b.level > a.level ? b : a));
    const hardLevel = scores.reduce((max, score) => (score.hard ? Math.max(max, score.level) : max), 0);
    return {
      level: worst.level,
      hardLevel,
      binding: worst.binding,
      detail: worst.detail,
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
/** Hard pressure above this means: stop using this provider. */
export const PRESSURE_ABANDON = 0.9;
