/** Counter translation prompt: one face-to-face utterance in, one faithful utterance out. */
import { languageName } from "./languages";
import {
  IMMIGRATION_GLOSSARY,
  RESIDENCE_STATUS_CODES,
  hasVerifiedGlossary,
  type GlossaryEntry,
} from "./domain-vocabulary";
import { findCounterProfile, type CounterProfileId } from "./profiles";
// Per-language writing and recogniser lines are shared with the Live prompt.
import { sourceVoiceGuidance, targetLanguageGuidance } from "@/languages/writing-guidance";

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

/**
 * Terminology the model must not improvise.
 *
 * Only the entries the conversation is actually using are sent. A twenty-line
 * glossary on every turn costs latency for nothing when the turn is "one
 * moment please", and the point is consistency within a conversation, not
 * teaching the model a dictionary.
 */
function relevantGlossary(input: CounterPromptInput): GlossaryEntry[] {
  if (input.profileId !== "immigration") return [];
  const pair = [input.sourceLang, input.targetLang].map((tag) =>
    tag.split("-")[0].toLowerCase(),
  );
  if (!pair.includes("ko") && !pair.includes("en")) return [];

  const haystack = [input.text, ...(input.recent ?? []).map((turn) => turn.text)]
    .join(" ")
    .toLowerCase();
  return IMMIGRATION_GLOSSARY.filter(
    (entry) => haystack.includes(entry.ko.toLowerCase()) || haystack.includes(entry.en.toLowerCase()),
  ).slice(0, 8);
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

  const glossary = relevantGlossary(input);
  if (glossary.length) {
    lines.push(
      `ADMINISTRATIVE TERMS IN USE (keep these renderings consistent for the whole conversation):\n${glossary
        .map((entry) => `  ${entry.ko} = ${entry.en}`)
        .join("\n")}`,
    );
  }

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
