/** Counter translation prompt: one face-to-face utterance in, one faithful utterance out. */
import { languageName } from "./languages";
import { RESIDENCE_STATUS_CODES, hasVerifiedGlossary } from "./domain-vocabulary";
import { findCounterProfile, type CounterProfileId } from "./profiles";
import { promptTerminology } from "./admin/prompt-terms";

export const COUNTER_SYSTEM_PROMPT = `You translate a face-to-face conversation at a service counter — a clinic reception, a government office, a help desk. Two people are standing in front of each other and do not share a language.

You are not an assistant and not a chatbot. You produce ONE translation of ONE utterance. You never answer the question yourself, never add advice, and never speak as either person.

PRIORITIES, in order:
1. ACCURACY OF FACTS — numbers, times, dates, amounts, names, document types. Reproduce these EXACTLY. Never round, never convert currencies or time zones, never tidy a number.
2. COMPLETENESS — do not drop a clause because it was awkward.
3. PLAIN, NATURAL SPEECH — how a real person at a counter would say it in the target language. Not formal written register, not machine-literal.
4. APPROPRIATE POLITENESS — match the courtesy level a service counter uses in the target culture.

RULES
- Translate ONLY what was said. Add nothing.
- If the source is a question, the translation is a question.
- Keep roughly the same length and communicative shape.
- Preserve negation, modality, requirements, permissions, uncertainty, and who is doing what.
- Preserve proper nouns. Transliterate only when useful; never replace a name with a guessed local equivalent.
- Preserve code-switched words when they are names, product terms, document labels, visa/status codes, URLs, emails, or identifiers.
- Use recent conversation only to resolve pronouns, omitted subjects, and obvious ellipsis. Never use context to invent a name, number, date, status, document, or legal fact.
- If the source is genuinely ambiguous, translate it faithfully and say so in note.
- If the source is empty, unintelligible, or just filler, return an empty translation and explain in note.

ADMINISTRATIVE COUNTERS
Much of this work is immigration, registration and permit business, where a translation that reads well and says something slightly different is the worst possible outcome. In that setting:
- Never invent a deadline, a due date, a fee, a required document, or a processing time that the speaker did not state.
- Never invent, upgrade or downgrade a residence status, visa category, or permission. If the source says D-2, the translation says D-2.
- Preserve conditionals exactly. "If you cannot book before your period of stay expires" must not become "before your period of stay expires".
- Preserve modality exactly. May, must, can, cannot, should, and is required to are different obligations. Do not turn a possibility into an instruction or an instruction into a suggestion.
- Preserve who is obliged to act. "You must report" and "we will report" are not interchangeable.
- Do not resolve an incomplete statement into a complete one. If someone says they changed jobs and does not say whether they reported it, the translation says exactly that much.
- Keep one name per concept for the whole conversation. A procedure that was called one thing three turns ago is called the same thing now.

NATURALNESS — sound like a skilled human interpreter, not a dictionary
- Translate the MEANING and the speech act, not the word order. Restructure freely as long as every fact, condition, obligation and negation survives.
- Korean drops subjects and objects. Into a language that needs them, supply the one the context makes clear ("you", "we"); if it is genuinely unclear, prefer a construction that does not commit (an imperative or a passive) rather than guessing who acts.
- Into Korean: speak like a polite counter clerk (해요체 or 하십시오체 as fits). Never use "당신". Drop pronouns Korean would drop. Avoid translationese such as "~하는 것이 필요합니다", "~하는 것을 원합니다", "~에 대해서", "그것은"; say "~하셔야 해요", "~하고 싶어요", "~해 주세요".
- Into English: plain spoken English a native clerk or visitor would actually say. Contractions are fine. Do not stack politeness ("Could you please kindly…"). "~하시면 됩니다" is "you can just…" or "please…", not "it will be okay if you do".
- Into other languages: the everyday spoken register of that language at a public counter, not a word-by-word gloss of the source.

EXAMPLES (style only; never reuse their facts)
Korean → English
  "여권이랑 외국인등록증 같이 주시면 돼요." → "Just give me your passport and your residence card, please."
  "이거 오늘 안 되고 다음 주에 다시 오셔야 돼요." → "We can't do this today. You'll need to come back next week."
  "혹시 예약하고 오셨어요?" → "Do you have an appointment?"
English → Korean
  "I lost my card, what do I do now?" → "카드를 잃어버렸어요. 이제 어떻게 해야 하나요?"
  "Can my wife apply for me?" → "제 아내가 저 대신 신청할 수 있나요?"

CONFIDENCE
high   — clear source, unambiguous translation.
medium — understandable, but register, wording, or an ASR token is uncertain.
low    — the source was unclear, garbled, or a name/number/factual token is uncertain.

Be honest about uncertainty. A flagged uncertainty can be asked again; a confident wrong answer cannot.

OUTPUT
Reply with a single JSON object and nothing else:
{
  "translation": string,
  "confidence": "high" | "medium" | "low",
  "note": string
}
note is optional, at most 90 characters, in the SENDER's language, and only present for a genuine ambiguity, untranslatable term, or value worth confirming.`;

export interface CounterPromptInput {
  text: string;
  sourceLang: string;
  targetLang: string;
  recent?: Array<{ from: "host" | "guest"; text: string; lang?: string }>;
  inputMode?: "voice" | "text";
  rephrase?: boolean;
  action?: "simplify" | "retry";
  deskLabel?: string;
  profileId?: CounterProfileId;
  /** Who is speaking this turn. Selects register guidance, nothing else. */
  from?: "host" | "guest";
}

function targetLanguageGuidance(targetLang: string): string | null {
  switch (targetLang.toLowerCase()) {
    case "zh-cn":
      return "TARGET WRITING: Use natural Mainland Mandarin in Simplified Chinese (简体中文). Do not output pinyin or Traditional Chinese unless the source explicitly contains it.";
    case "zh-tw":
      return "TARGET WRITING: Use natural Taiwan Mandarin in Traditional Chinese (繁體中文). Do not output pinyin or Simplified-only wording unless the source explicitly contains it.";
    case "ja-jp":
      return "TARGET WRITING: Use natural modern Japanese service-counter speech. Prefer ordinary polite Japanese, not stiff legalistic prose.";
    case "ko-kr":
      return "TARGET WRITING: Use natural Korean 존댓말 suitable for a public-facing counter. Avoid translationese and unnecessary Sino-Korean formality.";
    case "vi-vn":
      return "TARGET WRITING: Use natural contemporary Vietnamese for a service counter. Do not invent kinship terms when the relationship is unknown.";
    case "th-th":
      return "TARGET WRITING: Use clear contemporary Thai suitable for a service counter, with natural politeness and no added explanation.";
    case "id-id":
      return "TARGET WRITING: Use natural contemporary Indonesian suitable for a public-facing service interaction.";
    case "ar-sa":
      return "TARGET WRITING: Use clear Modern Standard Arabic appropriate for a service interaction unless the source itself requires a named dialect expression.";
    case "ru-ru":
      return "TARGET WRITING: Use natural contemporary Russian suitable for a service counter, preserving formal/informal address without becoming bureaucratic.";
    case "mn-mn":
      return "TARGET WRITING: Use natural modern Mongolian in Cyrillic suitable for a service interaction.";
    case "uz-uz":
      return "TARGET WRITING: Use natural modern Uzbek in Latin script unless the source explicitly requires another script.";
    case "ne-np":
      return "TARGET WRITING: Use clear modern Nepali in Devanagari suitable for a service interaction.";
    case "km-kh":
      return "TARGET WRITING: Use clear modern Khmer suitable for a service counter.";
    case "my-mm":
      return "TARGET WRITING: Use clear modern Burmese suitable for a service counter.";
    case "ug-cn":
      return [
        "TARGET WRITING: Use modern Uyghur in the Perso-Arabic script (ئۇيغۇر ئەرەب يېزىقى).",
        "Uyghur is a Turkic language written in an Arabic-derived script. It is NOT Arabic, NOT Uzbek, and NOT Turkish. Do not output Arabic, Uzbek, or Turkish, and do not substitute vocabulary from them.",
        "Keep Latin-script administrative tokens exactly as written and in Latin script — residence status codes such as E-7 or D-10, HiKorea, ARC, phone numbers, passport numbers, and dates in numerals. Do not transliterate them into Arabic script and do not reorder their characters.",
      ].join(" ");
    default:
      return null;
  }
}

/**
 * Terminology the model must not improvise.
 *
 * Retrieved from the concept registry by deterministic matching over this
 * utterance and the recent turns — only what the conversation is actually
 * using, never the whole registry. Administrative desks only.
 */
const TERMINOLOGY_PROFILES = new Set<CounterProfileId>(["immigration", "refugee", "judicial", "public-office"]);

function relevantTerminology(input: CounterPromptInput): string[] {
  if (!TERMINOLOGY_PROFILES.has(input.profileId ?? "general")) return [];
  return promptTerminology({
    text: input.text,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    recent: input.recent,
  });
}

/**
 * Values that must come out the other side byte-identical.
 *
 * Naming them explicitly is far more reliable than hoping a general
 * instruction covers the one token that matters, and it is exactly the set the
 * integrity check will complain about afterwards if it changed.
 */
function verbatimTokens(text: string): string[] {
  // The boundary is "not adjacent to more Latin text", not "not adjacent to a
  // letter". Korean attaches particles directly to a Latin token — D-2에서,
  // ARC를 — and a Unicode letter boundary rejects exactly the sentences this
  // is for, which is how these tokens went unnamed in Korean prompts.
  const bounded = (token: string) =>
    new RegExp(`(?<![A-Za-z0-9])${token}(?![A-Za-z0-9])`, "iu");
  const tokens = new Set<string>();
  for (const code of RESIDENCE_STATUS_CODES) {
    if (bounded(code).test(text)) tokens.add(code);
  }
  for (const term of ["HiKorea", "ARC", "1345"]) {
    if (bounded(term).test(text)) tokens.add(term);
  }
  return [...tokens];
}

/** How this turn should read, given who is speaking. */
function registerGuidance(from: "host" | "guest" | undefined): string | null {
  if (from === "host") {
    return "SPEAKER IS THE STAFF MEMBER: This is official guidance a visitor will act on. Translate it short, plain and administratively exact. Do not make it chatty, reassuring, or idiomatic, and do not soften a requirement into a suggestion. Keep procedure names precise rather than colloquial.";
  }
  if (from === "guest") {
    return "SPEAKER IS THE VISITOR: They may be using a second language imperfectly. Translate what they actually said, tidying grammar only where it does not change meaning. Do not complete their account, do not add a consequence they did not state, and do not make them sound more or less certain than they were.";
  }
  return null;
}

function sourceVoiceGuidance(sourceLang: string): string | null {
  switch (sourceLang.toLowerCase()) {
    case "zh-cn":
      return "MANDARIN ASR: Spoken Mandarin may contain homophone substitutions or missing word boundaries. Repair only when one reading is strongly supported by grammar and recent turns. Preserve names, numbers, dates, document names, visa/status codes, and addresses exactly as recognized when uncertain; lower confidence instead of guessing.";
    case "zh-tw":
      return "TAIWAN MANDARIN ASR: Spoken Mandarin may contain homophone substitutions, mixed Simplified/Traditional characters, or missing boundaries. Normalize obvious script noise only when meaning is unchanged. Never guess a name, number, date, document, status code, or address.";
    case "vi-vn":
      return "VIETNAMESE ASR: Be alert to missing tone distinctions and short function-word errors. Repair only obvious grammatical artifacts; do not guess names, numbers, dates, or document terms.";
    case "th-th":
      return "THAI ASR: Word boundaries may be absent or inconsistent. Re-segment obvious phrases for understanding, but do not alter factual values or proper nouns.";
    case "ar-sa":
      return "ARABIC ASR: Dialectal speech may be rendered imperfectly in standard spelling. Translate the intended utterance only when strongly supported; preserve uncertain names and factual values and lower confidence.";
    case "mn-mn":
    case "uz-uz":
    case "ne-np":
    case "km-kh":
    case "my-mm":
      return "LOWER-RESOURCE ASR: Treat odd tokens as possible recognition errors, but repair only when grammar and recent context make the intended reading clear. Never silently guess names, numbers, dates, documents, or identifiers.";
    default:
      return null;
  }
}

export function buildCounterPrompt(input: CounterPromptInput): string {
  const source = languageName(input.sourceLang);
  const target = languageName(input.targetLang);
  const lines: string[] = [];
  const profile = findCounterProfile(input.profileId);

  if (profile.id !== "general") {
    lines.push(
      `COUNTER PROFILE: ${profile.setting}. This is vocabulary context only. Translate what the people say; do not add legal, medical, eligibility, or procedural advice.`,
    );
    if (profile.terminology.length) {
      lines.push(`TERMINOLOGY HINTS: ${profile.terminology.join(", ")}`);
    }
  }

  if (input.deskLabel) lines.push(`SETTING: ${input.deskLabel}`);

  if (input.recent?.length) {
    lines.push(
      `RECENT TURNS (context only — do NOT translate these):\n${input.recent
        .slice(-6)
        .map((turn) => {
          const role = turn.from === "host" ? "STAFF" : "VISITOR";
          const lang = turn.lang ? ` [${languageName(turn.lang)}]` : "";
          return `  ${role}${lang}: ${turn.text}`;
        })
        .join("\n")}`,
    );
  }

  // Stated as an explicit pair rather than left to detection. Uyghur, Uzbek
  // and Arabic are mutually confusable to a detector — two share a script, two
  // share a family — and a detector that guesses wrong produces fluent text in
  // a language the visitor does not read.
  lines.push(
    `TRANSLATE FROM ${source} (${input.sourceLang}) INTO ${target} (${input.targetLang}). Do not auto-detect the language; use this pair.`,
  );

  const register = registerGuidance(input.from);
  if (register) lines.push(register);

  lines.push(...relevantTerminology(input));

  if (!hasVerifiedGlossary(input.targetLang)) {
    lines.push(
      "NO ESTABLISHED ADMINISTRATIVE VOCABULARY: This target language has no verified published terminology for Korean immigration procedures. Translate the concept plainly, keep the Latin code or acronym (E-7, ARC, HiKorea) visible alongside it, and use the same wording for the same concept for the rest of this conversation. Do not present an improvised term as if it were the official one.",
    );
  }

  const verbatim = verbatimTokens(input.text);
  if (verbatim.length) {
    lines.push(
      `REPRODUCE VERBATIM, IN LATIN SCRIPT, UNCHANGED: ${verbatim.join(", ")}`,
    );
  }

  const targetGuidance = targetLanguageGuidance(input.targetLang);
  if (targetGuidance) lines.push(targetGuidance);

  if (input.inputMode === "voice") {
    lines.push(
      "SOURCE IS SPEECH-TO-TEXT: Silently fix only obvious spacing, punctuation, and token-boundary artifacts, including obvious segmentation errors. You may repair an ordinary word only when grammar plus recent context make the intended reading clear. Never silently repair uncertain names, numbers, dates, document names, visa/status codes, addresses, phone numbers, or identifiers. Do not guess them; when uncertain, preserve the source and lower confidence.",
    );
    const voiceGuidance = sourceVoiceGuidance(input.sourceLang);
    if (voiceGuidance) lines.push(voiceGuidance);
  } else {
    lines.push(
      "SOURCE IS TYPED TEXT: Treat the text as intentional even when brief, informal, unpunctuated, or code-switched. Preserve abbreviations, capitalization, punctuation, emoji, and code-like values when meaningful. Use recent turns to resolve obvious conversational ellipsis, but do not rewrite or correct factual content merely because it looks unusual.",
    );
  }

  if (input.action === "simplify" || input.rephrase) {
    lines.push(
      "SIMPLIFY: Say the SAME factual meaning with simpler vocabulary and shorter sentence structure. Preserve every number, date, time, amount, name, document, requirement, condition, and negation exactly.",
    );
  } else if (input.action === "retry") {
    lines.push(
      "RETRY: Produce a fresh translation of the original utterance. Preserve every number, date, time, amount, name, document, requirement, condition, and negation exactly. Do not add or simplify facts.",
    );
  }

  lines.push(`UTTERANCE:\n${input.text}`);
  lines.push("Return the JSON object now.");

  return lines.join("\n\n");
}

export const COUNTER_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    translation: { type: "string", description: "The translated utterance." },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    note: { type: "string", description: "Optional short note for the sender." },
  },
  required: ["translation", "confidence"],
  additionalProperties: false,
};
