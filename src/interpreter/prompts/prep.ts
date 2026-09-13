/**
 * PREP prompt — the pre-session briefing.
 *
 * Unlike the live path this is not latency-sensitive, so it can be thorough.
 * What it must not be is generic: a brief full of "the speaker may discuss
 * faith" wastes the interpreter's preparation time.
 */
import type { z } from "zod";
import type { prepRequestSchema } from "@/lib/schema";
import { layerForDomain, type ContextDomain, type LanguagePair } from "@/types";
import { DEFAULT_LANGUAGE_PAIR, type LanguagePairIds } from "@/languages/registry";
import { pairNames } from "./shared";

/**
 * The prep request as the route parses it, plus what the Live console knows
 * and the wire schema does not yet carry: the session's languages and the
 * Context Engine's domain. Both optional; the defaults are the original
 * Korean → English contract keyed by `mode`.
 */
export type PrepPromptInput = z.infer<typeof prepRequestSchema> & {
  languagePair?: LanguagePair | Partial<LanguagePairIds>;
  /** The session's context. `auto` (nothing inferred yet) defers to `mode`, as does omission. */
  domain?: ContextDomain;
};

/** The prompt layer a prep input asks for: the domain's layer when one is resolved, else the wire `mode`. */
export const prepLayer = (input: Pick<PrepPromptInput, "mode" | "domain">): "sermon" | "general" =>
  input.domain && input.domain !== "auto" ? layerForDomain(input.domain) : input.mode;

export function prepSystemPrompt(pair: Partial<LanguagePairIds> | undefined = DEFAULT_LANGUAGE_PAIR): string {
  const names = pairNames(pair);
  const predicate = names.koreanSource
    ? "the sentences that will arrive with the predicate at the end."
    : "the sentence shapes that will force you to wait before you can start.";
  const example = names.koreanSource
    ? `"칭의 will\nalmost certainly appear — justification, not 'being made right'" is useful.`
    : `"the term for justification will almost certainly appear — keep it technical" is useful.`;
  const romanise = names.koreanSource && names.latinTarget
    ? `- Romanise Korean names with Revised Romanisation: 류정길 → "Ryu Jeong-gil".`
    : `- Give each name the ${names.target} form the interpreter should say, and only one.`;
  // The wire keys are named for the original pair; say what they mean when it is another.
  const fieldNote = names.koreanSource && names.englishTarget
    ? ""
    : ` ("korean" fields hold the ${names.source} form, "english" fields the ${names.target} form)`;
  return `You prepare a human simultaneous interpreter (${names.source} → ${names.target}) for a session they are about to interpret.

Your reader is a professional. They do not need translation theory, they need
the specific things that will trip them up in the next 45 minutes: the proper
nouns, the terms with more than one defensible rendering, the Scripture, and
${predicate}

Be concrete. "The speaker may use theological terms" is worthless. ${example}

RULES
- Never invent facts about the speaker, the venue or the content. Work only
  from what you were given plus general knowledge of the genre.
- Never quote Bible verse wording. Give references only.
${romanise}
- Anticipated phrases must be real ${names.source} sentence patterns with a natural
  SPOKEN ${names.target} rendering, not dictionary glosses.
- Keep every line short enough to scan.

Reply with a single JSON object and nothing else${fieldNote}:
{
  "overview": string,
  "likelyStructure": string[],
  "keyTerms": [{ "korean": string, "english": string, "note"?: string, "alternatives"?: string[] }],
  "scripture": [{ "book": string, "chapter": number, "verse"?: number, "display": string, "confidence": "high"|"medium"|"low" }],
  "properNouns": [{ "korean": string, "english": string, "kind": "person"|"place"|"organisation"|"work"|"other", "note"?: string }],
  "difficultPoints": string[],
  "anticipatedPhrases": [{ "korean": string, "english": string }],
  "pronunciation": [{ "korean": string, "english": string }]
}`;
}

/** The Korean → English prep prompt, as the prep route sends it. */
export const PREP_SYSTEM_PROMPT = prepSystemPrompt(DEFAULT_LANGUAGE_PAIR);

export function buildPrepUserPrompt(input: PrepPromptInput): string {
  const layer = prepLayer(input);
  const names = pairNames(input.languagePair ?? DEFAULT_LANGUAGE_PAIR);
  const lines: string[] = [
    `MODE: ${layer === "sermon" ? (names.koreanSource ? "SERMON (Korean church)" : "SERMON (church service)") : "GENERAL"}`,
  ];
  if (input.domain && input.domain !== "generic" && input.domain !== "auto") {
    lines.push(`SETTING: ${input.domain}`);
  }
  if (input.languagePair) lines.push(`LANGUAGES: ${names.source} → ${names.target}`);
  if (input.speaker) lines.push(`SPEAKER: ${input.speaker}`);
  if (input.organisation) lines.push(`VENUE: ${input.organisation}`);
  if (input.title) lines.push(`TITLE: ${input.title}`);
  if (input.scripture) lines.push(`MAIN PASSAGE: ${input.scripture}`);
  if (input.notes) lines.push(`NOTES FROM THE INTERPRETER:\n${input.notes}`);
  if (input.outline) lines.push(`PASTED OUTLINE / SCRIPT:\n${input.outline.slice(0, 16000)}`);

  lines.push(
    "",
    "Produce the briefing. If a field would only contain filler, return it empty rather than padding it.",
    "Return the JSON object now.",
  );
  return lines.join("\n");
}
