import type { InterpretationMode, PrepSheet } from "@/types";
import { THEOLOGICAL_LEXICON } from "./lexicon";
import { matchGlossary } from "./matcher";

/** Deepgram currently receives at most this many `keyterm` hints. */
export const STT_HINT_LIMIT = 50;

/**
 * Core sermon vocabulary worth keeping in the recogniser even when no prep
 * material was supplied. The order is deliberate: these are common, costly to
 * misrecognise, and useful across denominations without trying to stuff the
 * entire 447-entry community glossary into every socket URL.
 */
const SERMON_BASELINE = [
  "하나님",
  "예수님",
  "그리스도",
  "성령",
  "복음",
  "말씀",
  "성경",
  "구원",
  "은혜",
  "믿음",
  "회개",
  "대속",
  "속죄",
  "십자가",
  "부활",
  "언약",
  "칭의",
  "성화",
  "부르심",
  "하나님 나라",
  "영생",
  "기도",
  "예배",
  "찬양",
  "성도",
  "교회",
] as const;

/**
 * Build the small, high-value vocabulary set sent to streaming STT.
 *
 * Priority:
 * 1. session-specific people and terms the interpreter explicitly prepared;
 * 2. terms actually found in the title/scripture/notes/outline, including the
 *    volunteer community glossary in sermon mode;
 * 3. a conservative sermon baseline from the curated theological lexicon.
 *
 * This is intentionally not "send all 447 terms". Recognition hints bias the
 * acoustic model; irrelevant hints can make recognition worse, not better.
 */
export function buildSttHints(
  mode: InterpretationMode,
  prep: PrepSheet | undefined,
  limit = STT_HINT_LIMIT,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (value: string | undefined) => {
    const term = value?.trim();
    if (!term || seen.has(term) || out.length >= limit) return;
    seen.add(term);
    out.push(term);
  };

  add(prep?.speaker);
  for (const entity of prep?.entities ?? []) add(entity.korean);
  for (const item of prep?.glossary ?? []) add(item.korean);

  const prepCorpus = [
    prep?.title,
    prep?.scripture,
    prep?.organisation,
    prep?.notes,
    prep?.outline,
  ]
    .filter((value): value is string => !!value?.trim())
    .join("\n");

  if (prepCorpus) {
    // matchGlossary includes the 447-entry volunteer glossary in sermon mode,
    // but only terms present in today's prep material earn recogniser budget.
    for (const match of matchGlossary(prepCorpus, mode, prep?.glossary ?? [])) {
      add(match.korean);
    }
  }

  if (mode === "sermon") {
    const curated = new Set(THEOLOGICAL_LEXICON.map((item) => item.korean));
    for (const term of SERMON_BASELINE) {
      if (curated.has(term)) add(term);
    }
  }

  return out.slice(0, limit);
}
