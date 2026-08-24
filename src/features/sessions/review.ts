/**
 * Post-session review.
 *
 * Built entirely from session data, deterministically — no model call, so it
 * works offline and after a demo. The intent is to turn tong-yuck into a
 * training tool as well as a live one: what did the recogniser keep getting
 * wrong, which terms recurred, and what should be on the prep sheet next time.
 */
import type {
  BibleReference,
  CorrectionRecord,
  CulturalNote,
  GlossaryItem,
  InterpretationChunk,
  StoredSession,
  TranscriptSegment,
} from "@/types";
import { recurringTerms } from "@/interpreter/context/memory";

export interface SessionReview {
  durationMs: number;
  segmentCount: number;
  chunkCount: number;
  koreanCharacters: number;
  /** Chunks the engine or the model was not confident about. */
  uncertain: InterpretationChunk[];
  /** Chunks that were adapted rather than translated literally. */
  adapted: InterpretationChunk[];
  scripture: BibleReference[];
  glossary: GlossaryItem[];
  culturalNotes: CulturalNote[];
  corrections: CorrectionRecord[];
  /** Recognition errors the interpreter had to fix more than once. */
  recurringRecognitionErrors: Array<{ from: string; to: string; occurrences: number }>;
  /** Terminology worth pre-loading next time. */
  suggestedPrepTerms: GlossaryItem[];
  /** Structural challenges observed in this session. */
  challenges: string[];
}

const countOccurrences = (haystack: string, needle: string): number => {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
};

/** Korean sentences long enough to force restructuring. */
const LONG_SENTENCE_CHARS = 60;

export function buildReview(session: StoredSession): SessionReview {
  const durationMs = (session.endedAt ?? session.startedAt) - session.startedAt;
  const koreanText = session.segments.map((s) => s.text).join(" ");
  const originals = session.segments
    .map((s) => s.originalText)
    .filter((text): text is string => !!text)
    .join(" ");

  const recurringRecognitionErrors = session.corrections
    .map((correction) => ({
      from: correction.from,
      to: correction.to,
      // Count in the pre-correction text as well, since corrections rewrite
      // the transcript in place.
      occurrences:
        countOccurrences(originals, correction.from) + countOccurrences(koreanText, correction.to),
    }))
    .filter((entry) => entry.occurrences > 1)
    .sort((a, b) => b.occurrences - a.occurrences);

  return {
    durationMs,
    segmentCount: session.segments.length,
    chunkCount: session.chunks.length,
    koreanCharacters: koreanText.replace(/\s/g, "").length,
    uncertain: session.chunks.filter((c) => c.confidence === "low"),
    adapted: session.chunks.filter((c) => c.adapted),
    scripture: session.scripture,
    glossary: session.glossary,
    culturalNotes: session.culturalNotes,
    corrections: session.corrections,
    recurringRecognitionErrors,
    suggestedPrepTerms: suggestPrepTerms(session),
    challenges: describeChallenges(session.segments, session.chunks),
  };
}

/**
 * What belongs on the prep sheet next time: terms that recurred, every name
 * the interpreter had to correct, and the Scripture that came up.
 */
function suggestPrepTerms(session: StoredSession): GlossaryItem[] {
  const recurring = recurringTerms(
    session.segments.map((s) => s.text),
    session.glossary,
  );

  const fromCorrections: GlossaryItem[] = session.corrections.map((correction) => ({
    korean: correction.to,
    english: correction.english ?? correction.to,
    note: `Recogniser heard "${correction.from}"`,
    source: "prep",
  }));

  const fromEntities: GlossaryItem[] = session.entities
    .filter((entity) => entity.kind === "person")
    .map((entity) => ({
      korean: entity.korean,
      english: entity.english,
      note: entity.note === "user" ? "You set this romanisation" : undefined,
      source: "prep",
    }));

  const seen = new Set<string>();
  return [...fromCorrections, ...fromEntities, ...recurring].filter((item) => {
    const key = item.korean.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describeChallenges(
  segments: TranscriptSegment[],
  chunks: InterpretationChunk[],
): string[] {
  const challenges: string[] = [];

  const longSentences = segments.filter((s) => s.text.length > LONG_SENTENCE_CHARS).length;
  if (longSentences > 0) {
    challenges.push(
      `${longSentences} segment${longSentences === 1 ? "" : "s"} ran past ${LONG_SENTENCE_CHARS} characters — these are the ones that force early restructuring.`,
    );
  }

  const adapted = chunks.filter((c) => c.adapted).length;
  if (adapted > 0) {
    challenges.push(
      `${adapted} line${adapted === 1 ? "" : "s"} needed cultural adaptation rather than translation.`,
    );
  }

  const uncertain = chunks.filter((c) => c.confidence === "low").length;
  if (uncertain > 0) {
    challenges.push(
      `${uncertain} line${uncertain === 1 ? "" : "s"} came through with low confidence — worth checking against your memory of what was said.`,
    );
  }

  const corrected = segments.filter((s) => s.corrected).length;
  if (corrected > 0) {
    challenges.push(
      `${corrected} segment${corrected === 1 ? "" : "s"} were corrected after recognition.`,
    );
  }

  if (challenges.length === 0) {
    challenges.push("No structural difficulties flagged in this session.");
  }

  return challenges;
}
