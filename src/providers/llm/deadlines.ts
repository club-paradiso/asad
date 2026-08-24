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

/** Providers observed to need a little more headroom before first token. */
const PROVIDER_SLACK_MS: Partial<Record<LlmProviderId, number>> = {
  // Routes to a third-party model, so it carries an extra network hop.
  openrouter: 700,
  anthropic: 300,
};

export function deadlineFor(input: {
  workflow: Workflow;
  lag?: LagProfile;
  provider?: LlmProviderId;
  /** When a provider is on its second attempt, do not give it another full go. */
  attempt?: number;
}): number {
  if (input.workflow === "prep") return 45_000;
  if (input.workflow === "review") return 60_000;

  const base = LIVE_DEADLINE_MS[input.lag ?? "balanced"];
  const slack = input.provider ? (PROVIDER_SLACK_MS[input.provider] ?? 0) : 0;
  // Fallback attempts get a tighter budget: time already spent is gone.
  const shrink = (input.attempt ?? 0) > 0 ? 0.6 : 1;
  return Math.round((base + slack) * shrink);
}

/** Total time the whole turn may take, across every fallback attempt. */
export function turnBudgetFor(lag: LagProfile = "balanced"): number {
  return Math.round(LIVE_DEADLINE_MS[lag] * 1.6);
}
