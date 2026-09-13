/**
 * The interpretation engine.
 *
 * Framework-agnostic state machine sitting between the recogniser and the
 * console. It owns the whole live pipeline:
 *
 *   partial/stable events → normalise → Repair Engine (source) → stabiliser
 *     → logical turn (id + revision)
 *       ├─ fast path:    validated Translation Memory → deterministic, no model
 *       │                memory rendering / on-device translator → provisional
 *       └─ quality path: rolling context → cloud call → Repair Engine (target)
 *                        → stability gate → legal refinement
 *     → chunk store (temporal locking) → subscribers
 *
 * Two paths, one truth. Every flushed source unit becomes a logical turn with
 * a monotonically increasing id and a revision. The fast path may render
 * provisional target text for that turn immediately; the quality path may
 * later replace it — but only while every provisional chunk of that turn is
 * still editable, only for the same turn and revision, only within the
 * session generation that started it, and only when the replacement corrects
 * something rather than restyles it. Committed chunks are never touched.
 *
 * Everything here is deliberately outside React: it is driven by a clock and
 * by provider callbacks, it must keep running while the UI is frozen, and it
 * needs to be testable without rendering anything.
 */
import type {
  BibleReference,
  ConnectionState,
  ContextDomain,
  CorrectionRecord,
  CulturalNote,
  DomainInference,
  EntityResolution,
  GlossaryItem,
  InterpretationChunk,
  InterpretationMode,
  InterpreterOutput,
  LagProfile,
  LanguagePair,
  PartialTranscript,
  PrepSheet,
  RepairKind,
  StableTranscriptMeta,
  SubsystemHealth,
  TranscriptSegment,
} from "@/types";
import { emptyPrepSheet, layerForDomain } from "@/types";
import type { InterpretRequest } from "@/lib/schema";
import { canonicalPair, languageBase } from "@/languages/registry";
import { HAS_CONTENT } from "@/languages/segmentation";
import { normaliseTranscript } from "@/languages/normalise";
import { romaniseName } from "@/lib/romanise";
import { detectScriptureReferences } from "../scripture/detect";
import { liveGlossary, mergeGlossary, promptGlossary } from "../glossary/matcher";
import { detectCultural, dedupeNotes } from "../cultural/detect";
import { buildRollingContext } from "../context/rolling";
import {
  createContextEngine,
  currentDomain,
  observe as observeContext,
  setManualContext,
  type ContextEngineState,
} from "../context/engine";
import {
  applyCorrection,
  applyCorrectionsToText,
  emptyMemory,
  memoryFromPrep,
  rememberKnowledge,
  type SessionMemory,
} from "../context/memory";
import {
  emptyEntityMemory,
  entitiesForContext,
  establishEntity,
  seedEntities,
  type EntityMemoryState,
} from "../memory/entity-memory";
import {
  emptyTranslationMemory,
  hintsFor,
  lookup as lookupMemory,
  remember as rememberTranslation,
  type TranslationMemoryState,
} from "../memory/translation-memory";
import type { CanonicalEntity, TranslationMemoryEntry, TranslationMemoryHit } from "../memory/types";
import { assessSource, assessTarget, type SourceAssessment } from "../repair/assess";
import { materiallyDifferent } from "../repair/stability";
import {
  appendCorrection,
  clearAnticipated,
  commitAll,
  commitDueChunks,
  insertTurnChunks,
  provisionalChunksFor,
  refineProvisionalChunks,
  refinementLegality,
  setAnticipatedChunks,
  trimChunks,
  type ChunkDraft,
} from "./chunks";
import { lagConfig } from "./lag";
import { routeTurn, type RouteTier } from "./routing";
import {
  createTurn,
  emptyLaneStats,
  enqueueContextual,
  MAX_TURN_RECORDS,
  settleProvisional,
  unitRevisionsCurrent,
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
  languagePair: LanguagePair;
  /** What the Context Engine currently believes the room is. */
  domain: DomainInference;
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
  /** True when this result put the FIRST target-language content for the turn on screen. */
  firstUseful?: boolean;
  /** Engine clock when the quality path began evaluating the cloud result. */
  qualityStartAt?: number;
  /** Target chunks the Repair Engine flagged or fixed in this result. */
  issuesFlagged?: number;
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

/** Learnings the host may persist between sessions, under the user's setting. */
export interface EngineLearnings {
  corrections: CorrectionRecord[];
  entities: CanonicalEntity[];
  memory: TranslationMemoryEntry[];
}

export interface EngineOptions {
  /** Defaults to Korean → English, the pair every detector was written for. */
  languagePair?: Partial<LanguagePair>;
  /** `auto` unless the interpreter overrode it. */
  context?: ContextDomain;
  lag: LagProfile;
  prep?: PrepSheet;
  /** Learnings from earlier sessions in this browser, when the user allowed them. */
  persisted?: Partial<EngineLearnings>;
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
 * A remembered rendering below this score is a hint for the model, not a
 * line for the screen.
 */
export const MEMORY_PROVISIONAL_MIN_SCORE = 0.9;

/** Provider labels for memory answers, so telemetry can tell them apart. */
export const TRANSLATION_MEMORY_PROVIDER = "translation-memory";

/**
 * How many Scripture hints one turn may carry. Matches the cap in
 * `interpretRequestSchema.detected.scripture`, so a hint is never silently
 * rejected by the API's own validation.
 */
const SCRIPTURE_HINT_LIMIT = 4;
const HYPOTHESIS_LIMIT = 4;
const MEMORY_HINT_LIMIT = 6;
/** Entities offered to the prompt and the rail. */
const ENTITY_CONTEXT_LIMIT = 32;

let segmentCounter = 0;
const nextSegmentId = () => `s${(segmentCounter += 1).toString(36)}`;
/** Test seam. */
export const __resetSegmentIds = () => {
  segmentCounter = 0;
};

interface TurnHypothesis {
  heard: string;
  candidate: string;
  reason: string;
}

export class InterpretationEngine {
  private readonly pair: LanguagePair;
  private lag: LagProfile;
  private prep: PrepSheet;

  private segments: TranscriptSegment[] = [];
  private partial: PartialTranscript | null = null;
  private chunks: InterpretationChunk[] = [];
  private scripture: BibleReference[] = [];
  private culturalNotes: CulturalNote[] = [];
  private memory: SessionMemory = emptyMemory();
  private entities: EntityMemoryState = emptyEntityMemory();
  private translationMemory: TranslationMemoryState = emptyTranslationMemory();
  private context: ContextEngineState;
  private stabiliser: StabiliserState = emptyStabiliser();
  /** Oldest stable event represented by pending text, preserved across a failed turn. */
  private pendingOriginAt: number | null = null;
  /** Lowest recogniser confidence among the stable events in the pending unit. */
  private pendingConfidence: number | undefined;
  /** Source hypotheses for the pending unit; travel with the next turn. */
  private pendingHypotheses: TurnHypothesis[] = [];
  private hypothesesByTurn = new Map<number, TurnHypothesis[]>();

  private connection: ConnectionState = "idle";
  private health: SubsystemHealth = { stt: "ok", llm: "ok", bible: "ok" };
  private degradedReason: string | undefined;

  private startedAt = 0;
  private stopped = false;
  /**
   * Bumped by start(), stop() and manual context changes that switch the
   * prompt layer. A result created under an older generation is dropped no
   * matter which lane it came from.
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
    this.pair = canonicalPair(options.languagePair);
    this.lag = options.lag;
    this.prep = options.prep ?? emptyPrepSheet();
    this.memory = memoryFromPrep(this.prep);
    this.context = createContextEngine({
      manual: options.context ?? "auto",
      prep: this.prep,
      language: this.pair.source,
    });
    this.entities = seedEntities(emptyEntityMemory(), this.memory.entities, "prep", this.clock);
    this.absorbPersisted(options.persisted);
    this.syncEntities();
  }

  private get clock(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  /** ms since the session began — the timeline every timestamp uses. */
  private elapsed(): number {
    return Math.max(0, this.clock - this.startedAt);
  }

  /** The prompt/lexicon layer the Context Engine currently selects. */
  private get mode(): InterpretationMode {
    return layerForDomain(currentDomain(this.context).domain);
  }

  private get sourceLanguage(): string {
    return this.pair.source;
  }

  /** The Korean-only detectors (Scripture, wordplay, sermon lexicon) apply to a Korean source. */
  private get koreanSource(): boolean {
    return languageBase(this.pair.source) === "ko";
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
    this.pendingConfidence = undefined;
    this.pendingHypotheses = [];
    this.stabiliser = { ...emptyStabiliser(), lastEventAt: 0 };
    this.setConnection("connecting");
  }

  /**
   * Flush whatever finalised source text is still waiting without requiring
   * another clock tick. Used during graceful shutdown after the recogniser
   * has been sealed, so the final spoken thought is not lost merely because
   * End was pressed before the normal stabilisation timer fired.
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
   * A manual context change that switches the prompt layer changes the
   * contract every in-flight request was built on. Outstanding results are
   * invalidated; their source text is put back so the next turn interprets
   * it under the new layer rather than losing it. A change within the same
   * layer (meeting → lecture) only re-labels the setting.
   */
  setContext(context: ContextDomain): void {
    const before = this.mode;
    this.context = setManualContext(this.context, context);
    if (this.mode !== before) this.invalidateOutstanding({ restore: !this.stopped });
    this.emit();
  }

  /** Transcript-free lane and memory counters, for diagnostics and the soak harness. */
  laneStats(): LaneStats {
    return { ...this.stats };
  }

  /** What this session learned and the host may keep, subject to the user's setting. */
  learnings(): EngineLearnings {
    return {
      corrections: [...this.memory.corrections],
      entities: [...this.entities.entities],
      memory: [...this.translationMemory.entries],
    };
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
    this.restoreUncovered(orphaned);
  }

  /** Put back the source text of turns that never got any target text on screen. */
  private restoreUncovered(turns: LogicalTurn[]): void {
    const uncovered = turns.filter((t) => t.provisional !== "applied");
    for (const turn of [...uncovered].reverse()) {
      this.stabiliser = restorePending(this.stabiliser, turn.text, this.clock, this.sourceLanguage);
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
      topic: this.memory.topic ?? seeded.topic,
    };
    this.entities = seedEntities(this.entities, seeded.entities, "prep", this.clock);
    this.syncEntities();
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
  // Memory plumbing
  // -------------------------------------------------------------------------

  private absorbPersisted(persisted: Partial<EngineLearnings> | undefined): void {
    if (!persisted) return;
    for (const correction of persisted.corrections ?? []) {
      this.memory = applyCorrection(this.memory, correction);
    }
    if (persisted.entities?.length) {
      this.entities = { entities: [...persisted.entities, ...this.entities.entities].slice(0, 200) };
    }
    if (persisted.memory?.length) {
      this.translationMemory = { entries: [...persisted.memory] };
    }
  }

  /** The prompt-facing entity list is a view of the Entity Memory. */
  private syncEntities(): void {
    this.memory = { ...this.memory, entities: entitiesForContext(this.entities, ENTITY_CONTEXT_LIMIT) };
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

  handleStable(text: string, meta?: StableTranscriptMeta): void {
    if (this.stopped) return;
    const raw = text.trim();
    const corrected = applyCorrectionsToText(raw, this.memory.corrections);
    if (!corrected) return;

    const stableAt = this.clock;
    const language = this.sourceLanguage;
    const previous = this.segments[this.segments.length - 1];
    let unit = corrected;

    if (previous && !HAS_CONTENT.test(corrected)) {
      // Recognisers finalise trailing punctuation as a result of its own —
      // WebKit adds the full stop a beat after the words. On its own that is
      // not a line of transcript, and the source pane shows only a handful of
      // lines: rendering "." as one of them costs a real sentence its place.
      // It still reaches the stabiliser below, where the terminal mark is a
      // sentence boundary worth acting on.
      this.segments = [
        ...this.segments.slice(0, -1),
        { ...previous, text: `${previous.text}${corrected}` },
      ];
    } else {
      // Presentation cleanup first, then evidence-based repair. Neither
      // decides meaning: normalisation changes how something is written and
      // the Repair Engine only ever substitutes a known canonical form when
      // the combined evidence is high. The raw recognition is kept beside it.
      const normalised = normaliseTranscript(corrected, language);
      const assessment = this.assessSourceUnit(normalised.text, meta);
      unit = assessment.text;
      this.segments = [
        ...this.segments,
        {
          id: nextSegmentId(),
          text: unit,
          at: Math.max(0, stableAt - this.startedAt),
          ...(unit !== raw ? { rawText: raw } : {}),
          ...(meta?.confidence !== undefined ? { confidence: meta.confidence } : {}),
          ...(meta?.alternatives?.length ? { alternatives: meta.alternatives.slice(0, 3) } : {}),
          ...(assessment.repaired ? { repaired: true } : {}),
        },
      ];
    }

    this.partial = null;
    if (!this.stabiliser.pending.trim() && this.pendingOriginAt === null) {
      this.pendingOriginAt = stableAt;
      this.pendingConfidence = undefined;
    }
    if (meta?.confidence !== undefined) {
      this.pendingConfidence =
        this.pendingConfidence === undefined ? meta.confidence : Math.min(this.pendingConfidence, meta.confidence);
    }
    this.stabiliser = pushStable(this.stabiliser, unit, stableAt, language);

    // Local detection is instant and does not wait for the model.
    this.absorbLocalDetection(unit);
    this.emit();
  }

  /** Run the Repair Engine on one stable unit. Never throws; a failure keeps the text as heard. */
  private assessSourceUnit(text: string, meta: StableTranscriptMeta | undefined): SourceAssessment {
    const untouched: SourceAssessment = {
      text,
      raw: text,
      repaired: false,
      band: "medium",
      kinds: [],
      hypotheses: [],
      signals: [],
    };
    try {
      this.stats.repairAttempts += 1;
      const assessment = assessSource({
        text,
        language: this.sourceLanguage,
        meta,
        entities: this.entities,
        glossaryTerms: this.memory.glossary.map((g) => g.korean),
        recentSources: this.segments.slice(-4).map((s) => s.text),
      });
      if (assessment.repaired) this.stats.repairsAccepted += 1;
      if (assessment.hypotheses.length) {
        this.stats.hypothesesIssued += assessment.hypotheses.length;
        this.pendingHypotheses = [
          ...this.pendingHypotheses,
          ...assessment.hypotheses.map(({ heard, candidate, reason }) => ({ heard, candidate, reason })),
        ].slice(-HYPOTHESIS_LIMIT);
      }
      return assessment;
    } catch {
      // The Repair Engine is optional intelligence. The transcript continues.
      return untouched;
    }
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

    const reason = flushReason(this.stabiliser, config, this.clock, this.sourceLanguage);
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
    const confidence = this.pendingConfidence;
    this.pendingConfidence = undefined;
    const hypotheses = this.pendingHypotheses;
    this.pendingHypotheses = [];
    if (!pending) return;

    const lane = this.options.provisional;
    const laneReady = !!lane && lane.isReady();

    // Fast path, step one: a rendering the interpreter already validated
    // needs no model at all. Deterministic, instant, and the only case where
    // the quality path is skipped — the person outranks it.
    const validated = this.lookupMemory(pending, true);
    // Step two: a strongly supported remembered rendering stands in for the
    // on-device translator as the provisional line while the cloud thinks.
    const remembered = validated ? null : this.lookupMemory(pending, false);
    const memoryProvisional = remembered && remembered.score >= MEMORY_PROVISIONAL_MIN_SCORE ? remembered : null;

    const turn = createTurn({
      id: (this.turnCounter += 1),
      text: pending,
      stableAt,
      boundary: reason,
      continuesPrevious: this.lastBoundary !== null && this.lastBoundary !== "sentence",
      provisional: validated || memoryProvisional || laneReady ? "pending" : "off",
      confidence,
    });
    this.turns.push(turn);
    if (this.turns.length > MAX_TURN_RECORDS) this.turns.splice(0, this.turns.length - MAX_TURN_RECORDS);
    this.stats.turns += 1;
    if (hypotheses.length) this.hypothesesByTurn.set(turn.id, hypotheses);

    // Recorded before any await: a failed turn still cut the source where it
    // cut it, and the unit restored by `restorePending` is the same open
    // thought the next call has to finish.
    this.lastBoundary = reason;

    if (validated) {
      this.applyMemoryHit(turn, validated, { validated: true });
      this.emit();
      return;
    }

    let provisionalWork: Promise<void> = Promise.resolve();
    if (memoryProvisional) {
      this.applyMemoryHit(turn, memoryProvisional, { validated: false });
    } else if (laneReady && lane) {
      provisionalWork = this.runProvisional(lane, turn);
    } else {
      this.stats.memoryMisses += 1;
    }
    const contextualWork = this.scheduleContextual(turn);
    await Promise.all([provisionalWork, contextualWork]);
  }

  private lookupMemory(text: string, validatedOnly: boolean): TranslationMemoryHit | null {
    try {
      return lookupMemory(this.translationMemory, {
        source: text,
        pair: this.pair,
        language: this.sourceLanguage,
        entities: this.entities.entities,
        validatedOnly,
      });
    } catch {
      return null;
    }
  }

  /** A remembered rendering reaches the screen exactly as a fast-lane answer would. */
  private applyMemoryHit(turn: LogicalTurn, hit: TranslationMemoryHit, options: { validated: boolean }): void {
    const now = this.elapsed();
    const drafts: ChunkDraft[] = [
      { text: hit.target, confidence: options.validated ? "high" : "medium", origin: "tm", revision: turn.revision },
    ];
    const { chunks, added } = insertTurnChunks(this.chunks, drafts, [turn.id], now, {
      provisional: !options.validated,
    });
    this.chunks = trimChunks(chunks);
    turn.provisionalAppliedAt = this.clock;
    turn.firstUsefulAt = this.clock;
    settleProvisional(turn, "applied");
    if (options.validated) {
      turn.contextual = "kept";
      this.stats.memoryHits += 1;
      this.stats.cloudSkipped += 1;
    } else {
      this.stats.memoryProvisional += 1;
    }
    this.options.onTurnTiming?.({
      turnId: turn.id,
      lane: "provisional",
      stableAt: turn.stableAt,
      safeAt: this.clock,
      provider: TRANSLATION_MEMORY_PROVIDER,
      model: options.validated ? `validated-${hit.kind}` : hit.kind,
      hasSafe: added.length > 0,
      hasAnticipated: false,
      firstUseful: added.length > 0,
    });
  }

  // --- Lane A: provisional ----------------------------------------------------

  private async runProvisional(lane: ProvisionalLane, turn: LogicalTurn): Promise<void> {
    const controller = new AbortController();
    this.provisionalInFlight = { controller, turn, startedAt: this.clock };
    this.stats.maxProvisionalInFlight = Math.max(this.stats.maxProvisionalInFlight, 1);
    this.emit();

    // Timeout, stop, restart and context change all decide the turn's fate
    // before the translator answers, and they say so in the turn record. A
    // result that arrives after that is simply dropped; it was already counted.
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
   * Provisional output is rendered and nothing else. The fast lane has no
   * domain contract, so it is never allowed to teach the rolling memory:
   * glossary, entities, Scripture and topic come from the contextual lane.
   */
  private applyProvisional(lane: ProvisionalLane, turn: LogicalTurn, output: InterpreterOutput): void {
    const now = this.elapsed();
    const drafts: ChunkDraft[] = output.safeChunks.map((d) => ({
      text: d.text,
      confidence: d.confidence,
      origin: "provisional",
      revision: turn.revision,
    }));
    const { chunks, added } = insertTurnChunks(this.chunks, drafts, [turn.id], now, { provisional: true });
    this.chunks = trimChunks(chunks);
    turn.provisionalAppliedAt = this.clock;
    const firstUseful = turn.firstUsefulAt === undefined && added.length > 0;
    if (firstUseful) turn.firstUsefulAt = this.clock;
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
      firstUseful,
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
        // A skipped turn with no target text at all goes back to the
        // stabiliser rather than vanishing. It will flush again as a new turn.
        if (old.provisional !== "applied") {
          this.stabiliser = restorePending(this.stabiliser, old.text, this.clock, this.sourceLanguage);
          this.pendingOriginAt = Math.min(this.pendingOriginAt ?? old.stableAt, old.stableAt);
        }
      }
      return Promise.resolve();
    }
    return this.dispatchContextual({ turns: [turn] });
  }

  private routeUnit(unit: ContextualUnit, pending: string): RouteTier {
    const hypotheses = unit.turns.flatMap((t) => this.hypothesesByTurn.get(t.id) ?? []);
    const confidences = unit.turns.map((t) => t.confidence).filter((c): c is number => c !== undefined);
    const known = this.memory.entities.filter((e) => pending.includes(e.korean)).length;
    return routeTurn({
      text: pending,
      language: this.sourceLanguage,
      sourceScore: confidences.length ? Math.min(...confidences) : 0.8,
      hypothesisCount: hypotheses.length,
      repairKinds: unit.turns.some((t) => this.segments.some((s) => s.repaired && t.text.includes(s.text)))
        ? (["stt-corruption"] as RepairKind[])
        : [],
      structuredCount: (pending.match(/\d+/g) ?? []).length,
      entityMentions: known,
      boundary: unit.turns[unit.turns.length - 1].boundary,
      continuesPrevious: unit.turns[0].continuesPrevious,
    });
  }

  private async dispatchContextual(unit: ContextualUnit): Promise<void> {
    const turnIds = unitTurnIds(unit);
    const first = unit.turns[0];
    const last = unit.turns[unit.turns.length - 1];
    const pending = unitText(unit);
    unit.revisions = new Map(unit.turns.map((t) => [t.id, t.revision]));

    const config = lagConfig(this.lag);
    const partial = this.partial?.text ?? "";
    const allowAnticipation = shouldAnticipate(config, last.boundary, partial);
    const detectedScripture = this.koreanSource ? this.scriptureHints(pending) : [];
    const domain = currentDomain(this.context);

    // The model is asked for this unit's target text; its own provisional
    // rendering must not be offered back to it as delivered context.
    const contextChunks = this.chunks.filter(
      (c) => !(c.provisional && c.turnId !== undefined && turnIds.includes(c.turnId)),
    );

    const hypotheses = unit.turns
      .flatMap((t) => this.hypothesesByTurn.get(t.id) ?? [])
      .slice(0, HYPOTHESIS_LIMIT);
    let memoryHints: Array<{ source: string; target: string }> = [];
    try {
      memoryHints = hintsFor(this.translationMemory, {
        source: pending,
        pair: this.pair,
        language: this.sourceLanguage,
        limit: MEMORY_HINT_LIMIT,
      });
    } catch {
      memoryHints = [];
    }

    const request: InterpretRequest = {
      mode: this.mode,
      lag: this.lag,
      languagePair: { ...this.pair },
      domain: domain.domain,
      domainConfidence: Number(domain.confidence.toFixed(2)),
      routeTier: this.routeUnit(unit, pending),
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
        glossary: promptGlossary(pending, this.mode, this.memory.glossary, undefined, this.sourceLanguage),
        culturalNotes: this.koreanSource ? detectCultural(pending, this.memory.entities) : [],
        hypotheses,
        memory: memoryHints,
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
      if (!unitRevisionsCurrent(unit)) {
        // The source of a turn changed under this request (a correction, a
        // repair). The answer describes text nobody is looking at any more.
        this.stats.revisionStale += 1;
        this.recordStale(unit, result);
        this.restoreUncovered(unit.turns);
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
      // but only the source text that has no target text on screen at all.
      this.restoreUncovered(unit.turns);
      this.setHealth(
        "llm",
        "down",
        error instanceof Error ? error.message : "Interpretation is unavailable.",
      );
    } finally {
      if (this.cloudInFlight === controller) this.cloudInFlight = null;
      for (const id of turnIds) this.hypothesesByTurn.delete(id);
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
   * The quality path's target check. Deterministic evidence only: a number
   * that vanished, a negation that flipped, a settled name rendered
   * differently, the wrong Chinese script, an untranslated echo. Fixes are
   * applied only where the fix is a known canonical form; everything else is
   * flagged on the chunk so the interpreter checks before saying it.
   */
  private repairDrafts(source: string, drafts: ChunkDraft[]): { drafts: ChunkDraft[]; issues: number } {
    if (drafts.length === 0) return { drafts, issues: 0 };
    let issues = 0;
    let repaired = drafts;
    try {
      // Per-chunk: only fixes, which are local to the chunk they appear in.
      repaired = drafts.map((draft) => {
        const perChunk = assessTarget({
          source,
          targetChunks: [draft.text],
          pair: this.pair,
          entities: this.entities,
        });
        const fixes = perChunk.issues.filter((issue) => issue.severity === "fix");
        if (!perChunk.changed || fixes.length === 0) return draft;
        issues += fixes.length;
        this.stats.targetFixes += fixes.length;
        return {
          ...draft,
          text: perChunk.text,
          repairs: [...new Set([...(draft.repairs ?? []), ...fixes.map((f) => f.kind)])],
        };
      });

      // Whole unit: flags, which only make sense against the full rendering.
      const unitLevel = assessTarget({
        source,
        targetChunks: repaired.map((d) => d.text),
        pair: this.pair,
        entities: this.entities,
      });
      const flags = unitLevel.issues.filter((issue) => issue.severity === "flag");
      if (flags.length > 0) {
        issues += flags.length;
        this.stats.targetIssuesFlagged += flags.length;
        const kinds = [...new Set(flags.map((f) => f.kind))];
        const serious = kinds.filter((k) => k === "number" || k === "negation" || k === "date");
        const note = flags[0].note;
        // A number or a negation the target may have lost is the one thing
        // the interpreter must check before saying the line. Marked on the
        // last chunk, where the eye is, rather than on every chunk.
        repaired = repaired.map((draft, index) =>
          index === repaired.length - 1
            ? {
                ...draft,
                repairs: [...new Set([...(draft.repairs ?? []), ...kinds])],
                ...(serious.length ? { confidence: "low" as const, note: draft.note ?? note } : {}),
              }
            : draft,
        );
      }
    } catch {
      // Optional intelligence. The cloud's drafts stand as they were.
      return { drafts, issues: 0 };
    }
    return { drafts: repaired, issues };
  }

  /**
   * Decide what a contextual result may still do, then do exactly that.
   *
   *   refine    every provisional chunk of these turns is still editable AND
   *             the new text corrects something → replace them in place.
   *   kept      the new text is a restyling of the provisional line → keep
   *             what the interpreter is already reading.
   *   locked    the interpreter may have said the provisional line → drop the
   *             rewrite; keep the knowledge.
   *   fresh     no provisional English exists → append, as the engine always
   *             has; older-turn results slot in ahead of newer editable turns.
   *
   * Knowledge (glossary, entities, Scripture, topic, cultural notes, memory)
   * is absorbed in every non-stale case: it is the trusted source for memory
   * whether or not its chunks were allowed on screen.
   */
  private applyContextual(unit: ContextualUnit, result: InterpretResult, allowAnticipation: boolean): void {
    const output = result.output;
    const turnIds = unitTurnIds(unit);
    const now = this.elapsed();
    const qualityStartAt = this.clock;
    const source = unitText(unit);
    const legality = refinementLegality(this.chunks, turnIds);
    const newest = turnIds.includes(this.turnCounter);
    const revision = unit.turns[unit.turns.length - 1].revision;
    const { drafts, issues } = this.repairDrafts(
      source,
      output.safeChunks.map((d) => ({ ...d, origin: "contextual" as const, revision })),
    );

    let chunks = this.chunks;
    let outcome: ContextualOutcome;
    let state: ContextualState;
    let hasSafe = false;
    let firstUseful = false;

    if (legality === "fresh") {
      const added = insertTurnChunks(chunks, drafts, turnIds, now);
      chunks = added.chunks;
      hasSafe = added.added.length > 0;
      outcome = "applied";
      state = "applied";
      this.stats.contextualApplied += 1;
      if (hasSafe) {
        for (const turn of unit.turns) {
          if (turn.firstUsefulAt === undefined) {
            turn.firstUsefulAt = this.clock;
            firstUseful = true;
          }
        }
      }
    } else if (legality === "refine") {
      const provisional = provisionalChunksFor(chunks, turnIds);
      const gate = this.stabilityGate(provisional, drafts);
      if (!gate.different && drafts.length > 0) {
        // Same meaning, different words. The interpreter is already reading
        // the provisional line; swapping it for a paraphrase is churn.
        chunks = settleProvisional_(chunks, turnIds);
        outcome = "kept";
        state = "kept";
        this.stats.contextualKept += 1;
        this.stats.contextualKeptStylistic += 1;
      } else {
        const refined = refineProvisionalChunks(chunks, turnIds, drafts, now);
        chunks = refined.chunks;
        hasSafe = drafts.length > 0;
        outcome = refined.changed ? "refined" : "kept";
        state = refined.changed ? "refined" : "kept";
        if (refined.changed) this.stats.contextualRefined += 1;
        else this.stats.contextualKept += 1;
      }
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
    // already been followed by real speech. Predictions are never kept next to
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
    if (unit.turns.length === 1 && drafts.length > 0 && issues === 0 && !result.degraded) {
      this.rememberRendering(source, drafts.map((d) => d.text).join(" "));
    }

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
      firstUseful,
      qualityStartAt,
      issuesFlagged: issues,
    });
  }

  /** Whether a refinement corrects meaning. A failing gate never blocks a real fix. */
  private stabilityGate(
    provisional: InterpretationChunk[],
    drafts: ChunkDraft[],
  ): { different: boolean; reasons: string[] } {
    if (provisional.some((c) => c.repairs?.length)) return { different: true, reasons: ["flagged"] };
    try {
      return materiallyDifferent(
        provisional.map((c) => c.text),
        drafts.map((d) => d.text),
        { language: this.pair.target, entities: this.entities },
      );
    } catch {
      return { different: true, reasons: ["gate-unavailable"] };
    }
  }

  private absorbContextualKnowledge(output: InterpreterOutput): void {
    if (output.bibleReferences?.length) this.absorbScripture(output.bibleReferences);
    if (output.culturalNotes?.length) {
      this.culturalNotes = dedupeNotes([...output.culturalNotes, ...this.culturalNotes]).slice(0, 12);
    }
    this.memory = rememberKnowledge(this.memory, {
      glossary: output.glossary,
      scripture: output.bibleReferences?.map((r) => r.display),
      topic: output.topic,
    });
    for (const entity of output.entities ?? []) {
      try {
        this.entities = establishEntity(this.entities, {
          canonical: entity.korean,
          target: entity.english,
          kind: entity.kind,
          provenance: "model",
          now: this.clock,
          language: this.sourceLanguage,
        });
      } catch {
        // Entity memory is optional intelligence.
      }
    }
    this.syncEntities();
    this.context = observeContext(this.context, {
      topic: output.topic,
      scriptureCount: output.bibleReferences?.length ?? 0,
      entityKinds: output.entities?.map((e) => e.kind),
      language: this.sourceLanguage,
    });
  }

  /**
   * Remember a model rendering. A single answer is the lowest trust there is;
   * the same rendering recurring becomes a supported inference. Only a
   * validated (user/prep) entry may ever answer a turn without the model.
   */
  private rememberRendering(source: string, target: string): void {
    try {
      const existing = this.lookupMemory(source, false);
      const repeated = !!existing && existing.target === target && existing.entry.count >= 2;
      this.translationMemory = rememberTranslation(this.translationMemory, {
        source,
        target,
        pair: this.pair,
        domain: currentDomain(this.context).domain,
        provenance: repeated ? "inferred" : "model",
        now: this.clock,
      });
    } catch {
      // Memory is optional intelligence.
    }
  }

  /** Detection that runs locally, the instant source text stabilises. */
  private absorbLocalDetection(text: string): void {
    let scriptureCount = 0;
    if (this.koreanSource) {
      const refs = detectScriptureReferences(text).map(({ index: _index, ...ref }) => ref);
      scriptureCount = refs.length;
      if (refs.length) this.absorbScripture(refs);

      const notes = detectCultural(text, this.memory.entities);
      if (notes.length) {
        this.culturalNotes = dedupeNotes([...notes, ...this.culturalNotes]).slice(0, 12);
      }
    }

    const terms = liveGlossary(text, this.mode, this.memory.glossary, undefined, this.sourceLanguage);
    if (terms.length) {
      this.stats.glossaryHits += terms.length;
      this.memory = rememberKnowledge(this.memory, { glossary: terms });
    }

    this.context = observeContext(this.context, {
      stableText: text,
      scriptureCount,
      glossaryHits: terms.map((t) => t.korean),
      prep: this.prep,
      language: this.sourceLanguage,
    });
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
   * for the rest of the session: past transcript is rewritten, every future
   * recognition of the wrong form is corrected before anything sees it, the
   * binding enters the Entity Memory at the highest trust, and any result
   * still in flight for the corrected text is retired — its answer was to a
   * question nobody is asking any more.
   *
   * With `scope: "target"`, `from` is the source unit and `to` the preferred
   * rendering: the Translation Memory learns it as validated, and the line
   * on screen is replaced while it is still editable or corrected discreetly
   * once it is not.
   */
  correct(
    from: string,
    to: string,
    options?: string | { english?: string; remember?: boolean; scope?: "source" | "target" | "entity" },
  ): void {
    const opts = typeof options === "string" ? { english: options } : options ?? {};
    const source = from.trim();
    const target = to.trim();
    if (!source || !target) return;
    const scope = opts.scope ?? "source";

    if (scope === "target") {
      this.correctTarget(source, target, opts.remember);
      this.emit();
      return;
    }

    const record: CorrectionRecord = {
      from: source,
      to: target,
      at: this.elapsed(),
      english: opts.english,
      scope,
      remember: opts.remember,
    };
    this.memory = applyCorrection(this.memory, record);
    const bound = this.memory.corrections.find((c) => c.from === source);
    const english = bound?.english ?? opts.english ?? (this.koreanSource ? romaniseName(target) : target);

    try {
      this.entities = establishEntity(this.entities, {
        canonical: target,
        target: english,
        kind: "person",
        surface: source,
        provenance: "user",
        now: this.clock,
        language: this.sourceLanguage,
      });
    } catch {
      // The correction still applies to the transcript below.
    }
    this.syncEntities();

    this.segments = this.segments.map((segment) =>
      segment.text.includes(source)
        ? {
            ...segment,
            text: segment.text.split(source).join(target),
            corrected: true,
            originalText: segment.originalText ?? segment.text,
          }
        : segment,
    );
    if (this.stabiliser.pending.includes(source)) {
      this.stabiliser = { ...this.stabiliser, pending: this.stabiliser.pending.split(source).join(target) };
    }

    // A result in flight for a turn that carried the wrong form is now
    // answering the wrong question. Bump the revision so it is dropped on
    // arrival; if that leaves the turn with no target text, its corrected
    // source is restored and interpreted afresh.
    for (const turn of this.turns) {
      if (!turn.text.includes(source)) continue;
      if (turn.contextual !== "inflight" && turn.contextual !== "queued") continue;
      turn.text = turn.text.split(source).join(target);
      turn.revision += 1;
    }

    this.emit();
  }

  private correctTarget(source: string, target: string, remember?: boolean): void {
    try {
      this.translationMemory = rememberTranslation(this.translationMemory, {
        source,
        target,
        pair: this.pair,
        domain: currentDomain(this.context).domain,
        provenance: "user",
        now: this.clock,
      });
    } catch {
      // Memory is optional intelligence; the visible correction still applies.
    }
    this.memory = {
      ...this.memory,
      corrections: [
        ...this.memory.corrections.filter((c) => !(c.from === source && c.scope === "target")),
        { from: source, to: target, at: this.elapsed(), scope: "target", remember },
      ],
    };

    const turn = [...this.turns].reverse().find((t) => t.text === source || t.text.includes(source));
    if (!turn) return;
    const now = this.elapsed();
    const own = this.chunks.filter((c) => c.turnId === turn.id && c.state !== "anticipated");
    if (own.length === 0) return;
    if (own.every((c) => c.state === "current")) {
      const ids = new Set(own.map((c) => c.id));
      const first = this.chunks.findIndex((c) => ids.has(c.id));
      const at = Math.min(...own.map((c) => c.at));
      this.chunks = [
        ...this.chunks.slice(0, first).filter((c) => !ids.has(c.id)),
        {
          id: `u${turn.id}-${turn.revision}`,
          text: target,
          state: "current",
          confidence: "high",
          at,
          turnId: turn.id,
          revision: turn.revision,
          origin: "tm",
        },
        ...this.chunks.slice(first).filter((c) => !ids.has(c.id) && c.state !== "anticipated"),
      ];
    } else {
      // Already spoken: the original stays; the correction follows it discreetly.
      this.chunks = appendCorrection(this.chunks, own[own.length - 1].id, target, now);
    }
    this.chunks = trimChunks(this.chunks);
    turn.revision += 1;
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
      languagePair: { ...this.pair },
      domain: currentDomain(this.context),
    };
  }

  private emit(): void {
    this.options.onChange(this.snapshot());
  }
}

/**
 * Drop the provisional flag on the still-editable chunks of `turnIds` so a
 * later result cannot touch them, without changing their text or dwell clock.
 */
function settleProvisional_(chunks: InterpretationChunk[], turnIds: readonly number[]): InterpretationChunk[] {
  return chunks
    .map((c) =>
      c.provisional && c.turnId !== undefined && turnIds.includes(c.turnId) && c.state === "current"
        ? { ...c, provisional: false }
        : c,
    )
    .filter((c) => c.state !== "anticipated");
}
