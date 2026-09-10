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
  /** The stabilised Korean unit, exactly as flushed. Never leaves the engine. */
  text: string;
  /** Engine clock of the oldest stable event in this unit. */
  stableAt: number;
  boundary: FlushBoundary;
  continuesPrevious: boolean;
  provisional: ProvisionalState;
  contextual: ContextualState;
  /** Engine clock when provisional English reached engine state. */
  provisionalAppliedAt?: number;
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
}): LogicalTurn {
  let settle!: (state: ProvisionalState) => void;
  const provisionalSettled = new Promise<ProvisionalState>((resolve) => {
    settle = resolve;
  });
  const turn: LogicalTurn = { ...input, contextual: "queued", provisionalSettled };
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
}

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
});

/** How many turn records the engine keeps for bookkeeping. */
export const MAX_TURN_RECORDS = 64;
