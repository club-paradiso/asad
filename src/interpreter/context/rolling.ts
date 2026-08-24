/**
 * Rolling context with compression.
 *
 * A sermon runs 20–70 minutes. Sending the whole transcript on every LLM call
 * would be slow, expensive and — past a point — actively worse, because the
 * model starts attending to the introduction instead of the sentence being
 * spoken right now.
 *
 * So the window is bounded by characters, and everything that falls out of it
 * is folded into a compact summary line rather than dropped.
 */
import type {
  CorrectionRecord,
  EntityResolution,
  GlossaryItem,
  InterpretationChunk,
  InterpretationMode,
  PrepSheet,
  TranscriptSegment,
} from "@/types";
import type { InterpretRequest } from "@/lib/schema";
import type { SessionMemory } from "./memory";

/** Character budgets for the rolling window. Tuned for latency, not recall. */
export const CONTEXT_BUDGET = {
  /** Recent Korean sent verbatim. */
  koreanChars: 900,
  /** Recent English sent verbatim. */
  englishChars: 700,
  /** Maximum length of the compressed summary of everything older. */
  summaryChars: 700,
  /** Maximum segments regardless of size. */
  maxSegments: 12,
  maxChunks: 12,
  maxGlossary: 24,
  maxEntities: 16,
  maxScripture: 8,
  maxCorrections: 16,
} as const;

export interface RollingContext {
  summary: string;
  topic?: string;
  recentKorean: string[];
  recentEnglish: string[];
  glossary: GlossaryItem[];
  entities: EntityResolution[];
  scripture: string[];
  corrections: Array<{ from: string; to: string; english?: string }>;
  prep?: InterpretRequest["context"]["prep"];
}

/** Take items from the end of a list until a character budget is spent. */
function takeTail<T>(items: T[], budget: number, maxCount: number, size: (item: T) => number): T[] {
  const out: T[] = [];
  let used = 0;
  for (let i = items.length - 1; i >= 0 && out.length < maxCount; i -= 1) {
    const cost = size(items[i]);
    if (used + cost > budget && out.length > 0) break;
    out.unshift(items[i]);
    used += cost;
  }
  return out;
}

/**
 * Compress the segments that fell out of the verbatim window into a single
 * line of context.
 *
 * This is deliberately deterministic and local: no extra model call, no extra
 * latency, no extra cost, and it still works when the LLM subsystem is down.
 * It keeps what a returning interpreter would want — the topic, the passages
 * covered, the people named and the terms already settled.
 */
export function compressHistory(
  older: TranscriptSegment[],
  memory: SessionMemory,
  mode: InterpretationMode,
): string {
  if (older.length === 0) return "";

  const parts: string[] = [];
  const minutes = Math.max(1, Math.round((older[older.length - 1].at - older[0].at) / 60000));
  parts.push(
    `Earlier in this ${mode === "sermon" ? "sermon" : "session"} (~${minutes} min, ${older.length} segments so far).`,
  );
  if (memory.topic) parts.push(`Topic: ${memory.topic}.`);
  if (memory.scripture.length > 0) {
    parts.push(`Passages covered: ${memory.scripture.slice(-6).join(", ")}.`);
  }

  const people = memory.entities.filter((e) => e.kind === "person").slice(-5);
  if (people.length > 0) {
    parts.push(`People: ${people.map((p) => `${p.korean} = ${p.english}`).join("; ")}.`);
  }

  const settled = memory.glossary.slice(-8);
  if (settled.length > 0) {
    parts.push(`Terms already settled: ${settled.map((g) => `${g.korean}→${g.english}`).join("; ")}.`);
  }

  // The opening line of the oldest surviving segment anchors what was said.
  const opening = older[0].text.slice(0, 80);
  if (opening) parts.push(`Opened with: "${opening}${older[0].text.length > 80 ? "…" : ""}".`);

  const summary = parts.join(" ");
  return summary.length > CONTEXT_BUDGET.summaryChars
    ? `${summary.slice(0, CONTEXT_BUDGET.summaryChars - 1)}…`
    : summary;
}

/**
 * Build the context payload for one interpretation call.
 *
 * Only committed and current English is included — anticipated text is a guess
 * and must never be fed back as though it had been said.
 */
export function buildRollingContext(input: {
  segments: TranscriptSegment[];
  chunks: InterpretationChunk[];
  memory: SessionMemory;
  mode: InterpretationMode;
  prep: PrepSheet;
}): RollingContext {
  const { segments, chunks, memory, mode, prep } = input;

  const recent = takeTail(
    segments,
    CONTEXT_BUDGET.koreanChars,
    CONTEXT_BUDGET.maxSegments,
    (s) => s.text.length,
  );
  const older = segments.slice(0, segments.length - recent.length);

  const spoken = chunks.filter((c) => c.state !== "anticipated");
  const recentEnglish = takeTail(
    spoken,
    CONTEXT_BUDGET.englishChars,
    CONTEXT_BUDGET.maxChunks,
    (c) => c.text.length,
  );

  return {
    summary: compressHistory(older, memory, mode),
    topic: memory.topic,
    recentKorean: recent.map((s) => s.text),
    recentEnglish: recentEnglish.map((c) => c.text),
    glossary: memory.glossary.slice(-CONTEXT_BUDGET.maxGlossary),
    entities: memory.entities.slice(-CONTEXT_BUDGET.maxEntities),
    scripture: memory.scripture.slice(-CONTEXT_BUDGET.maxScripture),
    corrections: memory.corrections
      .slice(-CONTEXT_BUDGET.maxCorrections)
      .map(({ from, to, english }: CorrectionRecord) => ({ from, to, english })),
    prep: prepContext(prep),
  };
}

function prepContext(prep: PrepSheet): InterpretRequest["context"]["prep"] {
  const has =
    prep.speaker || prep.title || prep.organisation || prep.scripture || prep.notes;
  if (!has) return undefined;
  return {
    speaker: prep.speaker || undefined,
    title: prep.title || undefined,
    organisation: prep.organisation || undefined,
    scripture: prep.scripture || undefined,
    notes: prep.notes ? prep.notes.slice(0, 2000) : undefined,
  };
}

/** Rough token estimate for cost display. Korean averages ~1.4 chars/token. */
export function estimateTokens(context: RollingContext, pending: string): number {
  const text = [
    context.summary,
    ...context.recentKorean,
    ...context.recentEnglish,
    ...context.glossary.map((g) => `${g.korean}${g.english}${g.note ?? ""}`),
    ...context.entities.map((e) => `${e.korean}${e.english}`),
    ...context.scripture,
    pending,
  ].join(" ");
  return Math.ceil(text.length / 1.4);
}
