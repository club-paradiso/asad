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
 * Domain specialisation. The interpretation engine itself is domain-agnostic;
 * the mode selects prompt modules, glossaries and resolvers layered on top.
 */
export type InterpretationMode = "sermon" | "general";

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

/** A finalised piece of recognised Korean speech. */
export interface TranscriptSegment {
  id: string;
  text: string;
  /** ms since session start. */
  at: number;
  /** True when this segment replaced an earlier one via user correction. */
  corrected?: boolean;
  /** The text this segment replaced, when `corrected`. */
  originalText?: string;
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
}

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
  mode: InterpretationMode;
  lag: LagProfile;
  view: ConsoleView;
  showKorean: boolean;
  showGlossary: boolean;
  showScripture: boolean;
  fontScale: number;
  /** Session transcripts are only ever stored when the user opts in. */
  saveHistory: boolean;
}

export const defaultSettings = (): SessionSettings => ({
  mode: "sermon",
  lag: "balanced",
  view: "console",
  showKorean: true,
  showGlossary: true,
  showScripture: true,
  fontScale: 1,
  saveHistory: false,
});

/** A user-issued correction, remembered for the rest of the session. */
export interface CorrectionRecord {
  from: string;
  to: string;
  at: number;
  /** Preferred English rendering / romanisation, when supplied. */
  english?: string;
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
  mode: InterpretationMode;
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
