/**
 * Quality escalation.
 *
 * The premise the rest of this module defends: **a late perfect translation is
 * worse than a timely good one.** An interpreter who has already said the
 * sentence cannot use a better version of it, and being shown one is actively
 * harmful — it invites a retraction in front of a room.
 *
 * So escalation is not "try harder". It is a bounded, opt-in second opinion
 * that is only ever attempted when there is measured budget left in the turn,
 * and whose result is DISCARDED rather than waited for if it misses. The
 * primary answer is what the interpreter sees; escalation can only replace it
 * before it would have mattered.
 *
 * When it is worth spending that budget:
 *
 *   - the segment carries wordplay, humour or idiom, which is where a
 *     Flash-class model is most likely to render something literal and wrong;
 *   - the primary model told us it was not confident.
 *
 * Both are signals that already exist. Neither requires guessing.
 */
import type { LagProfile } from "@/types";
import type { ParsedInterpreterOutput } from "@/lib/schema";

/**
 * Minimum headroom worth attempting an escalation in.
 *
 * Below this the second call cannot land before the turn budget expires, so
 * making it spends money to produce something that will be thrown away.
 */
export const MIN_ESCALATION_HEADROOM_MS = 900;

/** Hard ceiling on the escalation call itself, whatever budget remains. */
export const ESCALATION_DEADLINE_CEILING_MS = 2200;

/** Kinds of local cultural detection that justify a second opinion. */
const DIFFICULT_KINDS = new Set(["wordplay", "humour", "idiom", "hanja"]);

export interface EscalationInput {
  enabled: boolean;
  lag: LagProfile;
  /** Cultural signals the local detectors found in this segment. */
  detectedKinds: readonly string[];
  /** What the primary model returned, when it returned anything. */
  primary: ParsedInterpreterOutput | null;
  /** Milliseconds already spent on this turn. */
  elapsedMs: number;
  /** Total milliseconds this turn is allowed. */
  turnBudgetMs: number;
}

export interface EscalationDecision {
  escalate: boolean;
  /** Deadline for the escalation call, when escalating. */
  deadlineMs: number;
  /** Why, for diagnostics. Never shown to the interpreter mid-session. */
  reason: string;
}

/**
 * Decide whether to spend the remaining turn budget on a second opinion.
 *
 * Pure, so the interesting cases — no headroom left, fast lag, escalation off
 * — are assertions rather than hopes.
 */
export function escalationDecision(input: EscalationInput): EscalationDecision {
  const no = (reason: string): EscalationDecision => ({
    escalate: false,
    deadlineMs: 0,
    reason,
  });

  if (!input.enabled) return no("escalation disabled");

  // FAST exists because the interpreter chose to accept correction risk in
  // exchange for speed. Spending their headroom on a second call inverts the
  // trade they explicitly made.
  if (input.lag === "fast") return no("fast lag has no headroom to spend");

  const remaining = input.turnBudgetMs - input.elapsedMs;
  if (remaining < MIN_ESCALATION_HEADROOM_MS) {
    return no(`only ${Math.max(0, Math.round(remaining))}ms of turn budget left`);
  }

  const difficult = input.detectedKinds.some((kind) => DIFFICULT_KINDS.has(kind));
  const unconfident = input.primary?.confidence === "low";

  if (!difficult && !unconfident) return no("primary answer is confident and unremarkable");

  return {
    escalate: true,
    deadlineMs: Math.min(remaining, ESCALATION_DEADLINE_CEILING_MS),
    reason: difficult
      ? "segment carries wordplay or idiom"
      : "primary model reported low confidence",
  };
}

/**
 * Whether an escalated answer is actually better than what we already have.
 *
 * Escalation that swaps a usable answer for a differently-worded one of the
 * same confidence is pure churn: the interpreter sees the line change under
 * them for no gain. Only a genuine confidence improvement is worth the swap.
 */
export function escalationImproves(
  primary: ParsedInterpreterOutput | null,
  escalated: ParsedInterpreterOutput | null,
): boolean {
  if (!escalated || escalated.safeChunks.length === 0) return false;
  if (!primary || primary.safeChunks.length === 0) return true;
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[escalated.confidence] > rank[primary.confidence];
}
