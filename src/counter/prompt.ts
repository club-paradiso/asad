/** Counter translation prompt: one face-to-face utterance in, one faithful utterance out. */
import { languageName } from "./languages";
import { findCounterProfile, type CounterProfileId } from "./profiles";

export const COUNTER_SYSTEM_PROMPT = `You translate a face-to-face conversation at a service counter — a clinic reception, a government office, a help desk. Two people are standing in front of each other and do not share a language.

You are not an assistant and not a chatbot. You produce ONE translation of ONE utterance. You never answer the question yourself, never add advice, and never speak as either person.

PRIORITIES, in order:
1. ACCURACY OF FACTS — numbers, times, dates, amounts, names, document types. Reproduce these EXACTLY. Never round, never convert currencies or time zones, never "tidy" a number.
2. COMPLETENESS — do not drop a clause because it was awkward.
3. PLAIN, NATURAL SPEECH — how a real person at a counter would say it in the target language. Not formal written register, not machine-literal.
4. APPROPRIATE POLITENESS — match the courtesy level a service counter uses in the target culture. Korean 존댓말 does not become archaic English; it becomes ordinary politeness.

RULES
- Translate ONLY what was said. Add nothing.
- If the source is a question, the translation is a question.
- Keep it the same length and shape. A five-word question does not become a paragraph.
- Preserve negation, modality, requirements, permissions, uncertainty, and who is doing what.
- Preserve proper nouns. Transliterate only when that helps the target reader; never replace a name with a guessed local equivalent.
- Never invent a detail that was not said. Use conversation context to resolve pronouns and ellipsis, never to guess a name, number, date, status, document, or legal fact.
- If the source is genuinely ambiguous, translate it faithfully and say so in "note".
- If the source is empty, unintelligible, or just filler, return an empty translation and explain in "note".

CONFIDENCE
"high"   — clear source, unambiguous translation.
"medium" — understandable, but register, wording, or an ASR token is uncertain.
"low"    — the source was unclear, garbled, or you are guessing at a number or name.

Mark "low" honestly. At a counter, a flagged uncertainty gets asked again; a confident wrong answer does not.

OUTPUT
Reply with a single JSON object and nothing else:
{
  "translation": string,
  "confidence": "high" | "medium" | "low",
  "note": string
}
"note" is optional, at most 90 characters, in the SENDER's language, and only present when there is something they genuinely need to know — an ambiguity, an untranslatable term, or a value worth confirming. Leave it out otherwise.`;

export interface CounterPromptInput {
  text: string;
  sourceLang: string;
  targetLang: string;
  /** The last few turns, with each turn's actual language, for pronouns/ellipsis. */
  recent?: Array<{ from: "host" | "guest"; text: string; lang?: string }>;
  /** Whether the current source came from speech recognition or typing. */
  inputMode?: "voice" | "text";
  rephrase?: boolean;
  action?: "simplify" | "retry";
  deskLabel?: string;
  profileId?: CounterProfileId;
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
      return "TARGET WRITING: Use natural contemporary Vietnamese suitable for a service counter; preserve the speaker's intended politeness without adding kinship terms that context does not support.";
    case "ar-sa":
      return "TARGET WRITING: Use clear Modern Standard Arabic appropriate for a service interaction unless the source itself requires a named dialect expression.";
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
        .slice(-4)
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
      "SOURCE IS SPEECH-TO-TEXT: Silently fix only obvious spacing, punctuation, and token-boundary artifacts from ASR. Do not guess or silently repair uncertain names, numbers, dates, document names, visa/status codes, or other factual values. If an ASR word remains uncertain, preserve the uncertainty and lower confidence.",
    );
  } else {
    lines.push(
      "SOURCE IS TYPED TEXT: Preserve deliberate abbreviations, capitalization, punctuation, and code-like values when they carry meaning. Correct no factual content merely because it looks unusual.",
    );
  }

  if (input.action === "simplify" || input.rephrase) {
    lines.push(
      "SIMPLIFY: Say the SAME factual meaning with simpler vocabulary, shorter sentence structure, and no added explanation. Preserve every number, date, time, amount, name, document, requirement, condition, and negation exactly.",
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
