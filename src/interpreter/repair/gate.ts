/**
 * Confidence gating: the one place that turns a score into an action.
 *
 * Bands are coarse on purpose. A live interpreter cannot act on "0.83"; the
 * engine cannot either. What both need is the answer to one question: do we
 * leave the text alone, show a hint, change the text, or change it and also
 * strengthen the memory that justified the change?
 *
 *   low        < 0.65   keep — not enough evidence to even suggest
 *   medium     < 0.85   hypothesis — shown, never applied
 *   high       < 0.95   repair — applied, explained, reversible
 *   very-high  ≥ 0.95   reinforce — applied and the memory is strengthened
 *   user                the interpreter said so; always reinforce
 *
 * A high-band repair that has now happened more than once is treated as
 * very-high: recurrence is evidence, and a binding that keeps proving itself
 * should stop being re-litigated on every unit.
 */
import type { ConfidenceBand } from "./assess";

export type RepairDecision = "keep" | "hypothesis" | "repair" | "reinforce";

export const BAND_THRESHOLDS = { medium: 0.65, high: 0.85, veryHigh: 0.95 } as const;

export function bandFromScore(score: number, userConfirmed?: boolean): ConfidenceBand {
  if (userConfirmed) return "user";
  if (score >= BAND_THRESHOLDS.veryHigh) return "very-high";
  if (score >= BAND_THRESHOLDS.high) return "high";
  if (score >= BAND_THRESHOLDS.medium) return "medium";
  return "low";
}

export function decide(band: ConfidenceBand, options: { repeated?: boolean } = {}): RepairDecision {
  switch (band) {
    case "low":
      return "keep";
    case "medium":
      return "hypothesis";
    case "high":
      return options.repeated ? "reinforce" : "repair";
    case "very-high":
    case "user":
      return "reinforce";
  }
}
