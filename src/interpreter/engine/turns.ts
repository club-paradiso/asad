/**
 * Logical turns and lane bookkeeping for the two-lane engine.
 *
 * A turn is one stabilised Korean unit as the stabiliser flushed it. It gets a
 * monotonically increasing id the moment it is flushed, and every asynchronous
 * result — fast on-device English, slow contextual English — carries that id
 * back. The engine uses the id, together with its session generation, to
 * decide whether a result is still allowed to touch the screen.
 *
 * Everything here is pure data and pure functions so the race rules can be
 * tested without a clock, a browser, or a network.
 */
import type { FlushBoundary } from "./stabiliser";

/** The fast lane's view of one turn. */
export type ProvisionalState =
  /** No on-device translator was ready when the turn flushed. */
  | "off"
  | "pending"
  | "applied"
  /** The translator returned nothing usable, or timed out. */
  | "failed"
  /** The contextual lane rendered this turn first; the late fast result was dropped. */
  | "superseded"
  /** Aborted by stop/restart/invalidation. */
  | "stale";

/** The contextual (cloud) lane's view of one turn. */
export type ContextualState =
  /** Waiting in the coalesced unit behind an in-flight request. */
  | "queued"
  | "inflight"
  /** Appended as fresh English (no provisional chunk existed). */
  | "applied"
  /** Replaced still-editable provisional English. */
  | "refined"
  /** Nothing better arrived; the provisional English stands. */
  | "kept"
  /** Arrived after the provisional English committed; discarded. */
  | "discarded"
  | "stale"
  | "failed"
  /** Dropped from an overfull coalesced unit; provisional English stands. */
  | "skipped";

export interface LogicalTurn {
  id: number;
  /** The stabilised source unit, exactly as flushed. Never leaves the engine. */
  text: string;
  /**
   * Revision of `text`. Starts at 1 and is bumped whenever the source of this
   * turn changes while a result may be in flight (a user correction, an
   * evidence-based repair). A result carries the revision it was built on;
   * if the turn has moved past it, the result is stale by definition.
   */
  revision: number;
  /** Engine clock of the oldest stable event in this unit. */
  stableAt: number;
  boundary: FlushBoundary;
  continuesPrevious: boolean;
  provisional: ProvisionalState;
  contextual: ContextualState;
  /** Engine clock when provisional English reached engine state. */
  provisionalAppliedAt?: number;
  /** Engine clock when the first target-language content for this turn reached state, from any path. */
  firstUsefulAt?: number;
  /** Recogniser confidence for the unit, 0–1, when known. */
  confidence?: number;
  /**
   * Resolves the moment `provisional` stops being `pending` — applied, failed,
   * superseded or stale. The contextual caller waits on this rather than
   * racing the fast lane with a second translation of the same Korean.
   */
  provisionalSettled: Promise<ProvisionalState>;
}

const settlers = new WeakMap<LogicalTurn, (state: ProvisionalState) => void>();

export function createTurn(input: {
  id: number;
  text: string;
  stableAt: number;
  boundary: FlushBoundary;
  continuesPrevious: boolean;
  /** `pending` when a fast lane will run for this turn, else `off`. */
  provisional: "pending" | "off";
  confidence?: number;
}): LogicalTurn {
  let settle!: (state: ProvisionalState) => void;
  const provisionalSettled = new Promise<ProvisionalState>((resolve) => {
    settle = resolve;
  });
  const turn: LogicalTurn = { ...input, revision: 1, contextual: "queued", provisionalSettled };
  settlers.set(turn, settle);
  if (input.provisional === "off") settle("off");
  return turn;
}

/** The only way the fast lane's state changes: assigns and settles together. */
export function settleProvisional(turn: LogicalTurn, state: Exclude<ProvisionalState, "pending">): void {
  turn.provisional = state;
  settlers.get(turn)?.(state);
}

/** One contextual request: one turn, or several coalesced behind a slow cloud. */
export interface ContextualUnit {
  turns: LogicalTurn[];
  /**
   * Revision of each turn at the moment the request was dispatched. A result
   * may only touch a turn whose revision is still the one it was asked about.
   */
  revisions?: Map<number, number>;
}

/** True when every turn in the unit is still on the revision the request saw. */
export const unitRevisionsCurrent = (unit: ContextualUnit): boolean =>
  unit.turns.every((turn) => (unit.revisions?.get(turn.id) ?? turn.revision) === turn.revision);

/**
 * How many turns may wait behind one in-flight cloud request. At the measured
 * ~11 turns/min this is about half a minute of speech; a cloud that is further
 * behind than that is not going to refine anything usefully.
 */
export const MAX_COALESCED_TURNS = 6;
/** Below `interpretRequestSchema.pending`'s 4,000-character cap with margin. */
export const MAX_COALESCED_CHARS = 3_500;

export interface EnqueueResult {
  unit: ContextualUnit;
  /** Turns dropped from the front to keep the unit bounded. */
  dropped: LogicalTurn[];
}

/** Add a turn to the waiting unit, dropping the oldest turns past the bound. */
export function enqueueContextual(unit: ContextualUnit | null, turn: LogicalTurn): EnqueueResult {
  const turns = [...(unit?.turns ?? []), turn];
  const dropped: LogicalTurn[] = [];
  const chars = () => turns.reduce((sum, t) => sum + t.text.length + 1, 0);
  while (turns.length > MAX_COALESCED_TURNS || (turns.length > 1 && chars() > MAX_COALESCED_CHARS)) {
    dropped.push(turns.shift()!);
  }
  return { unit: { turns }, dropped };
}

export const unitText = (unit: ContextualUnit): string =>
  unit.turns.map((t) => t.text).join(" ");

export const unitTurnIds = (unit: ContextualUnit): number[] => unit.turns.map((t) => t.id);

/**
 * Transcript-free counters. Everything here is a number; nothing here is a
 * word anyone said.
 */
export interface LaneStats {
  turns: number;
  provisionalApplied: number;
  provisionalFailed: number;
  provisionalSuperseded: number;
  provisionalStale: number;
  contextualDispatched: number;
  contextualApplied: number;
  contextualRefined: number;
  contextualKept: number;
  contextualDiscardedCommitted: number;
  contextualStale: number;
  contextualFailed: number;
  /** Turns that waited in a coalesced unit rather than dispatching at once. */
  coalescedTurns: number;
  coalesceOverflowDrops: number;
  maxPendingTurns: number;
  maxCloudInFlight: number;
  maxProvisionalInFlight: number;
  /* --- Memory and quality path. Counts only. ---------------------------- */
  /** Validated Translation Memory answered the turn; no model was called. */
  memoryHits: number;
  /** A non-validated memory rendering served as the provisional line. */
  memoryProvisional: number;
  memoryMisses: number;
  /** Cloud turns not dispatched because memory answered. */
  cloudSkipped: number;
  glossaryHits: number;
  /** Source units the Repair Engine examined. */
  repairAttempts: number;
  /** Source repairs actually applied (high-band evidence). */
  repairsAccepted: number;
  /** Medium-band candidates handed to the model as hypotheses instead. */
  hypothesesIssued: number;
  /** Target chunks flagged (number/negation/script/…); nothing rewritten. */
  targetIssuesFlagged: number;
  /** Target chunks deterministically fixed (entity form consistency). */
  targetFixes: number;
  /** Contextual rewrites that were only stylistic and were not shown. */
  contextualKeptStylistic: number;
  /** Results dropped because their turn's source had been revised meanwhile. */
  revisionStale: number;
}

export const emptyLaneStats = (): LaneStats => ({
  turns: 0,
  provisionalApplied: 0,
  provisionalFailed: 0,
  provisionalSuperseded: 0,
  provisionalStale: 0,
  contextualDispatched: 0,
  contextualApplied: 0,
  contextualRefined: 0,
  contextualKept: 0,
  contextualDiscardedCommitted: 0,
  contextualStale: 0,
  contextualFailed: 0,
  coalescedTurns: 0,
  coalesceOverflowDrops: 0,
  maxPendingTurns: 0,
  maxCloudInFlight: 0,
  maxProvisionalInFlight: 0,
  memoryHits: 0,
  memoryProvisional: 0,
  memoryMisses: 0,
  cloudSkipped: 0,
  glossaryHits: 0,
  repairAttempts: 0,
  repairsAccepted: 0,
  hypothesesIssued: 0,
  targetIssuesFlagged: 0,
  targetFixes: 0,
  contextualKeptStylistic: 0,
  revisionStale: 0,
});

/** How many turn records the engine keeps for bookkeeping. */
export const MAX_TURN_RECORDS = 64;
