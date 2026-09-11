/**
 * The interpretation engine.
 *
 * Framework-agnostic state machine sitting between the recogniser and the
 * console. It owns the whole live pipeline:
 *
 *   partial/stable events → stabiliser → local detection → logical turn
 *     ├─ provisional lane: on-device English, rendered at once (when ready)
 *     └─ contextual lane: rolling context → cloud call → legal refinement
 *     → chunk store (temporal locking) → subscribers
 *
 * Two lanes, one truth. Every flushed Korean unit becomes a logical turn with
 * a monotonically increasing id. The fast lane may render provisional English
 * for that turn immediately; the contextual lane may later replace it — but
 * only while every provisional chunk of that turn is still editable, only for
 * the same turn, and only within the session generation that started it.
 * Committed chunks are never touched by either lane.
 *
 * Everything here is deliberately outside React: it is driven by a clock and
 * by provider callbacks, it must keep running while the UI is frozen, and it
 * needs to be testable without rendering anything.
 */
import type {
  BibleReference,
  ConnectionState,
  CorrectionRecord,
  CulturalNote,
  EntityResolution,
  GlossaryItem,
  InterpretationChunk,
  InterpretationMode,
  InterpreterOutput,
  LagProfile,
  PartialTranscript,
  PrepSheet,
  SubsystemHealth,
  TranscriptSegment,
} from "@/types";
import { emptyPrepSheet } from "@/types";
import type { InterpretRequest } from "@/lib/schema";
import { detectScriptureReferences } from "../scripture/detect";
import { liveGlossary, mergeGlossary, promptGlossary } from "../glossary/matcher";
import { detectCultural, dedupeNotes } from "../cultural/detect";
import { buildRollingContext } from "../context/rolling";
import {
  applyCorrection,
  applyCorrectionsToText,
  emptyMemory,
  memoryFromPrep,
  rememberKnowledge,
  type SessionMemory,
} from "../context/memory";
import {
  clearAnticipated,
  commitAll,
  commitDueChunks,
  insertTurnChunks,
  refineProvisionalChunks,
  refinementLegality,
  setAnticipatedChunks,
  trimChunks,
} from "./chunks";
import { lagConfig } from "./lag";
import {
  createTurn,
  emptyLaneStats,
  enqueueContextual,
  MAX_TURN_RECORDS,
  settleProvisional,
  unitText,
  unitTurnIds,
  type ContextualState,
  type ContextualUnit,
  type LaneStats,
  type LogicalTurn,
} from "./turns";
import {
  drain,
  emptyStabiliser,
  flushReason,
  pushStable,
  restorePending,
  shouldAnticipate,
  touch,
  type FlushBoundary,
  type StabiliserState,
} from "./stabiliser";

export interface EngineSnapshot {
  segments: TranscriptSegment[];
  partial: PartialTranscript | null;
  chunks: InterpretationChunk[];
  scripture: BibleReference[];
  glossary: GlossaryItem[];
  culturalNotes: CulturalNote[];
  entities: EntityResolution[];
  corrections: CorrectionRecord[];
  topic?: string;
  connection: ConnectionState;
  health: SubsystemHealth;
  /** Set when a subsystem is running in a reduced mode. */
  degradedReason?: string;
  /** True while an interpretation call is in flight. */
  thinking: boolean;
}

export interface InterpretResult {
  output: InterpreterOutput;
  degraded?: boolean;
  reason?: string;
  /** Browser clock time immediately before the first fetch for this turn. */
  clientDispatchedAt?: number;
  provider?: string;
  model?: string;
}

/** What the contextual lane did with a result, once it was allowed to act. */
export type ContextualOutcome =
  | "applied"
  | "refined"
  | "kept"
  | "discarded"
  | "stale";

export interface TurnTiming {
  /** Logical turn the timing belongs to. An id, never content. */
  turnId: number;
  lane: "provisional" | "contextual";
  stableAt: number;
  clientDispatchedAt?: number;
  safeAt: number;
  provider?: string;
  model?: string;
  hasSafe: boolean;
  hasAnticipated: boolean;
  /** Contextual lane only. */
  outcome?: ContextualOutcome;
  /** Engine clock when the fast lane's English reached state, if it did. */
  provisionalAppliedAt?: number;
}

/** What the engine tells the contextual caller about the turn it is carrying. */
export interface ContextualTurnInfo {
  turnIds: number[];
  /**
   * Resolves true once every turn in the request has provisional English on
   * screen, false as soon as any of them will not get it. A caller whose
   * cloud path fails waits on this instead of paying for a second on-device
   * translation of the same Korean — and never waits on a lane that is off.
   */
  provisionalSettled: () => Promise<boolean>;
}

/**
 * The fast lane. Only a genuine, already-ready on-device translator belongs
 * here: a deterministic helper is not translation, and a language pack that
 * is still downloading is not ready.
 */
export interface ProvisionalLane {
  /** Answered synchronously at flush time; never awaits a download. */
  isReady(): boolean;
  translate(text: string, signal: AbortSignal): Promise<InterpreterOutput | null>;
  provider?: string;
  model?: string;
}

export interface EngineOptions {
  mode: InterpretationMode;
  lag: LagProfile;
  prep?: PrepSheet;
  /** Performs one contextual interpretation call. Injected so tests need no network. */
  interpret: (
    request: InterpretRequest,
    signal: AbortSignal,
    turn: ContextualTurnInfo,
  ) => Promise<InterpretResult>;
  /** Fast on-device lane. Absent, or not ready, means cloud-first behaviour. */
  provisional?: ProvisionalLane;
  /** Optional Scripture text resolution. Omitted in demo/offline. */
  resolveBible?: (reference: BibleReference) => Promise<BibleReference>;
  /** Browser-only latency hook. Carries times and provider labels, never text. */
  onTurnTiming?: (timing: TurnTiming) => void;
  onChange: (snapshot: EngineSnapshot) => void;
  /** Injectable clock — tests drive time directly. */
  now?: () => number;
}

/**
 * A fast lane that has not answered by now is not fast. The turn's contextual
 * request is already running and will carry the Korean instead.
 */
export const PROVISIONAL_TIMEOUT_MS = 2_500;

/**
 * How many Scripture hints one turn may carry. Matches the cap in
 * `interpretRequestSchema.detected.scripture`, so a hint is never silently
 * rejected by the API's own validation.
 */
const SCRIPTURE_HINT_LIMIT = 4;

let segmentCounter = 0;
const nextSegmentId = () => `s${(segmentCounter += 1).toString(36)}`;
/** Test seam. */
export const __resetSegmentIds = () => {
  segmentCounter = 0;
};

export class InterpretationEngine {
  private mode: InterpretationMode;
  private lag: LagProfile;
  private prep: PrepSheet;

  private segments: TranscriptSegment[] = [];
  private partial: PartialTranscript | null = null;
  private chunks: InterpretationChunk[] = [];
  private scripture: BibleReference[] = [];
  private culturalNotes: CulturalNote[] = [];
  private memory: SessionMemory = emptyMemory();
  private stabiliser: StabiliserState = emptyStabiliser();
  /** Oldest stable event represented by pending text, preserved across a failed turn. */
  private pendingOriginAt: number | null = null;

  private connection: ConnectionState = "idle";
  private health: SubsystemHealth = { stt: "ok", llm: "ok", bible: "ok" };
  private degradedReason: string | undefined;

  private startedAt = 0;
  private stopped = false;
  /**
   * Bumped by start(), stop() and mode changes. A result created under an
   * older generation is dropped no matter which lane it came from.
   */
  private generation = 0;
  private turnCounter = 0;
  private turns: LogicalTurn[] = [];
  private cloudInFlight: AbortController | null = null;
  /** Turns waiting behind the in-flight cloud request. At most one unit. */
  private pendingUnit: ContextualUnit | null = null;
  private provisionalInFlight: { controller: AbortController; turn: LogicalTurn; startedAt: number } | null = null;
  private stats: LaneStats = emptyLaneStats();
  /**
   * How the previous unit ended. Anything but `sentence` means the speaker's
   * thought was still open when the clock forced the call, so the next unit
   * continues English the interpreter has probably already started saying.
   */
  private lastBoundary: FlushBoundary | null = null;

  constructor(private readonly options: EngineOptions) {
    this.mode = options.mode;
    this.lag = options.lag;
    this.prep = options.prep ?? emptyPrepSheet();
    this.memory = memoryFromPrep(this.prep);
  }

  private get clock(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  /** ms since the session began — the timeline every timestamp uses. */
  private elapsed(): number {
    return Math.max(0, this.clock - this.startedAt);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    // Anything still running belongs to a previous life of this instance.
    this.invalidateOutstanding({ restore: false });
    this.startedAt = this.clock;
    this.stopped = false;
    this.lastBoundary = null;
    this.pendingOriginAt = null;
    this.stabiliser = { ...emptyStabiliser(), lastEventAt: 0 };
    this.setConnection("connecting");
  }

  /**
   * Flush whatever finalised Korean is still waiting without requiring another
   * clock tick. Used during graceful shutdown after the recogniser has been
   * sealed, so the final spoken thought is not lost merely because End was
   * pressed before the normal stabilisation timer fired.
   */
  async flushPending(): Promise<void> {
    if (this.stopped || !this.canFlush() || !this.stabiliser.pending.trim()) return;
    await this.flush("quiet");
  }

  stop(): void {
    this.stopped = true;
    this.invalidateOutstanding({ restore: false });
    // Anything still editable is now final — the session is over.
    this.chunks = commitAll(clearAnticipated(this.chunks));
    this.setConnection("idle");
  }

  /**
   * A mode switch changes the contract every in-flight request was built on.
   * Outstanding results are invalidated; their Korean is put back so the next
   * turn interprets it under the new mode rather than losing it.
   */
  setMode(mode: InterpretationMode): void {
    if (mode !== this.mode) this.invalidateOutstanding({ restore: !this.stopped });
    this.mode = mode;
    this.emit();
  }

  /** Transcript-free lane counters, for diagnostics and the soak harness. */
  laneStats(): LaneStats {
    return { ...this.stats };
  }

  /**
   * Abort every outstanding lane result and advance the generation so a
   * result that slips past the abort is still recognised as foreign.
   */
  private invalidateOutstanding(options: { restore: boolean }): void {
    this.generation += 1;
    const orphaned: LogicalTurn[] = [];

    if (this.provisionalInFlight) {
      const { controller, turn } = this.provisionalInFlight;
      this.provisionalInFlight = null;
      controller.abort();
      settleProvisional(turn, "stale");
      this.stats.provisionalStale += 1;
      if (turn.contextual === "inflight" || turn.contextual === "queued") orphaned.push(turn);
    }
    if (this.cloudInFlight) {
      this.cloudInFlight.abort();
      this.cloudInFlight = null;
      this.stats.contextualStale += 1;
    }
    for (const turn of this.turns) {
      if (turn.contextual === "inflight" || turn.contextual === "queued") {
        turn.contextual = "stale";
        if (!orphaned.includes(turn)) orphaned.push(turn);
      }
    }
    this.pendingUnit = null;

    if (!options.restore) return;
    // Only Korean with no English on screen is worth re-interpreting.
    const uncovered = orphaned.filter((t) => t.provisional !== "applied");
    for (const turn of [...uncovered].reverse()) {
      this.stabiliser = restorePending(this.stabiliser, turn.text, this.clock);
      this.pendingOriginAt = Math.min(this.pendingOriginAt ?? turn.stableAt, turn.stableAt);
    }
  }

  setLag(lag: LagProfile): void {
    this.lag = lag;
    this.emit();
  }

  setPrep(prep: PrepSheet): void {
    this.prep = prep;
    // Prep decisions merge in without discarding what the session has learned.
    const seeded = memoryFromPrep(prep);
    this.memory = {
      ...this.memory,
      glossary: mergeGlossary(seeded.glossary, this.memory.glossary),
      entities: [
        ...seeded.entities,
        ...this.memory.entities.filter(
          (e) => !seeded.entities.some((s) => s.korean === e.korean),
        ),
      ],
      topic: this.memory.topic ?? seeded.topic,
    };
    this.emit();
  }

  setConnection(connection: ConnectionState): void {
    this.connection = connection;
    this.emit();
  }

  setHealth(
    part: keyof SubsystemHealth,
    status: SubsystemHealth[keyof SubsystemHealth],
    reason?: string,
  ): void {
    if (this.health[part] === status && (!reason || reason === this.degradedReason)) return;
    this.health = { ...this.health, [part]: status };
    this.degradedReason = status === "ok" ? undefined : reason ?? this.degradedReason;
    this.emit();
  }

  // -------------------------------------------------------------------------
  // Recogniser input
  // -------------------------------------------------------------------------

  handlePartial(text: string): void {
    if (this.stopped) return;
    const corrected = applyCorrectionsToText(text.trim(), this.memory.corrections);
    this.partial = corrected ? { text: corrected, at: this.elapsed() } : null;
    this.stabiliser = touch(this.stabiliser, this.clock);
    this.emit();
  }

  handleStable(text: string): void {
    if (this.stopped) return;
    const corrected = applyCorrectionsToText(text.trim(), this.memory.corrections);
    if (!corrected) return;

    const stableAt = this.clock;
    this.segments = [
      ...this.segments,
      { id: nextSegmentId(), text: corrected, at: Math.max(0, stableAt - this.startedAt) },
    ];
    this.partial = null;
    if (!this.stabiliser.pending.trim() && this.pendingOriginAt === null) {
      this.pendingOriginAt = stableAt;
    }
    this.stabiliser = pushStable(this.stabiliser, corrected, stableAt);

    // Local detection is instant and does not wait for the model.
    this.absorbLocalDetection(corrected);
    this.emit();
  }

  /**
   * Drive the clock. Called on an interval by the host; every time-dependent
   * transition happens here so the engine has exactly one source of "now".
   */
  tick(): void {
    if (this.stopped) return;

    const config = lagConfig(this.lag);
    const before = this.chunks;
    this.chunks = commitDueChunks(this.chunks, this.elapsed(), config.commitDwellMs);

    // A fast lane that has stalled must not hold the pipeline. The timeout is
    // decided here, on the engine clock, and is final: the slot is freed and
    // the turn marked failed whether or not the translator ever answers. The
    // contextual request already running carries the turn.
    const provisional = this.provisionalInFlight;
    if (provisional && this.clock - provisional.startedAt >= PROVISIONAL_TIMEOUT_MS) {
      this.provisionalInFlight = null;
      settleProvisional(provisional.turn, "failed");
      this.stats.provisionalFailed += 1;
      provisional.controller.abort();
    }

    const reason = flushReason(this.stabiliser, config, this.clock);
    if (reason && this.canFlush()) {
      void this.flush(reason);
      return;
    }

    if (this.chunks !== before) this.emit();
  }

  /**
   * Whether the stabiliser may hand over its next unit.
   *
   * With a ready fast lane the cloud may be busy — the unit still gets
   * provisional English now and joins the coalesced contextual unit. Without
   * one, the engine stays single-flight exactly as before: the stabiliser
   * buffer is the queue, and it holds one growing unit rather than a list.
   */
  private canFlush(): boolean {
    if (this.options.provisional?.isReady()) return this.provisionalInFlight === null;
    return this.cloudInFlight === null && this.pendingUnit === null;
  }

  // -------------------------------------------------------------------------
  // Interpretation
  // -------------------------------------------------------------------------

  private async flush(reason: FlushBoundary): Promise<void> {
    const stableAt = this.pendingOriginAt ?? this.stabiliser.pendingSince ?? this.clock;
    const { text: pending, state } = drain(this.stabiliser);
    this.stabiliser = state;
    this.pendingOriginAt = null;
    if (!pending) return;

    const lane = this.options.provisional;
    const laneReady = !!lane && lane.isReady();
    const turn = createTurn({
      id: (this.turnCounter += 1),
      text: pending,
      stableAt,
      boundary: reason,
      continuesPrevious: this.lastBoundary !== null && this.lastBoundary !== "sentence",
      provisional: laneReady ? "pending" : "off",
    });
    this.turns.push(turn);
    if (this.turns.length > MAX_TURN_RECORDS) this.turns.splice(0, this.turns.length - MAX_TURN_RECORDS);
    this.stats.turns += 1;

    // Recorded before any await: a failed turn still cut the Korean where it
    // cut it, and the unit restored by `restorePending` is the same open
    // thought the next call has to finish.
    this.lastBoundary = reason;

    const provisionalWork = laneReady && lane ? this.runProvisional(lane, turn) : Promise.resolve();
    const contextualWork = this.scheduleContextual(turn);
    await Promise.all([provisionalWork, contextualWork]);
  }

  // --- Lane A: provisional ----------------------------------------------------

  private async runProvisional(lane: ProvisionalLane, turn: LogicalTurn): Promise<void> {
    const controller = new AbortController();
    this.provisionalInFlight = { controller, turn, startedAt: this.clock };
    this.stats.maxProvisionalInFlight = Math.max(this.stats.maxProvisionalInFlight, 1);
    this.emit();

    // Timeout, stop, restart and mode change all decide the turn's fate before
    // the translator answers, and they say so in the turn record. A result
    // that arrives after that is simply dropped; it was already counted.
    const decided = () => turn.provisional !== "pending";

    try {
      const output = await lane.translate(turn.text, controller.signal);
      if (decided()) return;
      if (!output || output.safeChunks.length === 0) {
        settleProvisional(turn, "failed");
        this.stats.provisionalFailed += 1;
        return;
      }
      if (turn.contextual === "applied" || turn.contextual === "refined") {
        // The cloud beat the on-device path. Its English is already on screen
        // and is the better rendering; a second copy would be noise.
        settleProvisional(turn, "superseded");
        this.stats.provisionalSuperseded += 1;
        return;
      }
      this.applyProvisional(lane, turn, output);
    } catch {
      if (decided()) return;
      settleProvisional(turn, "failed");
      this.stats.provisionalFailed += 1;
    } finally {
      if (this.provisionalInFlight?.controller === controller) this.provisionalInFlight = null;
      this.emit();
    }
  }

  /**
   * Provisional English is rendered and nothing else. The fast lane has no
   * sermon contract, so it is never allowed to teach the rolling memory:
   * glossary, entities, Scripture and topic come from the contextual lane.
   */
  private applyProvisional(lane: ProvisionalLane, turn: LogicalTurn, output: InterpreterOutput): void {
    const now = this.elapsed();
    const drafts = output.safeChunks.map((d) => ({ text: d.text, confidence: d.confidence }));
    const { chunks, added } = insertTurnChunks(this.chunks, drafts, [turn.id], now, { provisional: true });
    this.chunks = trimChunks(chunks);
    turn.provisionalAppliedAt = this.clock;
    settleProvisional(turn, "applied");
    this.stats.provisionalApplied += 1;
    this.options.onTurnTiming?.({
      turnId: turn.id,
      lane: "provisional",
      stableAt: turn.stableAt,
      safeAt: this.clock,
      provider: lane.provider,
      model: lane.model,
      hasSafe: added.length > 0,
      hasAnticipated: false,
    });
  }

  // --- Lane B: contextual -----------------------------------------------------

  private scheduleContextual(turn: LogicalTurn): Promise<void> {
    if (this.cloudInFlight) {
      const { unit, dropped } = enqueueContextual(this.pendingUnit, turn);
      this.pendingUnit = unit;
      turn.contextual = "queued";
      this.stats.coalescedTurns += 1;
      this.stats.maxPendingTurns = Math.max(this.stats.maxPendingTurns, unit.turns.length);
      for (const old of dropped) {
        old.contextual = "skipped";
        this.stats.coalesceOverflowDrops += 1;
        // A skipped turn with no English at all goes back to the stabiliser
        // rather than vanishing. It will flush again as a new turn.
        if (old.provisional !== "applied") {
          this.stabiliser = restorePending(this.stabiliser, old.text, this.clock);
          this.pendingOriginAt = Math.min(this.pendingOriginAt ?? old.stableAt, old.stableAt);
        }
      }
      return Promise.resolve();
    }
    return this.dispatchContextual({ turns: [turn] });
  }

  private async dispatchContextual(unit: ContextualUnit): Promise<void> {
    const turnIds = unitTurnIds(unit);
    const first = unit.turns[0];
    const last = unit.turns[unit.turns.length - 1];
    const pending = unitText(unit);

    const config = lagConfig(this.lag);
    const partial = this.partial?.text ?? "";
    const allowAnticipation = shouldAnticipate(config, last.boundary, partial);
    const detectedScripture = this.scriptureHints(pending);

    // The model is asked for this unit's English; its own provisional rendering
    // must not be offered back to it as delivered context.
    const contextChunks = this.chunks.filter(
      (c) => !(c.provisional && c.turnId !== undefined && turnIds.includes(c.turnId)),
    );

    const request: InterpretRequest = {
      mode: this.mode,
      lag: this.lag,
      pending,
      partial: allowAnticipation ? partial : undefined,
      context: buildRollingContext({
        segments: this.segments,
        chunks: contextChunks,
        memory: this.memory,
        mode: this.mode,
        prep: this.prep,
      }),
      detected: {
        scripture: detectedScripture,
        // The model's copy, not the rail's: discourse markers stay in.
        glossary: promptGlossary(pending, this.mode, this.memory.glossary),
        culturalNotes: detectCultural(pending, this.memory.entities),
      },
      boundary: last.boundary,
      continuesPrevious: first.continuesPrevious,
      allowAnticipation,
    };

    const controller = new AbortController();
    const generation = this.generation;
    this.cloudInFlight = controller;
    for (const turn of unit.turns) turn.contextual = "inflight";
    this.stats.contextualDispatched += 1;
    this.stats.maxCloudInFlight = Math.max(this.stats.maxCloudInFlight, 1);
    this.emit();

    const isStale = () =>
      this.stopped || controller.signal.aborted || generation !== this.generation;

    try {
      const result = await this.options.interpret(request, controller.signal, {
        turnIds,
        provisionalSettled: () =>
          Promise.all(unit.turns.map((t) => t.provisionalSettled)).then((states) =>
            states.every((state) => state === "applied"),
          ),
      });
      if (isStale()) {
        this.recordStale(unit, result);
        return;
      }
      this.applyContextual(unit, result, allowAnticipation);
      this.setHealth("llm", result.degraded ? "degraded" : "ok", result.reason);
      void this.enrichScripture();
    } catch (error) {
      if (isStale()) {
        this.recordStale(unit);
        return;
      }
      for (const turn of unit.turns) turn.contextual = "failed";
      this.stats.contextualFailed += 1;
      // Do not discard a thought merely because the network or free model had
      // a bad turn. New stable speech may have arrived while this request was
      // running, so restore the failed unit in front of that newer text —
      // but only the Korean that has no English on screen at all.
      const uncovered = unit.turns.filter((t) => t.provisional !== "applied");
      for (const turn of [...uncovered].reverse()) {
        this.stabiliser = restorePending(this.stabiliser, turn.text, this.clock);
        this.pendingOriginAt = Math.min(this.pendingOriginAt ?? turn.stableAt, turn.stableAt);
      }
      this.setHealth(
        "llm",
        "down",
        error instanceof Error ? error.message : "Interpretation is unavailable.",
      );
    } finally {
      if (this.cloudInFlight === controller) this.cloudInFlight = null;
      this.emit();
      // The bound is one request in flight: the next coalesced unit goes now.
      if (!this.stopped && generation === this.generation && this.pendingUnit) {
        const next = this.pendingUnit;
        this.pendingUnit = null;
        void this.dispatchContextual(next);
      }
    }
  }

  /** Already counted by `invalidateOutstanding`; this only reports the timing. */
  private recordStale(unit: ContextualUnit, result?: InterpretResult): void {
    for (const turn of unit.turns) turn.contextual = "stale";
    const last = unit.turns[unit.turns.length - 1];
    this.options.onTurnTiming?.({
      turnId: last.id,
      lane: "contextual",
      stableAt: unit.turns[0].stableAt,
      clientDispatchedAt: result?.clientDispatchedAt,
      safeAt: this.clock,
      provider: result?.provider,
      model: result?.model,
      hasSafe: false,
      hasAnticipated: false,
      outcome: "stale",
    });
  }

  /**
   * Decide what a contextual result may still do, then do exactly that.
   *
   *   refine    every provisional chunk of these turns is still editable →
   *             replace them in place.
   *   locked    the interpreter may have said the provisional line → drop the
   *             rewrite; keep the knowledge.
   *   fresh     no provisional English exists → append, as the engine always
   *             has; older-turn results slot in ahead of newer editable turns.
   *
   * Knowledge (glossary, entities, Scripture, topic, cultural notes) is
   * absorbed in every non-stale case: it is the trusted source for memory
   * whether or not its chunks were allowed on screen.
   */
  private applyContextual(unit: ContextualUnit, result: InterpretResult, allowAnticipation: boolean): void {
    const output = result.output;
    const turnIds = unitTurnIds(unit);
    const now = this.elapsed();
    const legality = refinementLegality(this.chunks, turnIds);
    const newest = turnIds.includes(this.turnCounter);
    const drafts = output.safeChunks;

    let chunks = this.chunks;
    let outcome: ContextualOutcome;
    let state: ContextualState;
    let hasSafe = false;

    if (legality === "fresh") {
      const added = insertTurnChunks(chunks, drafts, turnIds, now);
      chunks = added.chunks;
      hasSafe = added.added.length > 0;
      outcome = "applied";
      state = "applied";
      this.stats.contextualApplied += 1;
    } else if (legality === "refine") {
      const refined = refineProvisionalChunks(chunks, turnIds, drafts, now);
      chunks = refined.chunks;
      hasSafe = drafts.length > 0;
      outcome = refined.changed ? "refined" : "kept";
      state = refined.changed ? "refined" : "kept";
      if (refined.changed) this.stats.contextualRefined += 1;
      else this.stats.contextualKept += 1;
    } else {
      // Locked. If the cloud had nothing to say the provisional simply stands;
      // if it had a rewrite, that rewrite arrived after the line was spoken.
      if (drafts.length > 0) {
        outcome = "discarded";
        state = "discarded";
        this.stats.contextualDiscardedCommitted += 1;
      } else {
        outcome = "kept";
        state = "kept";
        this.stats.contextualKept += 1;
      }
    }

    // A prediction only makes sense off the newest turn; anything older has
    // already been followed by real Korean. Predictions are never kept next to
    // a locked line the interpreter has moved past.
    const predict =
      newest && legality !== "locked" && allowAnticipation && (output.anticipatedChunks?.length ?? 0) > 0;
    if (predict) {
      chunks = setAnticipatedChunks(chunks, output.anticipatedChunks!, now);
    } else if (newest || legality === "fresh") {
      chunks = clearAnticipated(chunks);
    }

    this.chunks = trimChunks(chunks);
    for (const turn of unit.turns) turn.contextual = state;
    this.absorbContextualKnowledge(output);

    this.options.onTurnTiming?.({
      turnId: unit.turns[unit.turns.length - 1].id,
      lane: "contextual",
      stableAt: unit.turns[0].stableAt,
      clientDispatchedAt: result.clientDispatchedAt,
      safeAt: this.clock,
      provider: result.provider,
      model: result.model,
      hasSafe,
      hasAnticipated: predict,
      outcome,
      provisionalAppliedAt: unit.turns[0].provisionalAppliedAt,
    });
  }

  private absorbContextualKnowledge(output: InterpreterOutput): void {
    if (output.bibleReferences?.length) this.absorbScripture(output.bibleReferences);
    if (output.culturalNotes?.length) {
      this.culturalNotes = dedupeNotes([...output.culturalNotes, ...this.culturalNotes]).slice(0, 12);
    }
    this.memory = rememberKnowledge(this.memory, {
      glossary: output.glossary,
      entities: output.entities,
      scripture: output.bibleReferences?.map((r) => r.display),
      topic: output.topic,
    });
  }

  /** Detection that runs locally, the instant Korean stabilises. */
  private absorbLocalDetection(text: string): void {
    const refs = detectScriptureReferences(text).map(({ index: _index, ...ref }) => ref);
    if (refs.length) this.absorbScripture(refs);

    const notes = detectCultural(text, this.memory.entities);
    if (notes.length) {
      this.culturalNotes = dedupeNotes([...notes, ...this.culturalNotes]).slice(0, 12);
    }

    const terms = liveGlossary(text, this.mode, this.memory.glossary);
    if (terms.length) {
      this.memory = rememberKnowledge(this.memory, { glossary: terms });
    }
  }

  /**
   * Scripture hints for one interpretation turn.
   *
   * Two things the model needs and previously never received:
   *
   *  1. **Verse text for a reference detected in this segment.** The prompt
   *     renders `text` and `SERMON_DELTA` says "Reference only, never wording,
   *     unless the verse text was supplied to you" — but the request was built
   *     from a fresh `detectScriptureReferences` call, which never carries
   *     text. The branch was unreachable, so a verse resolved through
   *     `/api/bible` sat on the interpreter's screen while the model was still
   *     forbidden to render it.
   *
   *  2. **The passage currently being read.** A preacher names the reference
   *     once and then reads the verse; from the next segment on, nothing in the
   *     Korean matches the detector, and the hint disappeared exactly when it
   *     became useful. The most recently resolved passage is carried forward.
   *
   * Only one passage is carried. Verse text is not free — this runs ~11 times
   * a minute for the length of a service — and the passage in play is the one
   * being read.
   */
  private scriptureHints(pending: string): BibleReference[] {
    const detected = detectScriptureReferences(pending).map(({ index: _index, ...ref }) => ref);

    const withText = detected.map((ref) => {
      const resolved = this.scripture.find((r) => r.display === ref.display && r.text);
      return resolved
        ? { ...ref, text: resolved.text, translation: resolved.translation }
        : ref;
    });

    const carried = this.scripture
      .filter((r) => r.text && !withText.some((d) => d.display === r.display))
      .slice(-1);

    return [...withText, ...carried].slice(0, SCRIPTURE_HINT_LIMIT);
  }

  private absorbScripture(refs: BibleReference[]): void {
    const merged = [...this.scripture];
    for (const ref of refs) {
      const at = merged.findIndex((r) => r.display === ref.display);
      if (at === -1) merged.push(ref);
      else if (!merged[at].text && ref.text) merged[at] = ref;
    }
    this.scripture = merged.slice(-8);
    this.memory = rememberKnowledge(this.memory, { scripture: refs.map((r) => r.display) });
  }

  /** Fill in verse text for any reference that does not have it yet. */
  private async enrichScripture(): Promise<void> {
    const resolve = this.options.resolveBible;
    if (!resolve) return;
    const pending = this.scripture.filter((r) => !r.text && r.verse !== undefined);
    if (pending.length === 0) return;

    for (const reference of pending.slice(-2)) {
      try {
        const resolved = await resolve(reference);
        if (this.stopped) return;
        if (resolved.text) {
          this.absorbScripture([resolved]);
          this.setHealth("bible", "ok");
          this.emit();
        }
      } catch {
        // A missing verse is a non-event: the reference is already on screen.
        this.setHealth(
          "bible",
          "degraded",
          "Scripture lookup failed — showing references only.",
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Interpreter corrections
  // -------------------------------------------------------------------------

  /**
   * The interpreter overrules the recogniser. This is absolute and permanent
   * for the rest of the session: past transcript is rewritten, and every
   * future recognition of the wrong form is corrected before anything sees it.
   */
  correct(from: string, to: string, english?: string): void {
    const record: CorrectionRecord = { from, to, at: this.elapsed(), english };
    this.memory = applyCorrection(this.memory, record);

    this.segments = this.segments.map((segment) =>
      segment.text.includes(from)
        ? {
            ...segment,
            text: segment.text.split(from).join(to),
            corrected: true,
            originalText: segment.originalText ?? segment.text,
          }
        : segment,
    );

    this.emit();
  }

  // -------------------------------------------------------------------------
  // Snapshot
  // -------------------------------------------------------------------------

  snapshot(): EngineSnapshot {
    return {
      segments: this.segments,
      partial: this.partial,
      chunks: this.chunks,
      scripture: this.scripture,
      glossary: this.memory.glossary,
      culturalNotes: this.culturalNotes,
      entities: this.memory.entities,
      corrections: this.memory.corrections,
      topic: this.memory.topic,
      connection: this.connection,
      health: this.health,
      degradedReason: this.degradedReason,
      thinking: this.cloudInFlight !== null || this.provisionalInFlight !== null,
    };
  }

  private emit(): void {
    this.options.onChange(this.snapshot());
  }
}
