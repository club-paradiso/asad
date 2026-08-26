/**
 * Per-provider circuit breaker.
 *
 * The failure this prevents is specific and nasty: a cloud provider that has
 * started timing out will otherwise add its full deadline to *every* phrase of
 * a sermon before the fallback runs. Three seconds of dead air, forty times a
 * service. Better to notice after two failures and stop asking.
 *
 *   healthy ──(failures ≥ threshold)──▶ open ──(cooldown)──▶ probing
 *      ▲                                                        │
 *      └────────────────(probe succeeds)────────────────────────┘
 *                                │
 *                       (probe fails: back to open, longer cooldown)
 */
import type { LlmFailureKind } from "./errors";
import type { LlmProviderId } from "./types";

export type BreakerState = "healthy" | "degraded" | "open" | "probing";

export interface BreakerConfig {
  /** Consecutive failures before the circuit opens. */
  threshold: number;
  /** First cooldown, doubled on each consecutive open (capped). */
  baseCooldownMs: number;
  maxCooldownMs: number;
}

export const DEFAULT_BREAKER: BreakerConfig = {
  threshold: 3,
  baseCooldownMs: 20_000,
  maxCooldownMs: 5 * 60_000,
};

export interface BreakerSnapshot {
  provider: LlmProviderId;
  state: BreakerState;
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  /** Epoch ms when a probe becomes allowed. */
  openUntil?: number;
  lastFailure?: { kind: LlmFailureKind; message: string; at: number };
  /** Set when the failure is permanent — no probe will ever be attempted. */
  permanentlyDisabled?: boolean;
}

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private opens = 0;
  private openUntil?: number;
  private permanent = false;
  private lastFailure?: BreakerSnapshot["lastFailure"];

  constructor(
    readonly provider: LlmProviderId,
    private readonly config: BreakerConfig = DEFAULT_BREAKER,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether the router may send a request to this provider right now. */
  canAttempt(): boolean {
    if (this.permanent) return false;
    if (this.openUntil === undefined) return true;
    return this.now() >= this.openUntil;
  }

  get state(): BreakerState {
    if (this.permanent) return "open";
    if (this.openUntil !== undefined) {
      return this.now() >= this.openUntil ? "probing" : "open";
    }
    return this.consecutiveFailures > 0 ? "degraded" : "healthy";
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.totalSuccesses += 1;
    this.openUntil = undefined;
    this.opens = 0;
  }

  /**
   * Record a failure.
   *
   * Authentication and known deployment-level model/configuration failures do
   * not heal while the process keeps the same environment, so they are disabled
   * immediately. Request-specific rejections are classified separately as
   * `request_rejected`; those count as ordinary transient failures instead of
   * benching the provider forever after one incompatible turn.
   */
  recordFailure(
    kind: LlmFailureKind,
    message: string,
    options: { fatal?: boolean; retryAfterSeconds?: number } = {},
  ): void {
    this.totalFailures += 1;
    this.consecutiveFailures += 1;
    this.lastFailure = { kind, message, at: this.now() };

    if (kind === "auth" || kind === "bad_request") {
      this.permanent = true;
      this.openUntil = Number.POSITIVE_INFINITY;
      return;
    }

    if (options.fatal || this.consecutiveFailures >= this.config.threshold) {
      this.opens += 1;
      const backoff = Math.min(
        this.config.baseCooldownMs * 2 ** (this.opens - 1),
        this.config.maxCooldownMs,
      );
      // Honour the provider's own Retry-After when it is longer than ours.
      const requested = (options.retryAfterSeconds ?? 0) * 1000;
      this.openUntil = this.now() + Math.max(backoff, requested);
    }
  }

  snapshot(): BreakerSnapshot {
    return {
      provider: this.provider,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      openUntil: Number.isFinite(this.openUntil) ? this.openUntil : undefined,
      lastFailure: this.lastFailure,
      permanentlyDisabled: this.permanent || undefined,
    };
  }

  reset(): void {
    this.consecutiveFailures = 0;
    this.openUntil = undefined;
    this.permanent = false;
    this.opens = 0;
  }
}
