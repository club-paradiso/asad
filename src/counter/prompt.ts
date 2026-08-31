/** Counter translation prompt: one face-to-face utterance in, one faithful utterance out. */
import { languageName } from "./languages";
import { findCounterProfile, type CounterProfileId } from "./profiles";

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
}

function targetLanguageGuidance(targetLang: string): string | null {
  switch (targetLang.toLowerCase()) {
    case "zh-cn":
      return "TARGET WRITING: Use natural Mainland Mandarin in Simplified Chinese. Do not output pinyin or Traditional Chinese unless the source explicitly contains it.";
    case "zh-tw":
      return "TARGET WRITING: Use natural Taiwan Mandarin in Traditional Chinese. Do not output pinyin or Simplified-only wording unless the source explicitly contains it.";
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
    default:
      return null;
  }
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

  lines.push(`TRANSLATE FROM ${source} INTO ${target}.`);

  const targetGuidance = targetLanguageGuidance(input.targetLang);
  if (targetGuidance) lines.push(targetGuidance);

  if (input.inputMode === "voice") {
    lines.push(
      "SOURCE IS SPEECH-TO-TEXT: Silently fix only obvious spacing, punctuation, segmentation, and token-boundary artifacts. You may repair an ordinary word only when grammar plus recent context make the intended reading clear. Never silently repair uncertain names, numbers, dates, document names, visa/status codes, addresses, phone numbers, or identifiers. When uncertain, preserve the source and lower confidence.",
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
