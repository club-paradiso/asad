/**
 * Core domain types for tong-yuck.
 *
 * These describe the *interpretation session* — the shared vocabulary used by
 * the engine, the providers and the console UI. Anything that crosses the
 * network boundary additionally has a Zod schema in `src/lib/schema.ts`.
 */

// ---------------------------------------------------------------------------
// Modes and settings
// ---------------------------------------------------------------------------

/**
 * What kind of speech the session is carrying.
 *
 * `auto` is the default and the normal case: the Context Engine infers the
 * domain from evidence (prep sheet, Scripture references, terminology,
 * discourse patterns, the model's own topic label) and adapts as the session
 * goes. The others are manual overrides behind a secondary control. None of
 * them is a product mode the user must choose before starting.
 */
export type ContextDomain =
  | "auto"
  | "worship"
  | "sermon"
  | "lecture"
  | "meeting"
  | "conversation"
  | "presentation"
  | "event"
  | "generic";

export const CONTEXT_DOMAINS: readonly ContextDomain[] = [
  "auto",
  "worship",
  "sermon",
  "lecture",
  "meeting",
  "conversation",
  "presentation",
  "event",
  "generic",
];

/** A domain the Context Engine has settled on. Never `auto`. */
export type ResolvedDomain = Exclude<ContextDomain, "auto">;

export const RESOLVED_DOMAINS: readonly ResolvedDomain[] = CONTEXT_DOMAINS.filter(
  (domain): domain is ResolvedDomain => domain !== "auto",
);

/**
 * INTERNAL prompt/lexicon layer, derived from the resolved domain.
 *
 * This is not a user choice and no screen offers it. The worship/sermon
 * intelligence — Scripture handling, theological register, Korean church
 * vocabulary — is a layer the Context Engine switches on when the evidence
 * says the room is a service, and leaves off otherwise. The name survives
 * from when it was a top-level mode because the prompt modules, lexicons and
 * demo script are keyed by it.
 */
export type InterpretationMode = "sermon" | "general";

/** Which prompt/lexicon layer a resolved domain activates. */
export const layerForDomain = (domain: ResolvedDomain): InterpretationMode =>
  domain === "worship" || domain === "sermon" ? "sermon" : "general";

/** How the Context Engine arrived at the domain it is using. */
export type DomainSource = "manual" | "prep" | "inferred" | "default";

export interface DomainInference {
  domain: ResolvedDomain;
  /** 0–1. Combined evidence, never a model's self-report. */
  confidence: number;
  source: DomainSource;
  /** Short evidence labels for diagnostics and the console's context control. Never transcript. */
  signals: string[];
}

/** The languages a Live session listens to and speaks. Canonical registry ids. */
export interface LanguagePair {
  source: string;
  target: string;
}

/**
 * How far behind the speaker the interpreter is choosing to run. This is the
 * single most important live control: it drives transcript stabilisation, when
 * the LLM is triggered, how aggressive anticipation is, and how quickly an
 * English chunk becomes temporally locked.
 */
export type LagProfile = "fast" | "balanced" | "safe";

/** How the console is laid out. */
export type ConsoleView = "console" | "teleprompter";

/** Confidence bands. Deliberately coarse — no numeric percentages on screen. */
export type Confidence = "high" | "medium" | "low";

/** Health of the live pipeline as a whole. */
export type ConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "degraded"
  | "offline"
  | "error";

// ---------------------------------------------------------------------------
// Korean side
// ---------------------------------------------------------------------------

/** A finalised piece of recognised source-language speech. */
export interface TranscriptSegment {
  id: string;
  text: string;
  /** ms since session start. */
  at: number;
  /** True when this segment replaced an earlier one via user correction. */
  corrected?: boolean;
  /** The text this segment replaced, when `corrected`. */
  originalText?: string;
  /**
   * What the recogniser actually emitted, before normalisation or any
   * evidence-based repair. Source evidence is never overwritten.
   */
  rawText?: string;
  /** Recogniser confidence for this segment, 0–1, when the provider reports one. */
  confidence?: number;
  /** Alternative hypotheses the recogniser offered, best first, when available. */
  alternatives?: string[];
  /** True when the Repair Engine changed `text` from `rawText` on evidence. */
  repaired?: boolean;
}

/** Recogniser metadata that may accompany a stable result. All optional. */
export interface StableTranscriptMeta {
  confidence?: number;
  /** N-best alternatives, best first, excluding the chosen text. */
  alternatives?: string[];
}

/** Live, still-unstable recognition output. */
export interface PartialTranscript {
  text: string;
  at: number;
}

// ---------------------------------------------------------------------------
// English side
// ---------------------------------------------------------------------------

/**
 * Temporal state of an English chunk.
 *
 * - `anticipated` — a predicted continuation. Never presented as confirmed.
 * - `current`     — supported by stable Korean, still editable.
 * - `committed`   — the interpreter has probably already said it out loud, so
 *                   it is locked and must not be silently rewritten.
 */
export type ChunkState = "anticipated" | "current" | "committed";

/**
 * One interpreter-ready English thought unit — roughly a breath group.
 * Short by design: this is language to *say*, not prose to read.
 */
export interface InterpretationChunk {
  id: string;
  text: string;
  state: ChunkState;
  confidence: Confidence;
  /** ms since session start when the chunk was first produced. */
  at: number;
  /** id of the Korean segment that produced it, when known. */
  sourceSegmentId?: string;
  /** Set when this chunk discreetly corrects an already-committed chunk. */
  correctsChunkId?: string;
  /** Short interpreter-facing hint, e.g. a wordplay adaptation marker. */
  note?: string;
  /** True when the chunk is an adapted rendering rather than a literal one. */
  adapted?: boolean;
  /**
   * The logical turn (one flushed Korean unit) this chunk answers. Carries no
   * content; it is the key an asynchronous result must match before it may
   * touch the chunk.
   */
  turnId?: number;
  /**
   * True while the chunk is fast on-device English that the contextual lane
   * may still replace. The temporal state is unchanged: a provisional chunk
   * is `current` until it commits, and once committed it is as immutable as
   * any other.
   */
  provisional?: boolean;
  /**
   * Revision of the turn this chunk renders. Bumped when the turn's source is
   * corrected or repaired while a result is in flight, so a result built on
   * an older revision can never overwrite a newer one.
   */
  revision?: number;
  /** Set when the Repair Engine changed or flagged this chunk. Labels only. */
  repairs?: RepairKind[];
  /** Where the text came from: a validated memory hit needs no model. */
  origin?: "tm" | "provisional" | "contextual" | "local";
}

/**
 * Output lifecycle as the interpreter sees it.
 *
 *   interim      unstable recognition, still changing
 *   provisional  first useful translation, may be refined
 *   stable       locked; only a genuine semantic correction may follow it
 */
export type OutputLifecycle = "interim" | "provisional" | "stable";

export const chunkLifecycle = (chunk: InterpretationChunk): OutputLifecycle =>
  chunk.state === "committed" ? "stable" : chunk.state === "anticipated" ? "interim" : "provisional";

/** Problem classes the Repair Engine can detect. */
export type RepairKind =
  | "stt-corruption"
  | "entity"
  | "terminology"
  | "number"
  | "date"
  | "negation"
  | "script"
  | "implausible"
  | "empty";

// ---------------------------------------------------------------------------
// Context support
// ---------------------------------------------------------------------------

export interface BibleReference {
  /** Canonical English book name, e.g. "1 Peter". */
  book: string;
  chapter: number;
  verse?: number;
  verseEnd?: number;
  /** Rendered reference, e.g. "1 Peter 2:9". */
  display: string;
  /** The Korean spoken form that produced it, e.g. "베드로전서 2장 9절". */
  koreanRaw?: string;
  confidence: Confidence;
  /** Verse text, only ever present when a provider legally supplied it. */
  text?: string;
  /** Translation the text came from, e.g. "WEB". */
  translation?: string;
}

export interface GlossaryItem {
  korean: string;
  english: string;
  /** Why this rendering, or when to prefer an alternative. */
  note?: string;
  /** Alternative renderings the interpreter may prefer in context. */
  alternatives?: string[];
  /** Where the entry came from — prep sheet, built-in lexicon, or live model. */
  source?: "prep" | "lexicon" | "live";
  /**
   * True for discourse/register markers rather than terminology. These inform
   * the model's sense of register but are filtered off the live rail, where
   * screen space belongs to terms the interpreter might actually need.
   */
  register?: boolean;
}

export type CulturalNoteKind =
  | "wordplay"
  | "idiom"
  | "cultural"
  | "honorific"
  | "hanja"
  | "humour";

export interface CulturalNote {
  kind: CulturalNoteKind;
  /** The Korean trigger, e.g. 길. */
  korean: string;
  /** One short line the interpreter can absorb at a glance. */
  note: string;
  /** A ready-to-say English adaptation, when one exists. */
  suggestion?: string;
}

export type EntityKind = "person" | "place" | "organisation" | "work" | "other";

export interface EntityResolution {
  korean: string;
  /** Preferred spoken English form / romanisation. */
  english: string;
  kind: EntityKind;
  note?: string;
}

// ---------------------------------------------------------------------------
// Model output
// ---------------------------------------------------------------------------

/**
 * Structured interpretation output. The model is never asked for prose — it
 * fills this shape, and malformed output is rejected rather than parsed.
 */
export interface InterpreterOutput {
  safeChunks: Array<Omit<InterpretationChunk, "id" | "state" | "at">>;
  anticipatedChunks?: Array<Omit<InterpretationChunk, "id" | "state" | "at">>;
  bibleReferences?: BibleReference[];
  glossary?: GlossaryItem[];
  culturalNotes?: CulturalNote[];
  entities?: EntityResolution[];
  confidence: Confidence;
  /** Optional compressed topic label used to keep rolling context small. */
  topic?: string;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Optional information the interpreter can preload. Never mandatory. */
export interface PrepSheet {
  speaker?: string;
  title?: string;
  organisation?: string;
  scripture?: string;
  notes?: string;
  outline?: string;
  glossary: GlossaryItem[];
  entities: EntityResolution[];
}

export const emptyPrepSheet = (): PrepSheet => ({ glossary: [], entities: [] });

/** Generated pre-session briefing. */
export interface PrepBrief {
  overview: string;
  likelyStructure: string[];
  keyTerms: GlossaryItem[];
  scripture: BibleReference[];
  properNouns: EntityResolution[];
  difficultPoints: string[];
  anticipatedPhrases: Array<{ korean: string; english: string }>;
  pronunciation: Array<{ korean: string; english: string }>;
}

export interface SessionSettings {
  /** Canonical registry id of the language being spoken. */
  sourceLanguage: string;
  /** Canonical registry id of the language being interpreted into. */
  targetLanguage: string;
  /** `auto` unless the interpreter overrode it. */
  context: ContextDomain;
  lag: LagProfile;
  view: ConsoleView;
  /** Show the source-language transcript under the translation. */
  showSource: boolean;
  showGlossary: boolean;
  showScripture: boolean;
  fontScale: number;
  /** Session transcripts are only ever stored when the user opts in. */
  saveHistory: boolean;
  /**
   * Keep user-confirmed corrections and entity bindings for future sessions
   * in this browser. Never transcripts, never audio, never unconfirmed model
   * output.
   */
  rememberCorrections: boolean;
}

export const defaultSettings = (): SessionSettings => ({
  sourceLanguage: "ko-KR",
  targetLanguage: "en-US",
  context: "auto",
  lag: "balanced",
  view: "console",
  showSource: true,
  showGlossary: true,
  showScripture: true,
  fontScale: 1,
  saveHistory: false,
  rememberCorrections: true,
});

/** A user-issued correction, remembered for the rest of the session. */
export interface CorrectionRecord {
  from: string;
  to: string;
  at: number;
  /** Preferred English rendering / romanisation, when supplied. */
  english?: string;
  /** What the correction targets. Defaults to the source transcript. */
  scope?: "source" | "target" | "entity";
  /** Whether the user asked for this correction to outlive the session. */
  remember?: boolean;
}

/** The complete state of a live or finished session. */
export interface SessionState {
  id: string;
  startedAt: number;
  endedAt?: number;
  settings: SessionSettings;
  prep: PrepSheet;
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
  /** Subsystem-level health, so one failure never blanks the console. */
  health: SubsystemHealth;
  languagePair: LanguagePair;
  domain: DomainInference;
}

export interface SubsystemHealth {
  stt: "ok" | "degraded" | "down";
  llm: "ok" | "degraded" | "down";
  bible: "ok" | "degraded" | "down";
}

/** Trimmed session shape used for persistence and export. */
export interface StoredSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  /** Legacy field from sessions saved before the unified Live console. */
  mode?: InterpretationMode;
  sourceLanguage?: string;
  targetLanguage?: string;
  /** The domain the Context Engine ended the session on. */
  domain?: ResolvedDomain;
  title?: string;
  speaker?: string;
  segments: TranscriptSegment[];
  chunks: InterpretationChunk[];
  scripture: BibleReference[];
  glossary: GlossaryItem[];
  culturalNotes: CulturalNote[];
  entities: EntityResolution[];
  corrections: CorrectionRecord[];
}
