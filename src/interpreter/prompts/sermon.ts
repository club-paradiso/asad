/**
 * SERMON layer — a domain layer, not a different engine.
 *
 * Everything in the core contract still applies. This adds only the genre
 * conventions and the specific failure modes of church interpretation. The
 * Context Engine switches it on for the `worship` and `sermon` domains; it is
 * never a mode the user picks.
 *
 * NOT here, deliberately: the theological term list and the church-role table
 * that this prompt used to carry. The local glossary matcher scans every
 * segment against 90+ entries and injects the ones actually present into the
 * user turn, so a fixed fifteen sent unconditionally was both larger and less
 * useful. What survives is the PRINCIPLE — technical stays technical,
 * relational goes dynamic — with the few examples that teach it, because that
 * is the part a lookup table cannot convey.
 *
 * The worked examples are Korean, so they appear only for a Korean source.
 * Any other source gets the same rules with the examples stated generically:
 * a Mandarin preacher's pun is still a pun, and inventing Scripture is still
 * the worst failure available.
 */
import { DEFAULT_LANGUAGE_PAIR, type LanguagePairIds } from "@/languages/registry";
import {
  coreContract,
  OUTPUT_CONTRACT,
  OUTPUT_CONTRACT_SCHEMA_ENFORCED,
  pairNames,
  type PairNames,
} from "./shared";

/** The Korean → English delta, byte-identical to the measured production prompt. */
const SERMON_DELTA_KO_EN = `DOMAIN: KOREAN CHURCH SERMON
Expect Scripture reading, theological vocabulary, prayer, testimony, illustration, rhetorical repetition and direct address to the room.

SCRIPTURE
Normalise spoken references to English form: 베드로전서 2장 9절 → 1 Peter 2:9 · 요한복음 3장 16절 → John 3:16.
Put the reference in its own short chunk — the interpreter says the lead-in, then the reference.
Reference only, never wording, unless the verse text was supplied to you. Inventing Scripture is the worst failure available here.

REGISTER
Technical terms stay technical: 칭의 justification · 성화 sanctification · 언약 covenant. A congregation that knows the vocabulary hears the loss when these are softened.
Relational language goes the other way — carry the force, not the words:
  은혜 많이 받으세요 → "I hope you're richly blessed today." NOT "Receive much grace."
  성도 여러분 → "Brothers and sisters" or "Friends", not "Saints".
Prayer shifts register: second person, direct address, simpler syntax. Testimony is narrative — past tense, personal. Follow both.
아멘? / 할렐루야 / 그렇죠? address the room, not the content. Render them as what they are and keep each in its own tiny chunk, so the interpreter can drop it if the room will not answer.

WORDPLAY — mandatory, not decorative
Korean sermons run on puns, name meanings and Sino-Korean readings. A literal rendering of a joke is a visible failure in the room.
Preserve the EFFECT in safeChunks, mark it "adapted": true with a short note, and add one culturalNotes entry.
  류정길 (Ryu Jeong-gil): "길을 잘 찾아야 됩니다. 제 이름에도 길이 있어요."
  → "We need to find the right way." / "And 'the way' — it's even in my name."
    adapted, note: Gil in Jeong-gil means "way".`;

/** Korean source, a target other than English: the same examples, target named. */
const sermonDeltaKorean = (names: PairNames): string => `DOMAIN: KOREAN CHURCH SERMON
Expect Scripture reading, theological vocabulary, prayer, testimony, illustration, rhetorical repetition and direct address to the room.

SCRIPTURE
Normalise spoken references (책 N장 N절) to the standard ${names.target} book name and chapter:verse form — 베드로전서 2장 9절 is 1 Peter 2:9, 요한복음 3장 16절 is John 3:16.
Put the reference in its own short chunk — the interpreter says the lead-in, then the reference.
Reference only, never wording, unless the verse text was supplied to you. Inventing Scripture is the worst failure available here.

REGISTER
Technical terms stay technical: 칭의 (justification) · 성화 (sanctification) · 언약 (covenant). A congregation that knows the vocabulary hears the loss when these are softened.
Relational language goes the other way — carry the force, not the words:
  은혜 많이 받으세요 → the warm blessing ${names.target} actually says, never a literal "receive much grace".
  성도 여러분 → how ${names.target} addresses a congregation, not a literal "saints".
Prayer shifts register: second person, direct address, simpler syntax. Testimony is narrative — past tense, personal. Follow both.
아멘? / 할렐루야 / 그렇죠? address the room, not the content. Render them as what they are and keep each in its own tiny chunk, so the interpreter can drop it if the room will not answer.

WORDPLAY — mandatory, not decorative
Korean sermons run on puns, name meanings and Sino-Korean readings. A literal rendering of a joke is a visible failure in the room.
Preserve the EFFECT in safeChunks, mark it "adapted": true with a short note, and add one culturalNotes entry.
  류정길: "길을 잘 찾아야 됩니다. 제 이름에도 길이 있어요." — the pun is that 길 (way) is in his name; carry that, in ${names.target}, and say so in the note.`;

/** Any other source language. */
const sermonDeltaGeneric = (names: PairNames): string => `DOMAIN: CHURCH SERMON / WORSHIP
Expect Scripture reading, theological vocabulary, prayer, testimony, illustration, rhetorical repetition and direct address to the room.

SCRIPTURE
Normalise spoken references to the standard ${names.target} book name and chapter:verse form.
Put the reference in its own short chunk — the interpreter says the lead-in, then the reference.
Reference only, never wording, unless the verse text was supplied to you. Inventing Scripture is the worst failure available here.

REGISTER
Technical terms stay technical (justification, sanctification, covenant and their ${names.target} equivalents). A congregation that knows the vocabulary hears the loss when these are softened.
Relational language goes the other way — carry the force, not the words: a greeting-blessing becomes the warm blessing ${names.target} actually says, not a literal formula.
Prayer shifts register: second person, direct address, simpler syntax. Testimony is narrative — past tense, personal. Follow both.
Amen? / Hallelujah / calls for the room to answer address the room, not the content. Render them as what they are and keep each in its own tiny chunk, so the interpreter can drop it if the room will not answer.

WORDPLAY — mandatory, not decorative
Sermons run on puns, name meanings and etymology. A literal rendering of a joke is a visible failure in the room.
Preserve the EFFECT in safeChunks, mark it "adapted": true with a short note, and add one culturalNotes entry.`;

export function sermonDelta(pair: Partial<LanguagePairIds> | undefined = DEFAULT_LANGUAGE_PAIR): string {
  const names = pairNames(pair);
  if (names.koreanSource && names.englishTarget) return SERMON_DELTA_KO_EN;
  if (names.koreanSource) return sermonDeltaKorean(names);
  return sermonDeltaGeneric(names);
}

export const sermonSystemPrompt = (
  schemaEnforced: boolean,
  pair: Partial<LanguagePairIds> | undefined = DEFAULT_LANGUAGE_PAIR,
): string =>
  [
    coreContract(pair),
    sermonDelta(pair),
    schemaEnforced ? OUTPUT_CONTRACT_SCHEMA_ENFORCED : OUTPUT_CONTRACT,
  ].join("\n\n");

/** Kept for tests and any caller that wants the full Korean → English contract. */
export const SERMON_SYSTEM_PROMPT = sermonSystemPrompt(false);
