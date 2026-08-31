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

/** Korean sentence-final endings, plus ordinary terminal punctuation. */
const SENTENCE_END = /(?:다|요|까|죠|네|군요|습니다|십시오|세요)\s*[.?!。？！]?\s*$|[.?!。？！]\s*$/;

/** Clause boundaries — a usable, if weaker, place to break a thought group. */
const CLAUSE_END = /(?:고|며|면서|지만|는데|어서|아서|니까|으니|든지|거나)\s*,?\s*$/;

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
): StabiliserState {
  const clean = text.trim();
  if (!clean) return { ...state, lastEventAt: now };
  return {
    pending: state.pending ? `${state.pending} ${clean}` : clean,
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
): StabiliserState {
  const clean = text.trim();
  if (!clean) return state;
  return {
    pending: state.pending ? `${clean} ${state.pending}` : clean,
    pendingSince: Math.min(state.pendingSince ?? now, now),
    lastEventAt: state.lastEventAt,
  };
}

/** Note recogniser activity without adding anything to the buffer. */
export const touch = (state: StabiliserState, now: number): StabiliserState => ({
  ...state,
  lastEventAt: now,
});

export type FlushReason = "sentence" | "quiet" | "timeout" | "clause" | null;

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
): FlushReason {
  const pending = state.pending.trim();
  if (!pending) return null;

  const waited = state.pendingSince === null ? 0 : now - state.pendingSince;
  const quiet = now - state.lastEventAt;

  if (waited >= config.maxHoldMs) return "timeout";
  if (pending.length < config.minTriggerChars) return null;
  if (SENTENCE_END.test(pending)) return "sentence";
  if (quiet >= config.stabiliseMs) return "quiet";
  // A clause boundary only earns a flush once the buffer is genuinely long.
  if (CLAUSE_END.test(pending) && pending.length >= config.minTriggerChars * 2) {
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
 * Split a stabilised Korean sentence into interpretation-sized units.
 *
 * Korean delays the predicate, so the useful break points are the connective
 * endings — that is where an interpreter can start a clause in English without
 * knowing how the Korean finishes.
 */
export function splitThoughtUnits(text: string, maxChars = 60): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const pieces = clean
    .split(/(?<=(?:고|며|면서|지만|는데|어서|아서|니까|은|는))\s+|(?<=[,、])\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: string[] = [];
  let buffer = "";
  for (const piece of pieces) {
    const candidate = buffer ? `${buffer} ${piece}` : piece;
    if (candidate.length > maxChars && buffer) {
      out.push(buffer);
      buffer = piece;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) out.push(buffer);
  return out;
}
