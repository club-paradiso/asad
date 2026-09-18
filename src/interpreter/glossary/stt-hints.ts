import type { PrepSheet, ResolvedContext } from "@/types";
import { notableTermsIn } from "@/lib/code-switch";
import { isWorshipContext } from "../context/context-mode";
import { THEOLOGICAL_LEXICON } from "./lexicon";
import { matchGlossary } from "./matcher";

/** Deepgram currently receives at most this many `keyterm` hints. */
export const STT_HINT_LIMIT = 50;

/**
 * Core worship vocabulary worth keeping in the recogniser even when no prep
 * material was supplied. The order is deliberate: these are common, costly to
 * misrecognise, and useful across denominations without trying to stuff the
 * entire 447-entry community glossary into every socket URL.
 */
const WORSHIP_BASELINE = [
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
 *    volunteer community glossary in a worship context;
 * 3. a conservative worship baseline from the curated theological lexicon.
 *
 * This is intentionally not "send all 447 terms". Recognition hints bias the
 * acoustic model; irrelevant hints can make recognition worse, not better.
 */
export interface SttHintOptions {
  limit?: number;
  /**
   * Whether the guest language's own forms belong in the recogniser vocabulary.
   *
   * They do whenever a session is interpreting BETWEEN two languages, which is
   * every live session: the speaker will say "Putnam", "conversion rate" and
   * "RAG" in the middle of Korean sentences, and a keyterm list containing only
   * Korean gives the recogniser no reason to believe it heard English. Counter
   * Mode passes false for a one-language turn.
   */
  includeGuestForms?: boolean;
}

export function buildSttHints(
  context: ResolvedContext,
  prep: PrepSheet | undefined,
  options: SttHintOptions | number = {},
): string[] {
  const settings: SttHintOptions = typeof options === "number" ? { limit: options } : options;
  const limit = settings.limit ?? STT_HINT_LIMIT;
  const includeGuestForms = settings.includeGuestForms ?? false;
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

  // The SAME terms in the guest language.
  //
  // A recogniser hint list biases what the acoustic model is willing to hear.
  // Listing 사회적 자본 and not "social capital" tells it, in effect, that
  // English is not expected — which is exactly wrong for a speaker who says
  // both in one sentence. These are terms the interpreter already wrote down,
  // so they cost nothing to collect and are the highest-value English the
  // session has.
  if (includeGuestForms) {
    for (const entity of prep?.entities ?? []) add(entity.english);
    for (const item of prep?.glossary ?? []) add(item.english);
  }

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
    // matchGlossary includes the 447-entry volunteer glossary in worship,
    // but only terms present in today's prep material earn recogniser budget.
    for (const match of matchGlossary(prepCorpus, context, prep?.glossary ?? [])) {
      add(match.korean);
    }
  }

  // The notable terms the interpreter typed into today's material — proper
  // nouns, product names, acronyms, identifiers; anything a recogniser will
  // otherwise get wrong. Deterministic, already on the prep sheet, and the one
  // place a session's real vocabulary is written down before it is spoken.
  //
  // Script-independent by design: 퍼트넘, Vercel, RAG and E-7 are all worth
  // biasing for, and a Korean→Chinese service's prep sheet yields its own
  // terms the same way a Korean→English one does.
  if (includeGuestForms && prepCorpus) {
    for (const term of notableTermsIn(prepCorpus, limit)) {
      if (term.length >= 3) add(term);
    }
  }

  if (isWorshipContext(context)) {
    const curated = new Set(THEOLOGICAL_LEXICON.map((item) => item.korean));
    for (const term of WORSHIP_BASELINE) {
      if (curated.has(term)) add(term);
    }
  }

  return out.slice(0, limit);
}
