/**
 * Incoming-request rate limiting.
 *
 * Not to be confused with `providers/llm/rate-limit.ts`, which tracks what WE
 * have spent against a provider's quota. This one bounds what STRANGERS can
 * spend of ours.
 *
 * HONEST LIMITATION, stated here because the diagnostics page repeats it and
 * `docs/deployment.md` explains it: this is in-process. On Vercel, or anywhere
 * else running more than one instance, each instance enforces its own counter,
 * so the effective ceiling is the configured limit multiplied by the number of
 * warm instances. That is a real and useful bound — it turns "unbounded" into
 * "bounded by a number you can compute" — but it is not a global guarantee and
 * nothing in this application claims it is. A deployment that needs a hard
 * global ceiling needs shared state, and the honest place to get it is the
 * provider's own spend limit, which OpenRouter exposes per key.
 */

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Seconds until the window rolls over. */
  retryAfterSeconds: number;
  limit: number;
}

interface Bucket {
  windowStartedAt: number;
  count: number;
}

/**
 * Fixed-window counter with bounded memory.
 *
 * A sliding window would be marginally fairer at the boundary; it would also
 * need per-key timestamp arrays, which is unbounded memory keyed by something
 * an attacker controls. Fixed windows cannot be made to allocate.
 */
export class RequestRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly rule: RateLimitRule,
    /** Bound on distinct keys tracked; oldest are evicted past it. */
    private readonly maxKeys = 5000,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitVerdict {
    const t = this.now();
    let bucket = this.buckets.get(key);

    if (!bucket || t - bucket.windowStartedAt >= this.rule.windowMs) {
      bucket = { windowStartedAt: t, count: 0 };
      // Refreshing insertion order keeps the eviction below meaningful.
      this.buckets.delete(key);
      this.buckets.set(key, bucket);
      this.evictIfNeeded();
    }

    bucket.count += 1;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.windowStartedAt + this.rule.windowMs - t) / 1000),
    );

    return {
      allowed: bucket.count <= this.rule.limit,
      remaining: Math.max(0, this.rule.limit - bucket.count),
      retryAfterSeconds,
      limit: this.rule.limit,
    };
  }

  /**
   * Drop the least recently refreshed keys.
   *
   * A Map iterates in insertion order, and every new window re-inserts, so the
   * front of the map is the coldest. This is what stops a spray of unique
   * source addresses from turning the limiter into the vulnerability.
   */
  private evictIfNeeded(): void {
    if (this.buckets.size <= this.maxKeys) return;
    const overflow = this.buckets.size - this.maxKeys;
    let dropped = 0;
    for (const key of this.buckets.keys()) {
      this.buckets.delete(key);
      if ((dropped += 1) >= overflow) break;
    }
  }

  /** Live key count, for diagnostics. Never the keys themselves. */
  get trackedKeys(): number {
    return this.buckets.size;
  }

  reset(): void {
    this.buckets.clear();
  }
}
