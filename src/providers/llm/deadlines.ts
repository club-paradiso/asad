/**
 * Live deadlines.
 *
 * Phase 1 allowed an interpretation request twelve seconds. For simultaneous
 * interpretation that is not a timeout, it is a guarantee of irrelevance: the
 * interpreter has said four more sentences by then.
 *
 * The rule here is that a fast local fallback beats a late perfect translation.
 * Deadlines are therefore derived from the lag profile the interpreter chose,
 * because that is exactly a statement of how much delay they can absorb.
 */
import type { LagProfile } from "@/types";
import type { LlmProviderId } from "./types";

export type Workflow = "live" | "prep" | "review";

/**
 * Per-lag live deadlines.
 *
 * Sized so a failed provider plus a local fallback still lands inside the
 * profile's tolerance, rather than the deadline alone consuming it.
 */
const LIVE_DEADLINE_MS: Record<LagProfile, number> = {
  fast: 2500,
  balanced: 3500,
  safe: 5000,
};

/**
 * Always reserve a small slice of the total turn for the deterministic local
 * fallback. It normally answers in a few milliseconds, but the reserve keeps
 * the cloud attempt from consuming the entire outer AbortController budget.
 */
const LOCAL_FALLBACK_HEADROOM_MS = 250;

/** Providers observed to need a little more headroom before first token. */
const PROVIDER_SLACK_MS: Partial<Record<LlmProviderId, number>> = {
  // OpenRouter may traverse multiple upstreams and then multiple model-level
  // fallbacks inside one HTTP request. Production smoke observed the public
  // free chain reaching 4.2s before the old 700ms slack killed it at the exact
  // moment a fallback could have completed. Give routing enough room while the
  // turn-budget cap below still guarantees time for the local floor.
  openrouter: 2000,
  anthropic: 300,
};

/** Total time the whole turn may take, across every fallback attempt. */
export function turnBudgetFor(lag: LagProfile = "balanced"): number {
  return Math.round(LIVE_DEADLINE_MS[lag] * 1.6);
}

export function deadlineFor(input: {
  workflow: Workflow;
  lag?: LagProfile;
  provider?: LlmProviderId;
  /** When a provider is on its second attempt, do not give it another full go. */
  attempt?: number;
}): number {
  if (input.workflow === "prep") return 45_000;
  if (input.workflow === "review") return 60_000;

  const lag = input.lag ?? "balanced";
  const base = LIVE_DEADLINE_MS[lag];
  const slack = input.provider ? (PROVIDER_SLACK_MS[input.provider] ?? 0) : 0;
  // Fallback attempts get a tighter budget: time already spent is gone.
  const shrink = (input.attempt ?? 0) > 0 ? 0.6 : 1;
  const requested = Math.round((base + slack) * shrink);
  const cloudCeiling = Math.max(1, turnBudgetFor(lag) - LOCAL_FALLBACK_HEADROOM_MS);
  return Math.min(requested, cloudCeiling);
}
