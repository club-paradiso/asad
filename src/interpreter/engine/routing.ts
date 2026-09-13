/**
 * Adaptive routing: how much intelligence a turn deserves.
 *
 * Not every utterance needs the strongest, slowest reasoning path. A short,
 * cleanly recognised sentence with no numbers and no unsettled names is a
 * translation problem, not an interpretation problem; a unit the recogniser
 * was unsure about, or one carrying a date the room will act on, is the
 * opposite. The tier chosen here travels to the server, which spends its
 * context budget (and any quality escalation) accordingly.
 *
 * Deterministic and cheap: it runs on every flush, on the main thread.
 */
import type { RepairKind } from "@/types";
import { transcriptLength } from "@/languages/segmentation";

export type RouteTier = "fast" | "contextual" | "deep";

export interface RouteEvidence {
  text: string;
  language: string;
  /** 0–1 combined evidence for the source text after assessment. */
  sourceScore: number;
  hypothesisCount: number;
  repairKinds: RepairKind[];
  /** Digits, dates, times, codes present in the source. */
  structuredCount: number;
  /** Known-entity mentions in the unit. */
  entityMentions: number;
  /** Boundary the stabiliser cut on. Clock cuts are harder to translate. */
  boundary: "sentence" | "clause" | "quiet" | "timeout";
  /** True when a previous unit was cut open and this one continues it. */
  continuesPrevious: boolean;
}

/** Units at or below this length, with clean evidence, are routine. */
const FAST_MAX_LENGTH = 40;
/** Units above this length always get the full context. */
const DEEP_MIN_LENGTH = 160;

export function routeTurn(evidence: RouteEvidence): RouteTier {
  const length = transcriptLength(evidence.text, evidence.language);

  const suspicious =
    evidence.hypothesisCount > 0 ||
    evidence.sourceScore < 0.6 ||
    evidence.repairKinds.length > 0;

  if (suspicious || evidence.structuredCount >= 2 || length >= DEEP_MIN_LENGTH) return "deep";

  if (
    length <= FAST_MAX_LENGTH &&
    evidence.structuredCount === 0 &&
    evidence.entityMentions === 0 &&
    evidence.boundary === "sentence" &&
    !evidence.continuesPrevious &&
    evidence.sourceScore >= 0.8
  ) {
    return "fast";
  }

  return "contextual";
}
