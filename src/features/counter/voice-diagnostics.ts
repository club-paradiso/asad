/**
 * Where the seconds go between tapping the microphone and hearing the first word.
 *
 * "Voice feels slow" is not a debuggable report. This records the shape of one
 * attempt — which phase took how long, which provider answered, whether a
 * fallback ran — so a slow desk can be diagnosed without anyone guessing.
 *
 * What it deliberately does NOT record: transcript text, partial text, audio,
 * confidence scores, message content, session codes, or anything else that
 * could reconstruct what a person said. Every field here is a category or a
 * duration. The privacy contract is that this module can be read by anybody
 * and still reveal nothing about any conversation.
 */
import type { CounterSttProvider, SttLanguageSupport } from "@/providers/stt/capability";

export type VoicePhaseMark =
  /** The tap itself. Every other mark is measured from here. */
  | "tap"
  | "permission"
  | "credential"
  | "capture"
  | "provider-ready"
  | "listening"
  | "first-audio"
  | "first-partial"
  | "final";

export type VoiceFailureCategory =
  | "permission"
  | "no-speech"
  | "connection"
  | "provider"
  | "timeout"
  | "unsupported-language"
  | "browser-unsupported"
  | "aborted";

export interface VoiceAttemptRecord {
  /** BCP-47 tag. A language choice, not a person. */
  language: string;
  provider?: CounterSttProvider;
  support?: SttLanguageSupport;
  usedFallback: boolean;
  failure?: VoiceFailureCategory;
  /** Milliseconds from the tap, keyed by phase. */
  marks: Partial<Record<VoicePhaseMark, number>>;
}

/** Kept small on purpose: this is a diagnostic tail, not an analytics store. */
const MAX_RECORDS = 20;
const records: VoiceAttemptRecord[] = [];

export class VoiceAttemptTrace {
  private readonly startedAt: number;
  private readonly record: VoiceAttemptRecord;

  constructor(
    language: string,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.startedAt = now();
    this.record = { language, usedFallback: false, marks: { tap: 0 } };
  }

  mark(phase: VoicePhaseMark): void {
    // First occurrence wins. A reconnect must not overwrite the number that
    // describes how long the visitor actually waited before speaking.
    if (this.record.marks[phase] !== undefined) return;
    this.record.marks[phase] = this.now() - this.startedAt;
  }

  provider(provider: CounterSttProvider, support: SttLanguageSupport): void {
    this.record.provider = provider;
    this.record.support = support;
  }

  fallback(): void {
    this.record.usedFallback = true;
  }

  finish(failure?: VoiceFailureCategory): VoiceAttemptRecord {
    if (failure) this.record.failure = failure;
    this.mark("final");
    const snapshot: VoiceAttemptRecord = { ...this.record, marks: { ...this.record.marks } };
    records.push(snapshot);
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
    return snapshot;
  }
}

/** Most recent attempts, newest last. */
export const voiceAttempts = (): readonly VoiceAttemptRecord[] => records;

/** Test seam. */
export const __resetVoiceAttempts = () => {
  records.length = 0;
};

/**
 * The one number that matters at a desk: tap to genuinely listening.
 * `undefined` when the attempt never reached a listening state.
 */
export const timeToListening = (record: VoiceAttemptRecord): number | undefined =>
  record.marks.listening;
