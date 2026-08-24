/**
 * The interpretation engine.
 *
 * Framework-agnostic state machine sitting between the recogniser and the
 * console. It owns the whole live pipeline:
 *
 *   partial/stable events → stabiliser → local detection → rolling context
 *     → interpretation call → chunk store (temporal locking) → subscribers
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
import { liveGlossary, mergeGlossary } from "../glossary/matcher";
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
  addSafeChunks,
  clearAnticipated,
  commitAll,
  commitDueChunks,
  setAnticipatedChunks,
  trimChunks,
} from "./chunks";
import { lagConfig } from "./lag";
import {
  drain,
  emptyStabiliser,
  flushReason,
  pushStable,
  shouldAnticipate,
  touch,
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
}

export interface EngineOptions {
  mode: InterpretationMode;
  lag: LagProfile;
  prep?: PrepSheet;
  /** Performs one interpretation call. Injected so tests need no network. */
  interpret: (request: InterpretRequest, signal: AbortSignal) => Promise<InterpretResult>;
  /** Optional Scripture text resolution. Omitted in demo/offline. */
  resolveBible?: (reference: BibleReference) => Promise<BibleReference>;
  onChange: (snapshot: EngineSnapshot) => void;
  /** Injectable clock — tests drive time directly. */
  now?: () => number;
}

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

  private connection: ConnectionState = "idle";
  private health: SubsystemHealth = { stt: "ok", llm: "ok", bible: "ok" };
  private degradedReason: string | undefined;

  private startedAt = 0;
  private inFlight: AbortController | null = null;
  private stopped = false;

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
    this.startedAt = this.clock;
    this.stopped = false;
    this.stabiliser = { ...emptyStabiliser(), lastEventAt: 0 };
    this.setConnection("connecting");
  }

  stop(): void {
    this.stopped = true;
    this.inFlight?.abort();
    this.inFlight = null;
    // Anything still editable is now final — the session is over.
    this.chunks = commitAll(clearAnticipated(this.chunks));
    this.setConnection("idle");
  }

  setMode(mode: InterpretationMode): void {
    this.mode = mode;
    this.emit();
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
      entities: [...seeded.entities, ...this.memory.entities.filter(
        (e) => !seeded.entities.some((s) => s.korean === e.korean),
      )],
      topic: this.memory.topic ?? seeded.topic,
    };
    this.emit();
  }

  setConnection(connection: ConnectionState): void {
    this.connection = connection;
    this.emit();
  }

  setHealth(part: keyof SubsystemHealth, status: SubsystemHealth[keyof SubsystemHealth], reason?: string): void {
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

    this.segments = [
      ...this.segments,
      { id: nextSegmentId(), text: corrected, at: this.elapsed() },
    ];
    this.partial = null;
    this.stabiliser = pushStable(this.stabiliser, corrected, this.clock);

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

    const reason = flushReason(this.stabiliser, config, this.clock);
    if (reason && !this.inFlight) {
      void this.flush(reason);
      return;
    }

    if (this.chunks !== before) this.emit();
  }

  // -------------------------------------------------------------------------
  // Interpretation
  // -------------------------------------------------------------------------

  private async flush(reason: NonNullable<ReturnType<typeof flushReason>>): Promise<void> {
    const { text: pending, state } = drain(this.stabiliser);
    this.stabiliser = state;
    if (!pending) return;

    const config = lagConfig(this.lag);
    const partial = this.partial?.text ?? "";
    const allowAnticipation = shouldAnticipate(config, reason, partial);

    const detectedScripture = detectScriptureReferences(pending).map(
      ({ index: _index, ...ref }) => ref,
    );

    const request: InterpretRequest = {
      mode: this.mode,
      lag: this.lag,
      pending,
      partial: allowAnticipation ? partial : undefined,
      context: buildRollingContext({
        segments: this.segments,
        chunks: this.chunks,
        memory: this.memory,
        mode: this.mode,
        prep: this.prep,
      }),
      detected: {
        scripture: detectedScripture,
        glossary: liveGlossary(pending, this.mode, this.memory.glossary),
        culturalNotes: detectCultural(pending, this.memory.entities),
      },
      allowAnticipation,
    };

    const controller = new AbortController();
    this.inFlight = controller;
    this.emit();

    try {
      const result = await this.options.interpret(request, controller.signal);
      if (this.stopped || controller.signal.aborted) return;

      this.applyOutput(result.output, allowAnticipation);
      this.setHealth("llm", result.degraded ? "degraded" : "ok", result.reason);
      void this.enrichScripture();
    } catch (error) {
      if (controller.signal.aborted) return;
      // The Korean transcript keeps running. That is the whole point of
      // subsystem-level health: one dead component is not a dead session.
      this.setHealth(
        "llm",
        "down",
        error instanceof Error ? error.message : "Interpretation is unavailable.",
      );
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
      this.emit();
    }
  }

  private applyOutput(output: InterpreterOutput, allowAnticipation: boolean): void {
    const now = this.elapsed();

    // New confirmed English means the interpreter has moved past whatever was
    // still editable. Lock it before appending.
    let chunks = commitAll(this.chunks);
    const result = addSafeChunks(chunks, output.safeChunks, now);
    chunks = result.chunks;

    chunks = allowAnticipation && output.anticipatedChunks?.length
      ? setAnticipatedChunks(chunks, output.anticipatedChunks, now)
      : clearAnticipated(chunks);

    this.chunks = trimChunks(chunks);

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
        this.setHealth("bible", "degraded", "Scripture lookup failed — showing references only.");
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
      thinking: this.inFlight !== null,
    };
  }

  private emit(): void {
    this.options.onChange(this.snapshot());
  }
}
