/**
 * Cultural, idiomatic and wordplay detection.
 *
 * This runs locally, before and independently of the model, for two reasons:
 * it is instant (no round trip), and it stays correct in demo mode and when
 * the LLM subsystem is down. The model can add notes on top; it cannot be the
 * only thing standing between a pun and "there is a road in my name".
 */
import type { CulturalNote, EntityResolution } from "@/types";
import {
  IDIOMS,
  NAME_SYLLABLE_MEANINGS,
  PUNNABLE_NOUNS,
  UNTRANSLATABLES,
} from "./lexicon";
import { findWholeWordOccurrences } from "../glossary/match-korean";

/** Phrases a speaker uses when pointing at their own name. */
const SELF_NAME_MARKERS = [
  "제 이름", "내 이름", "저의 이름", "이름에도", "이름이", "이름은", "이름 뜻",
];

/**
 * True when `noun` appears in `text` as a standalone word — followed by a
 * particle, punctuation or a space — rather than merely as a substring of a
 * longer word.
 *
 * This is the same rule the glossary uses, and for the same reason: 길 must
 * match in 길을 잘 찾아야 but not in 길이가 (length) or 갈림길에서.
 */
export function containsBareNoun(text: string, noun: string): boolean {
  return findWholeWordOccurrences(text, noun).length > 0;
}

/**
 * Detect a name-based pun: a person known to the session has a name syllable
 * that is also being used as an ordinary noun nearby.
 *
 * Confidence is highest when the speaker explicitly points at their own name
 * ("제 이름에도 길이 있어요"), which is exactly the acceptance case.
 */
export function detectNamePuns(
  text: string,
  entities: EntityResolution[],
): CulturalNote[] {
  const notes: CulturalNote[] = [];
  const pointsAtName = SELF_NAME_MARKERS.some((m) => text.includes(m));

  for (const entity of entities) {
    if (entity.kind !== "person") continue;
    const name = entity.korean.trim();
    if (!name) continue;

    for (const [noun, meaning] of Object.entries(PUNNABLE_NOUNS)) {
      if (!name.includes(noun)) continue;
      if (!containsBareNoun(text, noun)) continue;

      const given = name.length > 1 ? name.slice(1) : name;
      const romanised = entity.english || name;
      notes.push({
        kind: "wordplay",
        korean: noun,
        note: pointsAtName
          ? `Name pun: "${noun}" (${meaning}) is in ${romanised}'s name — ${given}.`
          : `"${noun}" (${meaning}) is also in ${romanised}'s name — a pun may be coming.`,
        suggestion: pointsAtName
          ? `And speaking of "the ${meaning.split(" / ")[0]}," it's even in my name.`
          : undefined,
      });
      break;
    }
  }

  return notes;
}

/**
 * Detect a self-contained pun where the speaker says a word means something —
 * no session entity required.
 */
export function detectHanjaHints(text: string): CulturalNote[] {
  if (!SELF_NAME_MARKERS.some((m) => text.includes(m))) return [];
  const notes: CulturalNote[] = [];
  for (const [syllable, meaning] of Object.entries(NAME_SYLLABLE_MEANINGS)) {
    if (!containsBareNoun(text, syllable)) continue;
    notes.push({
      kind: "hanja",
      korean: syllable,
      note: `"${syllable}" means ${meaning} — the speaker is pointing at the meaning of a name.`,
    });
    if (notes.length >= 2) break;
  }
  return notes;
}

/**
 * Shortest entry that may be matched by plain substring search.
 *
 * Anything shorter has to match as a whole word. Korean agglutinates, so a
 * two-syllable entry will otherwise fire inside an unrelated word — 한 matches
 * inside 거룩한, 정 inside 정말 — and a false cultural note on a live console is
 * worse than no note at all.
 */
const SUBSTRING_SAFE_LENGTH = 3;

/** Detect known idioms and untranslatable set phrases. */
export function detectIdioms(text: string): CulturalNote[] {
  const notes: CulturalNote[] = [];
  for (const entry of [...UNTRANSLATABLES, ...IDIOMS]) {
    const matched =
      entry.korean.replace(/\s/g, "").length >= SUBSTRING_SAFE_LENGTH
        ? text.includes(entry.korean)
        : containsBareNoun(text, entry.korean);
    if (!matched) continue;
    notes.push({
      kind: entry.kind,
      korean: entry.korean,
      note: entry.note,
      suggestion: entry.suggestion,
    });
    if (notes.length >= 3) break;
  }
  return notes;
}

/**
 * All locally detectable cultural assistance for a piece of Korean, ordered
 * with wordplay first — that is the one an interpreter cannot recover from
 * once they have already said the literal version.
 */
export function detectCultural(
  text: string,
  entities: EntityResolution[] = [],
): CulturalNote[] {
  if (!text.trim()) return [];
  const notes = [
    ...detectNamePuns(text, entities),
    ...detectIdioms(text),
    ...detectHanjaHints(text),
  ];
  return dedupeNotes(notes).slice(0, 4);
}

export function dedupeNotes(notes: CulturalNote[]): CulturalNote[] {
  const seen = new Set<string>();
  return notes.filter((n) => {
    const key = `${n.kind}:${n.korean}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
