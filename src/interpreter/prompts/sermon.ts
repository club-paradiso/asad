/**
 * SERMON mode — a domain layer, not a different engine.
 *
 * Everything in `CORE_CONTRACT` still applies. This adds only the genre
 * conventions and the specific failure modes of Korean church interpretation.
 *
 * NOT here, deliberately: the theological term list and the church-role table
 * that this prompt used to carry. The local glossary matcher scans every
 * segment against 90+ entries and injects the ones actually present into the
 * user turn, so a fixed fifteen sent unconditionally was both larger and less
 * useful. What survives is the PRINCIPLE — technical stays technical,
 * relational goes dynamic — with the few examples that teach it, because that
 * is the part a lookup table cannot convey.
 */
import {
  CORE_CONTRACT,
  OUTPUT_CONTRACT,
  OUTPUT_CONTRACT_SCHEMA_ENFORCED,
} from "./shared";

const SERMON_DELTA = `DOMAIN: KOREAN CHURCH SERMON
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

export const sermonSystemPrompt = (schemaEnforced: boolean): string =>
  [
    CORE_CONTRACT,
    SERMON_DELTA,
    schemaEnforced ? OUTPUT_CONTRACT_SCHEMA_ENFORCED : OUTPUT_CONTRACT,
  ].join("\n\n");

/** Kept for tests and any caller that wants the full contract. */
export const SERMON_SYSTEM_PROMPT = sermonSystemPrompt(false);
