/**
 * Transcript stabilisation and trigger timing.
 *
 * Speech recognisers emit two kinds of thing: unstable partials that rewrite
 * themselves, and finalised text. Neither maps directly to "now is the moment
 * to ask for English". This module owns that decision.
 *
 * A flush happens when any of these is true:
 *   1. the pending Korean ends on a sentence boundary and is long enough;
 *   2. the recogniser has been quiet for the profile's stabilise window;
 *   3. the pending Korean has been waiting longer than the profile allows.
 *
 * (3) is what keeps a preacher who never pauses from starving the pipeline.
 */
import type { LagConfig } from "./lag";
import {
  boundaryRulesFor,
  endsClause,
  endsSentence,
  joinTranscript,
  splitThoughtUnits as splitByLanguage,
  transcriptLength,
} from "@/languages/segmentation";

/**
 * Boundary detection lives in `@/languages/segmentation` so the same rules
 * serve every source language. The stabiliser was written for Korean and its
 * regexes moved there unchanged; the default language below keeps every
 * caller that never passed one behaving exactly as before.
 */
const DEFAULT_LANGUAGE = "ko-KR";

export interface StabiliserState {
  /** Stabilised Korean not yet sent for interpretation. */
  pending: string;
  /** Timestamp of the oldest unsent stabilised text. */
  pendingSince: number | null;
  /** Timestamp of the most recent recogniser event of any kind. */
  lastEventAt: number;
}

export const emptyStabiliser = (): StabiliserState => ({
  pending: "",
  pendingSince: null,
  lastEventAt: 0,
});

/** Add newly finalised recogniser output to the pending buffer. */
export function pushStable(
  state: StabiliserState,
  text: string,
  now: number,
  language: string = DEFAULT_LANGUAGE,
): StabiliserState {
  const clean = text.trim();
  if (!clean) return { ...state, lastEventAt: now };
  return {
    pending: state.pending ? joinTranscript(state.pending, clean, language) : clean,
    pendingSince: state.pendingSince ?? now,
    lastEventAt: now,
  };
}

/**
 * Put an interpretation unit back in front of whatever arrived while its
 * request was in flight. A transient network failure must never turn into a
 * missing sentence in the English stream.
 */
export function restorePending(
  state: StabiliserState,
  text: string,
  now: number,
  language: string = DEFAULT_LANGUAGE,
): StabiliserState {
  const clean = text.trim();
  if (!clean) return state;
  return {
    pending: state.pending ? joinTranscript(clean, state.pending, language) : clean,
    pendingSince: Math.min(state.pendingSince ?? now, now),
    lastEventAt: state.lastEventAt,
  };
}

/** Note recogniser activity without adding anything to the buffer. */
export const touch = (state: StabiliserState, now: number): StabiliserState => ({
  ...state,
  lastEventAt: now,
});

/** A boundary the engine actually acted on. */
export type FlushBoundary = "sentence" | "quiet" | "timeout" | "clause";

export type FlushReason = FlushBoundary | null;

/**
 * Decide whether the pending Korean should be interpreted now.
 *
 * Returns the reason, so callers can vary behaviour: a `timeout` flush is a
 * mid-thought cut and deserves more conservative anticipation than a clean
 * `sentence` flush.
 */
export function flushReason(
  state: StabiliserState,
  config: LagConfig,
  now: number,
  language: string = DEFAULT_LANGUAGE,
): FlushReason {
  const pending = state.pending.trim();
  if (!pending) return null;

  const waited = state.pendingSince === null ? 0 : now - state.pendingSince;
  const quiet = now - state.lastEventAt;
  const length = transcriptLength(pending, language);
  const rules = boundaryRulesFor(language);

  if (waited >= config.maxHoldMs) return "timeout";
  if (length < config.minTriggerChars) return null;
  if (endsSentence(pending, language)) return "sentence";
  // A recogniser that rarely punctuates (Thai, some Chinese paths) leaves the
  // quiet window as the main boundary; shorten it a little so speech that
  // never carries a full stop is not always cut by the hold ceiling instead.
  const quietWindow = rules.punctuationReliable ? config.stabiliseMs : Math.round(config.stabiliseMs * 0.8);
  if (quiet >= quietWindow) return "quiet";
  // A clause boundary only earns a flush once the buffer is genuinely long.
  if (endsClause(pending, language) && length >= config.minTriggerChars * 2) {
    return "clause";
  }
  return null;
}

/** Empty the pending buffer, returning what was in it. */
export function drain(state: StabiliserState): { text: string; state: StabiliserState } {
  return {
    text: state.pending.trim(),
    state: { pending: "", pendingSince: null, lastEventAt: state.lastEventAt },
  };
}

/**
 * Whether a predicted continuation should be requested for this flush.
 *
 * Prediction is only useful mid-thought. Asking the model to guess what comes
 * after a completed sentence produces confident invention, which is the one
 * thing this product must never show.
 */
export function shouldAnticipate(
  config: LagConfig,
  reason: FlushReason,
  partial: string,
): boolean {
  if (config.anticipation === "off") return false;
  if (!partial.trim()) return false;
  if (reason === "sentence") return false;
  if (config.anticipation === "conservative") {
    // Only predict when there is real unresolved Korean hanging.
    return partial.trim().length >= 6;
  }
  return true;
}

/**
 * Split a stabilised sentence into interpretation-sized units along its
 * language's clause structure. Korean delays the predicate, so its useful
 * break points are the connective endings — that is where an interpreter can
 * start a clause without knowing how the source finishes.
 */
export function splitThoughtUnits(
  text: string,
  maxChars = 60,
  language: string = DEFAULT_LANGUAGE,
): string[] {
  return splitByLanguage(text, language, maxChars);
}
