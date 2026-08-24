/**
 * Rate-limit and quota tracking.
 *
 * Free tiers are where this earns its keep. Groq's free tier allows 6,000
 * tokens per minute; tong-yuck's full-context live path wants roughly 14,000.
 * Discovering that by receiving 429s halfway through a sermon is the wrong way
 * to find out, so the budget is tracked locally as well as read from headers.
 *
 * NOTHING here stores transcript content. Counts and timestamps only.
 */
import type { FreeTierQuota } from "./capabilities";
import type { LlmProviderId, RateLimitSnapshot } from "./types";

export interface QuotaPressure {
  /** 0 = plenty of headroom, 1 = at the limit. */
  level: number;
  /** Which limit is closest to binding. */
  binding?: "rpm" | "tpm" | "rpd";
  detail: string;
}

interface Window {
  startedAt: number;
  requests: number;
  tokens: number;
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

  /** Fold in the provider's own view, which outranks our estimate. */
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
   * The router uses this to compact context or move on BEFORE the 429 rather
   * than after it.
   */
  pressure(): QuotaPressure {
    this.roll();

    const scores: Array<{ level: number; binding: QuotaPressure["binding"]; detail: string }> = [];

    // The provider's own numbers, when it supplies them, are authoritative.
    if (this.observed?.tokensRemaining !== undefined && this.quota?.tokensPerMinute) {
      const used = 1 - this.observed.tokensRemaining / this.quota.tokensPerMinute;
      scores.push({
        level: clamp(used),
        binding: "tpm",
        detail: `${this.observed.tokensRemaining.toLocaleString()} tokens left this minute (reported).`,
      });
    } else if (this.quota?.tokensPerMinute) {
      scores.push({
        level: clamp(this.minute.tokens / this.quota.tokensPerMinute),
        binding: "tpm",
        detail: `${this.minute.tokens.toLocaleString()}/${this.quota.tokensPerMinute.toLocaleString()} tokens this minute (estimated).`,
      });
    }

    if (this.observed?.requestsRemaining !== undefined && this.quota?.requestsPerMinute) {
      scores.push({
        level: clamp(1 - this.observed.requestsRemaining / this.quota.requestsPerMinute),
        binding: "rpm",
        detail: `${this.observed.requestsRemaining} requests left this minute (reported).`,
      });
    } else if (this.quota?.requestsPerMinute) {
      scores.push({
        level: clamp(this.minute.requests / this.quota.requestsPerMinute),
        binding: "rpm",
        detail: `${this.minute.requests}/${this.quota.requestsPerMinute} requests this minute (estimated).`,
      });
    }

    if (this.quota?.requestsPerDay) {
      scores.push({
        level: clamp(this.day.requests / this.quota.requestsPerDay),
        binding: "rpd",
        detail: `${this.day.requests}/${this.quota.requestsPerDay} requests today.`,
      });
    }

    // A recent 429 is hard evidence that beats any estimate.
    if (this.recent429s.length > 0) {
      scores.push({
        level: Math.min(1, 0.85 + this.recent429s.length * 0.05),
        binding: undefined,
        detail: `${this.recent429s.length} rate-limit response(s) in the last 5 minutes.`,
      });
    }

    if (scores.length === 0) {
      return { level: 0, detail: "No documented quota to track." };
    }

    const worst = scores.reduce((a, b) => (b.level > a.level ? b : a));
    return { level: worst.level, binding: worst.binding, detail: worst.detail };
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
