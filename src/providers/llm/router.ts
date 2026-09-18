/**
 * The provider router.
 *
 * Picks a provider for each live turn and degrades when one fails. Three
 * behaviours matter more than the routing table itself:
 *
 *  1. **Free-first never means paid-by-accident.** `auto-free` will drop to the
 *     local interpreter before it spends the deployer's money. A paid provider
 *     is only reachable from `auto-free` when `LLM_ALLOW_PAID_FALLBACK` is
 *     explicitly on.
 *
 *  2. **Stickiness.** Once a session has a healthy provider it stays there.
 *     Model roulette between sentences produces inconsistent terminology and
 *     register, which an interpreter notices immediately and cannot correct
 *     for. Switching happens on failure, not on preference.
 *
 *  3. **The local interpreter is always last and always available.** There is
 *     no configuration in which the console goes silent because a vendor is
 *     down.
 */
import {
  assessFreeTierViability,
  capabilitiesFor,
  isOpenWeightModel,
  trainsOnSubmissions,
} from "./capabilities";
import { CircuitBreaker, type BreakerSnapshot } from "./circuit-breaker";
import { LlmError, toLlmError } from "./errors";
import { createProvider } from "./factory";
import { PRESSURE_ABANDON, RateLimitTracker } from "./rate-limit";
import type { LlmProvider, LlmProviderId, LlmRequest, LlmResponse } from "./types";
import type { AppEnv, PrivacyMode, RoutingMode } from "@/lib/env";

/** Free-tier candidates, in default preference order. */
const FREE_PROVIDERS: readonly LlmProviderId[] = ["gemini", "groq", "openrouter"] as const;
/** Paid providers, in default preference order. */
const PAID_PROVIDERS: readonly LlmProviderId[] = ["anthropic", "openai"] as const;

/** Chooses which providers a request would rather reach. */
export type ProviderFilter = (id: LlmProviderId, model: string) => boolean;

/** Providers currently configured with an open-weight model. */
export const OPEN_WEIGHT: ProviderFilter = (id, model) =>
  id !== "local" && isOpenWeightModel(model);

export interface RouteAttempt {
  /** A configured provider, or a recovery route's label. */
  provider: LlmProviderId | string;
  model: string;
  ok: boolean;
  latencyMs: number;
  failureKind?: string;
  message?: string;
}

/**
 * A last cloud route tried after every configured provider has failed, and
 * before the deterministic floor.
 *
 * Deliberately NOT a provider: it has no API key in the environment, no circuit
 * breaker, no quota tracker and no place in the preference order. It is an
 * escape hatch that exists because a deployment's configured providers can all
 * be unreachable at once — an exhausted free allowance, a bad key, an egress
 * failure — and the alternative is a console that goes silent while the
 * recogniser keeps working perfectly.
 *
 * Injected rather than imported so the router stays free of `server-only`
 * modules and so the rules can be tested without a network.
 */
export interface RouteRecovery {
  /** Stable label for telemetry and diagnostics. Never a credential. */
  id: string;
  /** Whether the route is configured at all. Cheap and synchronous. */
  available: () => boolean;
  complete: (request: LlmRequest, options: { timeoutMs: number }) => Promise<LlmResponse>;
}

export interface RouteResult {
  response: LlmResponse;
  provider: LlmProviderId;
  model: string;
  /**
   * Set when a recovery route answered rather than a configured provider. The
   * caller reports THIS as the provider, because saying `openrouter` when the
   * gateway answered would make the diagnostics page lie.
   */
  via?: string;
  /** Every provider tried this turn, in order. */
  attempts: RouteAttempt[];
  /** True when the answer came from anything other than the preferred provider. */
  degraded: boolean;
  reason?: string;
}

/**
 * The smallest cloud attempt worth starting.
 *
 * Below this a request cannot realistically return before the turn's answer
 * stops being useful, so starting it spends money and latency to produce
 * something the interpreter will never read. Walking on to the deterministic
 * floor immediately is strictly better.
 */
export const MIN_USEFUL_ATTEMPT_MS = 700;

export interface ProviderHealth {
  provider: LlmProviderId;
  model: string;
  configured: boolean;
  breaker: BreakerSnapshot;
  rateLimit: ReturnType<RateLimitTracker["snapshot"]>;
  /** Whether this provider is currently eligible to be routed to. */
  eligible: boolean;
  ineligibleReason?: string;
}

/**
 * Holds routing state for the process.
 *
 * Deliberately in-memory: this is a single small web app, and persisting
 * breaker state to Redis would be architecture astronautics for a problem that
 * resets harmlessly on deploy.
 */
export class LlmRouter {
  private readonly breakers = new Map<LlmProviderId, CircuitBreaker>();
  private readonly limits = new Map<LlmProviderId, RateLimitTracker>();
  private readonly instances = new Map<LlmProviderId, LlmProvider>();
  /** Provider affinity keyed by an explicit live/counter session identity. */
  private readonly sticky = new Map<string, LlmProviderId>();

  constructor(
    private readonly env: AppEnv,
    private readonly now: () => number = Date.now,
  ) {}

  /* --- Candidate selection --------------------------------------------- */

  /**
   * The ordered list of providers to try, before health filtering.
   *
   * `local` is appended by the caller, not here, so that "no cloud candidate"
   * remains visible as an empty list.
   */
  private candidates(mode: RoutingMode = this.env.llm.routingMode): LlmProviderId[] {
    const { pinned, allowPaidFallback, privacyMode } = this.env.llm;

    const configured = (id: LlmProviderId) => this.env.llm.providers[id].configured;
    const privacyOk = (id: LlmProviderId) =>
      privacyMode !== "strict" || !this.mayTrain(id);

    switch (mode) {
      case "local":
        return [];

      case "pinned":
        return pinned && pinned !== "local" && configured(pinned) ? [pinned] : [];

      case "reliable": {
        const preferred = pinned && pinned !== "local" ? [pinned] : [];
        return [...preferred, ...PAID_PROVIDERS, ...FREE_PROVIDERS]
          .filter((id, i, all) => all.indexOf(id) === i)
          .filter(configured)
          .filter(privacyOk);
      }

      case "auto-free": {
        const free = FREE_PROVIDERS.filter(configured).filter(privacyOk);
        // Paid providers are reachable from auto-free ONLY on explicit opt-in.
        const paid = allowPaidFallback ? PAID_PROVIDERS.filter(configured) : [];
        return [...free, ...paid];
      }
    }
  }

  private breakerFor(id: LlmProviderId): CircuitBreaker {
    let breaker = this.breakers.get(id);
    if (!breaker) {
      breaker = new CircuitBreaker(id, undefined, this.now);
      this.breakers.set(id, breaker);
    }
    return breaker;
  }

  /** Whether the deployer declared this provider to be on a billed plan. */
  private isPaid(id: LlmProviderId): boolean {
    return this.env.llm.paidTier.has(id);
  }

  /**
   * Whether this provider may train on what is sent to it, as configured.
   *
   * Not a property of the provider alone: OpenRouter's answer depends on the
   * routing policy this deployment sends with every request.
   */
  private mayTrain(id: LlmProviderId): boolean {
    return trainsOnSubmissions(id, this.isPaid(id), {
      openRouterDeniesCollection: this.env.llm.openrouter.policy.dataCollection === "deny",
    });
  }

  private limiterFor(id: LlmProviderId): RateLimitTracker {
    let tracker = this.limits.get(id);
    if (!tracker) {
      // A paid plan gets no locally-imposed ceiling. Metering it against
      // free-tier numbers benches a healthy provider as "quota nearly
      // exhausted" while the account still has plenty — the tracker still
      // reads whatever the provider reports in its headers, which is the only
      // authority worth trusting on a billed plan.
      const quota = this.isPaid(id) ? undefined : capabilitiesFor(id).freeTierQuota;
      tracker = new RateLimitTracker(id, quota, this.now);
      this.limits.set(id, tracker);
    }
    return tracker;
  }

  private instanceFor(id: LlmProviderId): LlmProvider | null {
    const cached = this.instances.get(id);
    if (cached) return cached;
    // Cached for the life of the process, which is what pins the model for the
    // session: the instance carries its model id, so nothing re-reads
    // configuration mid-sermon and quietly changes register.
    const provider = createProvider(id, this.env);
    if (provider) this.instances.set(id, provider);
    return provider;
  }

  /** Whether a provider may be used right now, and why not if it may not. */
  private eligibility(id: LlmProviderId): { ok: boolean; reason?: string } {
    if (!this.env.llm.providers[id].configured) return { ok: false, reason: "no API key" };
    const breaker = this.breakerFor(id);
    if (!breaker.canAttempt()) {
      const snapshot = breaker.snapshot();
      return {
        ok: false,
        reason: snapshot.permanentlyDisabled
          ? `disabled: ${snapshot.lastFailure?.kind ?? "configuration error"}`
          : `circuit open (${snapshot.lastFailure?.kind ?? "failures"})`,
      };
    }
    const pressure = this.limiterFor(id).pressure();
    if (pressure.level >= PRESSURE_ABANDON) {
      return { ok: false, reason: `quota nearly exhausted — ${pressure.detail}` };
    }
    return { ok: true };
  }

  /**
   * The provider this turn should prefer.
   *
   * Sticky while healthy; otherwise the first eligible candidate.
   */
  preferred(prefer?: ProviderFilter, routingKey?: string): LlmProviderId | null {
    const sticky = routingKey ? this.sticky.get(routingKey) : undefined;
    if (!prefer && sticky && this.eligibility(sticky).ok) return sticky;
    const candidates = prefer
      ? this.candidates().filter((id) => prefer(id, this.env.llm.providers[id].model))
      : this.candidates();
    const next = candidates.find((id) => this.eligibility(id).ok);
    return next ?? null;
  }

  /**
   * The provider a turn carrying this preference would actually reach.
   *
   * Deliberately not `preferred`, and the difference is the whole point: there
   * a filter is a *hard* filter, which answers "is the open-weight preference
   * satisfiable?". Here it is only an ordering, exactly as `complete` treats
   * it — which answers the question the visitor's disclosure and the
   * diagnostics page are actually asking: whose servers would see this?
   *
   * Reading `preferred(OPEN_WEIGHT)` as the answer to that question told every
   * deployment without an open-weight key — the documented OpenRouter and
   * Gemini setups among them — that nothing could translate, in red, on the
   * visitor's phone, while the counter went on translating perfectly well.
   */
  wouldReach(prefer?: ProviderFilter): LlmProviderId | null {
    const reached = this.buildChain(prefer).find(
      (id) => id !== "local" && this.eligibility(id).ok,
    );
    return reached ?? null;
  }

  /** The configured providers whose model matches a filter. Diagnostics. */
  matching(prefer: ProviderFilter): LlmProviderId[] {
    return this.candidates().filter((id) =>
      prefer(id, this.env.llm.providers[id].model),
    );
  }

  /** Quota pressure for the provider we would use, for context budgeting. */
  pressureFor(id: LlmProviderId): number {
    return this.limiterFor(id).pressure().level;
  }

  /* --- Execution -------------------------------------------------------- */

  /**
   * Run one interpretation turn, walking the fallback chain.
   *
   * `validate` lets the caller reject a structurally valid HTTP response whose
   * body failed schema validation — that is a provider failure, and the router
   * needs to know so it can try the next one rather than returning rubbish.
   */
  async complete(
    request: LlmRequest,
    options: {
      /** Per-provider deadline. */
      deadlineMs: number;
      /** Returns false when the payload is unusable. */
      validate?: (response: LlmResponse) => boolean;
      /** Estimated tokens for quota accounting. */
      estimatedTokens?: number;
      /**
       * Providers matching this go to the front of the chain, ahead of the
       * sticky one. Counter Mode uses it to reach an open-weight model first.
       * It is a preference, not a filter: the rest of the chain still follows,
       * because refusing to translate at a counter is worse than translating
       * on the second choice.
       */
      prefer?: ProviderFilter;
      /** Session/workflow identity for provider affinity. Omit for one-shot work. */
      routingKey?: string;
      /**
       * Wall-clock budget for the WHOLE chain, not per provider.
       *
       * Without it, a chain of three providers each allowed a 3.5 second
       * deadline answers in twelve seconds — which for simultaneous
       * interpretation is indistinguishable from not answering. With it, each
       * attempt gets whatever is actually left, and an attempt that cannot land
       * in time is skipped rather than started.
       */
      turnDeadlineMs?: number;
      /** Smallest attempt worth starting. Defaults to `MIN_USEFUL_ATTEMPT_MS`. */
      minAttemptMs?: number;
      /** Tried after every configured provider fails, before the local floor. */
      recovery?: RouteRecovery;
    },
  ): Promise<RouteResult> {
    const attempts: RouteAttempt[] = [];
    const startedAt = this.now();
    const minAttempt = options.minAttemptMs ?? MIN_USEFUL_ATTEMPT_MS;
    const cloud = this.buildChain(options.prefer, options.routingKey).filter(
      (id) => id !== "local",
    );

    /** What is left of the turn, or null when the caller set no budget. */
    const remaining = (): number | null =>
      options.turnDeadlineMs === undefined
        ? null
        : options.turnDeadlineMs - (this.now() - startedAt);

    /** The deadline this attempt gets: the smaller of its own and what is left. */
    const budgetFor = (base: number): number | null => {
      const left = remaining();
      if (left === null) return base;
      if (left < minAttempt) return null;
      return Math.min(base, left);
    };

    for (const id of cloud) {
      const eligibility = this.eligibility(id);
      if (!eligibility.ok) {
        attempts.push({
          provider: id,
          model: this.env.llm.providers[id].model,
          ok: false,
          latencyMs: 0,
          failureKind: "skipped",
          message: eligibility.reason,
        });
        continue;
      }

      const provider = this.instanceFor(id);
      if (!provider) continue;

      const budget = budgetFor(options.deadlineMs);
      if (budget === null) {
        // Out of turn. Say so as an attempt rather than silently skipping: the
        // difference between "the provider failed" and "we never asked it"
        // is the whole diagnosis when a session goes quiet.
        attempts.push({
          provider: id,
          model: this.env.llm.providers[id].model,
          ok: false,
          latencyMs: 0,
          failureKind: "deadline",
          message: "no useful turn budget left",
        });
        continue;
      }

      const breaker = this.breakerFor(id);
      const limiter = this.limiterFor(id);
      const started = this.now();

      const timed = withDeadline(request, budget);
      try {
        const response = await provider.complete(timed.request);

        limiter.observe(response.rateLimit);
        limiter.recordRequest(
          response.usage?.totalTokens ?? options.estimatedTokens ?? 0,
        );

        if (options.validate && !options.validate(response)) {
          throw new LlmError(
            `${id} returned output that failed schema validation.`,
            "malformed_output",
          );
        }

        breaker.recordSuccess();
        // Stickiness is for CLOUD providers only, and the loop now carries none
        // but those. The local interpreter must never become sticky: one cloud
        // failure would then silently end cloud interpretation for the rest of
        // the session, including long after the provider recovered.
        if (options.routingKey) this.setSticky(options.routingKey, id);
        attempts.push({
          provider: id,
          model: response.model ?? provider.model,
          ok: true,
          latencyMs: response.latencyMs,
        });

        return {
          response,
          provider: id,
          model: response.model ?? provider.model,
          attempts,
          degraded: attempts.length > 1,
          reason: attempts.length > 1 ? attempts[0].message : undefined,
        };
      } catch (error) {
        const llmError = toLlmError(error);
        if (llmError.kind === "rate_limited" || llmError.kind === "quota_exhausted") {
          limiter.recordRateLimited();
        }
        breaker.recordFailure(llmError.kind, llmError.message, {
          fatal: llmError.fatal,
          retryAfterSeconds: llmError.retryAfterSeconds,
        });
        attempts.push({
          provider: id,
          model: this.env.llm.providers[id].model,
          ok: false,
          latencyMs: this.now() - started,
          failureKind: llmError.kind,
          message: llmError.message,
        });

        // The sticky provider just failed; the next healthy one takes over.
        if (options.routingKey && this.sticky.get(options.routingKey) === id) {
          this.sticky.delete(options.routingKey);
        }

        // A turn-level abort means the result is no longer useful. Per-provider
        // deadlines may fall through, but a caller abort must stop the chain.
        if (request.signal?.aborted) throw llmError;
      } finally {
        timed.dispose();
      }
    }

    /* --- Recovery ------------------------------------------------------- */
    // Every configured provider is unusable. That happens for reasons that have
    // nothing to do with each other and everything to do with a bad day: a free
    // allowance spent, a key rotated, egress blocked from one region. A second
    // cloud route with its own credential path is the difference between "the
    // model was slower than usual" and "the interpreter got nothing".
    const recovery = options.recovery;
    if (recovery?.available()) {
      const budget = budgetFor(options.deadlineMs);
      if (budget === null) {
        attempts.push({
          provider: recovery.id,
          model: "recovery",
          ok: false,
          latencyMs: 0,
          failureKind: "deadline",
          message: "no useful turn budget left",
        });
      } else {
        const started = this.now();
        try {
          const response = await recovery.complete(request, { timeoutMs: budget });
          if (options.validate && !options.validate(response)) {
            throw new LlmError(
              `${recovery.id} returned output that failed schema validation.`,
              "malformed_output",
            );
          }
          attempts.push({
            provider: recovery.id,
            model: response.model ?? "recovery",
            ok: true,
            latencyMs: response.latencyMs,
          });
          return {
            response,
            // The chain's own answer to "whose configured provider was this?"
            // remains honest: none of them. `via` carries what actually served
            // the turn, and the caller reports that.
            provider: "local",
            via: recovery.id,
            model: response.model ?? recovery.id,
            attempts,
            degraded: true,
            reason: attempts[0]?.message,
          };
        } catch (error) {
          const llmError = toLlmError(error);
          attempts.push({
            provider: recovery.id,
            model: "recovery",
            ok: false,
            latencyMs: this.now() - started,
            failureKind: llmError.kind,
            message: llmError.message,
          });
          if (request.signal?.aborted) throw llmError;
        }
      }
    }

    /* --- The floor ------------------------------------------------------ */
    // Never skipped and never deadline-gated: it is deterministic, in-process
    // and answers in single-digit milliseconds. There is no configuration in
    // which the console goes silent because a vendor is down.
    const local = this.instanceFor("local");
    if (local) {
      const started = this.now();
      const response = await local.complete(request);
      attempts.push({
        provider: "local",
        model: response.model ?? local.model,
        ok: true,
        latencyMs: response.latencyMs || this.now() - started,
      });
      return {
        response,
        provider: "local",
        model: response.model ?? local.model,
        attempts,
        degraded: true,
        reason: attempts.length > 1 ? attempts[0].message : undefined,
      };
    }

    // Unreachable in practice — `local` is always constructible — but the type
    // demands it.
    throw new LlmError("No interpretation provider could answer.", "unknown");
  }

  /**
   * Cloud candidates in the order this turn should try them, with the local
   * interpreter appended as the floor.
   *
   * `complete` filters `local` back out and runs it explicitly at the end, so
   * that a recovery route can sit between the last cloud provider and the
   * deterministic answer. Everything else still reads this as the full chain.
   */
  private buildChain(prefer?: ProviderFilter, routingKey?: string): LlmProviderId[] {
    const candidates = this.candidates();
    const sticky = routingKey ? this.sticky.get(routingKey) : undefined;
    // An explicit preference outranks stickiness: stickiness exists to keep
    // terminology consistent within one live session, which is not a reason to
    // send a counter turn to a proprietary model.
    const front = prefer
      ? candidates.filter((id) => prefer(id, this.env.llm.providers[id].model))
      : sticky && this.eligibility(sticky).ok
        ? [sticky]
        : [];
    const rest = candidates.filter((id) => !front.includes(id));
    return [...front, ...rest, "local"];
  }

  private setSticky(key: string, provider: LlmProviderId): void {
    // Refresh insertion order and bound attacker-controlled session keys.
    this.sticky.delete(key);
    this.sticky.set(key, provider);
    while (this.sticky.size > 2_000) {
      const oldest = this.sticky.keys().next().value as string | undefined;
      if (!oldest) break;
      this.sticky.delete(oldest);
    }
  }

  /* --- Introspection ---------------------------------------------------- */

  health(): ProviderHealth[] {
    return (Object.keys(this.env.llm.providers) as LlmProviderId[]).map((id) => {
      const eligibility = this.eligibility(id);
      return {
        provider: id,
        model: this.env.llm.providers[id].model,
        configured: this.env.llm.providers[id].configured,
        breaker: this.breakerFor(id).snapshot(),
        rateLimit: this.limiterFor(id).snapshot(),
        eligible: id === "local" ? true : eligibility.ok,
        ineligibleReason: id === "local" ? undefined : eligibility.reason,
      };
    });
  }

  /** What the deployment would do right now, for the diagnostics page. */
  plan(): {
    mode: RoutingMode;
    privacyMode: PrivacyMode;
    allowPaidFallback: boolean;
    /** Providers declared to be on a billed plan. */
    paidTier: LlmProviderId[];
    chain: LlmProviderId[];
    active: LlmProviderId | null;
    warnings: string[];
  } {
    const chain = [...this.candidates(), "local" as const];
    const warnings: string[] = [];

    for (const id of this.candidates()) {
      const caps = capabilitiesFor(id);
      const paid = this.isPaid(id);
      // A free-tier ceiling is not a fact about a billed plan.
      if (caps.freeTierPossible && !paid) {
        const verdict = assessFreeTierViability(id);
        if (!verdict.viable) {
          warnings.push(`${caps.label} free tier: ${verdict.detail}`);
        }
      }
      if (this.mayTrain(id) && this.env.llm.privacyMode !== "strict") {
        warnings.push(`${caps.label}: ${caps.privacyNote}`);
      }
    }

    return {
      mode: this.env.llm.routingMode,
      privacyMode: this.env.llm.privacyMode,
      allowPaidFallback: this.env.llm.allowPaidFallback,
      paidTier: [...this.env.llm.paidTier],
      chain,
      active: this.preferred(),
      warnings,
    };
  }

  /** Test seam. */
  reset(): void {
    this.breakers.clear();
    this.limits.clear();
    this.sticky.clear();
  }
}

/**
 * Combine the caller's signal with a per-provider deadline.
 *
 * A response that arrives after the interpreter has moved on is worthless, so
 * the deadline is short and enforced here rather than trusted to the adapter.
 */
function withDeadline(request: LlmRequest, deadlineMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  const onAbort = () => controller.abort();
  if (request.signal?.aborted) controller.abort(request.signal.reason);
  else request.signal?.addEventListener("abort", onAbort, { once: true });

  return {
    request: { ...request, signal: controller.signal },
    dispose: () => {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    },
  };
}
