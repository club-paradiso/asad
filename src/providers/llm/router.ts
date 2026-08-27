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
  provider: LlmProviderId;
  model: string;
  ok: boolean;
  latencyMs: number;
  failureKind?: string;
  message?: string;
}

export interface RouteResult {
  response: LlmResponse;
  provider: LlmProviderId;
  model: string;
  /** Every provider tried this turn, in order. */
  attempts: RouteAttempt[];
  /** True when the answer came from anything other than the preferred provider. */
  degraded: boolean;
  reason?: string;
}

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
  /** The provider this session settled on. */
  private sticky?: LlmProviderId;

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
  preferred(prefer?: ProviderFilter): LlmProviderId | null {
    if (!prefer && this.sticky && this.eligibility(this.sticky).ok) return this.sticky;
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
    },
  ): Promise<RouteResult> {
    const attempts: RouteAttempt[] = [];
    const chain = this.buildChain(options.prefer);

    for (const id of chain) {
      const eligibility = this.eligibility(id);
      if (!eligibility.ok && id !== "local") {
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

      const breaker = this.breakerFor(id);
      const limiter = this.limiterFor(id);
      const started = this.now();

      try {
        const timed = withDeadline(request, options.deadlineMs);
        const response = await provider.complete(timed.request);
        timed.dispose();

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
        // The local interpreter is the floor, never a preference. Making it
        // sticky would mean one cloud failure silently ends cloud
        // interpretation for the rest of the session, including after the
        // provider recovers.
        if (id !== "local") this.sticky = id;
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
          degraded: id === "local" || attempts.length > 1,
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
        if (this.sticky === id) this.sticky = undefined;
      }
    }

    // Unreachable in practice — `local` never throws — but the type demands it.
    throw new LlmError("No interpretation provider could answer.", "unknown");
  }

  /** Cloud candidates, then always the local interpreter as the floor. */
  private buildChain(prefer?: ProviderFilter): LlmProviderId[] {
    const candidates = this.candidates();
    // An explicit preference outranks stickiness: stickiness exists to keep
    // terminology consistent within one live session, which is not a reason to
    // send a counter turn to a proprietary model.
    const front = prefer
      ? candidates.filter((id) => prefer(id, this.env.llm.providers[id].model))
      : this.sticky && this.eligibility(this.sticky).ok
        ? [this.sticky]
        : [];
    const rest = candidates.filter((id) => !front.includes(id));
    return [...front, ...rest, "local"];
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
    this.sticky = undefined;
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
  request.signal?.addEventListener("abort", onAbort, { once: true });

  return {
    request: { ...request, signal: controller.signal },
    dispose: () => {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    },
  };
}
