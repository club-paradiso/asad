import type {
  BibleReference,
  CulturalNote,
  EntityResolution,
  GlossaryItem,
  InterpreterOutput,
} from "@/types";

/** One utterance in a scripted demo session. */
export interface DemoBeat {
  id: string;
  /** What the recogniser eventually settles on. */
  korean: string;
  /**
   * Optional explicit partials. When omitted the demo recogniser generates
   * growing prefixes, which is what a real streaming recogniser looks like.
   */
  partials?: string[];
  /** ms between partial emissions — speaking rate. */
  paceMs?: number;
  /** Silence after the stable result, before the next beat starts. */
  holdMs?: number;
  /** The interpretation this beat should produce. */
  output: InterpreterOutput;
  /** What this beat is demonstrating, shown in the demo ribbon. */
  demonstrates: string;
}

export interface DemoScript {
  id: string;
  title: string;
  speaker: string;
  speakerRomanised: string;
  organisation: string;
  scripture: string;
  mode: "sermon" | "general";
  beats: DemoBeat[];
}

export const chunk = (
  text: string,
  extra: Partial<{ confidence: "high" | "medium" | "low"; note: string; adapted: boolean }> = {},
) => ({ text, confidence: extra.confidence ?? "high", ...extra }) as InterpreterOutput["safeChunks"][number];

export const ref = (
  book: string,
  chapter: number,
  verse: number,
  koreanRaw: string,
): BibleReference => ({
  book,
  chapter,
  verse,
  display: `${book} ${chapter}:${verse}`,
  koreanRaw,
  confidence: "high",
});

export const term = (korean: string, english: string, note?: string): GlossaryItem => ({
  korean,
  english,
  note,
  source: "live",
});

export const note = (
  kind: CulturalNote["kind"],
  korean: string,
  text: string,
  suggestion?: string,
): CulturalNote => ({ kind, korean, note: text, suggestion });

export const person = (korean: string, english: string, extra?: string): EntityResolution => ({
  korean,
  english,
  kind: "person",
  note: extra,
});
