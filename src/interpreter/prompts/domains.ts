/**
 * Context deltas — a domain layer, not a different engine.
 *
 * Everything in `coreContract` still applies. Each delta adds only the genre
 * conventions and the specific failure modes of that setting, and each is
 * short: the core is ~85% of the prompt and is identical across contexts, so a
 * provider's prompt cache hits whichever way a session resolves.
 *
 * These replaced a hard fork between two product modes. The worship delta is
 * the old sermon prompt, unchanged, because it was measured and it works; the
 * other five are new and deliberately smaller, because the evidence for them
 * is weaker and an over-confident domain steer is worse than none.
 *
 * NOT here, deliberately: the theological term list and the church-role table
 * the worship prompt used to carry. The local glossary matcher scans every
 * segment against 90+ entries and injects the ones actually present into the
 * user turn, so a fixed fifteen sent unconditionally was both larger and less
 * useful. What survives is the PRINCIPLE — technical stays technical,
 * relational goes dynamic — with the few examples that teach it, because that
 * is the part a lookup table cannot convey.
 */
import type { ResolvedContext } from "@/types";
import { findLanguage, languageName } from "@/lib/languages";
import type { PromptLanguages } from "./shared";

/* --------------------------------------------------------------------------
 * Full deltas
 * ------------------------------------------------------------------------ */

const WORSHIP_DELTA = `DOMAIN: KOREAN CHURCH SERMON
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

const LECTURE_DELTA = `DOMAIN: LECTURE / TEACHING
One speaker developing structured material for people taking it in for the first time.
Keep the scaffolding audible: enumerations, "first/second/third", definitions and the return to a thesis are what the listener is following.
A defined term keeps the same rendering for the whole session once it is settled. Do not paraphrase a term you already rendered.
Worked examples, figures and citations are content, not padding. Never round a figure and never complete a citation you were not given — name it, do not recite it.`;

const MEETING_DELTA = `DOMAIN: MEETING
Several speakers, an agenda, and decisions people will act on.
Preserve modality and obligation exactly. May, must, can, cannot, should and is required to are different commitments.
Preserve WHO is doing what, and by when. An owner and a deadline are the two things a meeting exists to produce.
Preserve conditionals whole. Do not resolve an open question into a decision.
Short, plain sentences. Do not smooth a disagreement into agreement.`;

const CONVERSATION_DELTA = `DOMAIN: CONVERSATION
Two or a few people, short turns, questions answered in the next turn.
Keep the utterance's speech act: a question stays a question, a request stays a request, a hedge stays a hedge.
Keep turns short — one or two chunks is usually the whole turn. Do not merge a question and its answer.
Names, numbers, dates, amounts and addresses are the point of most of these turns. Never tidy one.`;

const EVENT_DELTA = `DOMAIN: EVENT / PROGRAMME
A programme run from a stage: welcomes, introductions, announcements, hand-offs between items.
Titles, organisations and honorifics in an introduction are the content. Render a title fully the first time and consistently after that.
Times, room numbers and running order are actionable — never approximate one.
Applause lines and welcomes get their own short chunk so the interpreter can place them.`;

const GENERIC_DELTA = `DOMAIN: GENERAL
Assume nothing religious.

REGISTER
Match the speaker's. A board meeting is not a lecture and neither is an immigration counter.`;

const KOREAN_REGISTER_LINE = `Korean honorific levels rarely survive into ${"{TARGET}"} — carry the RESPECT, not the grammar. 하십시오체 becomes ordinary polite ${"{TARGET}"}, never archaic ${"{TARGET}"}.`;

/* --------------------------------------------------------------------------
 * Compact deltas — the hot path
 * ------------------------------------------------------------------------ */

const WORSHIP_COMPACT = `DOMAIN: KOREAN CHURCH SERMON
Expect Scripture, theology, prayer, testimony, illustration, repetition and direct address.
Normalise spoken references: 베드로전서 2장 9절 → 1 Peter 2:9. Reference only, never wording, unless verse text was supplied. Inventing Scripture is forbidden.
Keep technical theology technical. Carry relational force naturally: 은혜 많이 받으세요 → "I hope you're richly blessed today.", not "Receive much grace."
Prayer uses direct, simple English. Testimony stays narrative. 아멘?/할렐루야/그렇죠? address the room; keep them as their own tiny chunk.
For wordplay, preserve the effect rather than literal wording; mark the safe chunk adapted and add culturalNotes.`;

const LECTURE_COMPACT = `DOMAIN: LECTURE
Structured teaching. Keep enumerations, definitions and the thesis audible. A settled term keeps its rendering. Never round a figure or complete a citation you were not given.`;

const MEETING_COMPACT = `DOMAIN: MEETING
Agenda and decisions. Preserve modality, obligation, owner and deadline exactly. Keep conditionals whole; never resolve an open question into a decision.`;

const CONVERSATION_COMPACT = `DOMAIN: CONVERSATION
Short turns. Keep the speech act — a question stays a question. Never merge a question with its answer. Never tidy a name, number, date, amount or address.`;

const EVENT_COMPACT = `DOMAIN: EVENT
Stage programme. Titles and organisations are content; render them fully and consistently. Times and running order are never approximated. Welcomes get their own chunk.`;

const GENERIC_COMPACT = `DOMAIN: GENERAL
Assume nothing religious. Match the speaker's register.`;

/* --------------------------------------------------------------------------
 * Assembly
 * ------------------------------------------------------------------------ */

const FULL: Record<ResolvedContext, string> = {
  worship: WORSHIP_DELTA,
  lecture: LECTURE_DELTA,
  meeting: MEETING_DELTA,
  conversation: CONVERSATION_DELTA,
  event: EVENT_DELTA,
  generic: GENERIC_DELTA,
};

const COMPACT: Record<ResolvedContext, string> = {
  worship: WORSHIP_COMPACT,
  lecture: LECTURE_COMPACT,
  meeting: MEETING_COMPACT,
  conversation: CONVERSATION_COMPACT,
  event: EVENT_COMPACT,
  generic: GENERIC_COMPACT,
};

/**
 * Honorific guidance is a property of the SOURCE language, not of the setting,
 * so it is appended to whichever delta applies rather than duplicated into six
 * of them. Korean is the case the product actually ships; adding another means
 * adding it here, once.
 */
function registerAppendix(languages: PromptLanguages): string | null {
  if (findLanguage(languages.source)?.base !== "ko") return null;
  return KOREAN_REGISTER_LINE.replaceAll("{TARGET}", languageName(languages.target));
}

/**
 * What the target language's WRITTEN form has to be.
 *
 * Only emitted for a tag whose meaning is a script variant. A model asked for
 * "Chinese" produces Simplified by default, so a reader who chose 中文（繁體）
 * gets the wrong script unless it is said explicitly — the same root cause as
 * the recogniser-side variant problem, one layer up.
 */
export function targetScriptDirective(target: string): string | null {
  const definition = findLanguage(target);
  if (!definition?.scriptVariant) return null;
  if (definition.id === "zh-TW") {
    return `TARGET WRITING: Traditional Chinese characters (繁體中文), Taiwan Mandarin usage. Never Simplified characters and never pinyin.`;
  }
  if (definition.id === "zh-CN") {
    return `TARGET WRITING: Simplified Chinese characters (简体中文), Mainland Mandarin usage. Never Traditional characters and never pinyin.`;
  }
  return `TARGET WRITING: ${definition.en}, in the ${definition.script} script. Do not substitute another script.`;
}

export function contextDelta(
  context: ResolvedContext,
  languages: PromptLanguages,
  options: { compact?: boolean } = {},
): string {
  const delta = options.compact ? COMPACT[context] : FULL[context];
  const register = registerAppendix(languages);
  const script = targetScriptDirective(languages.target);
  return [
    delta,
    // The worship delta carries its own detailed register section; appending a
    // second one there would contradict it in fewer words.
    context === "worship" ? null : register,
    script,
  ]
    .filter(Boolean)
    .join(options.compact ? "\n" : "\n");
}
