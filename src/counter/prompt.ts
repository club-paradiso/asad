/**
 * Counter translation prompt.
 *
 * A different job from the sermon prompt, and the differences matter:
 *
 *  - **Bidirectional, arbitrary language pair.** Not Korean→English.
 *  - **Turn-taking, not simultaneous.** No chunking, no anticipation, no
 *    scaffolds — one utterance in, one out.
 *  - **The reader is not an interpreter.** They are a member of the public who
 *    will act on what they read. So this must be plain, complete, and never
 *    hedged into ambiguity.
 *  - **Numbers and names are the whole ballgame.** A wrong time or price is the
 *    failure that actually costs someone something.
 */
import { languageName } from "./languages";

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
- Preserve proper nouns; transliterate them into the target script when the target does not use Latin script, and keep the original in parentheses when it is a name the other party may need to write down.
- Never invent a detail that was not said. If the source is genuinely ambiguous, translate it faithfully and say so in "note".
- If the source is empty, unintelligible, or just filler, return an empty translation and explain in "note".

CONFIDENCE
"high"   — clear source, unambiguous translation.
"medium" — understandable, but register or a word choice is uncertain.
"low"    — the source was unclear, garbled, or you are guessing at a number or name.

Mark "low" honestly. At a counter, a flagged uncertainty gets asked again; a confident wrong answer does not.

OUTPUT
Reply with a single JSON object and nothing else:
{
  "translation": string,
  "confidence": "high" | "medium" | "low",
  "note": string
}
"note" is optional, at most 90 characters, in the SENDER's language, and only
present when there is something they genuinely need to know — an ambiguity, an
untranslatable term, or a value worth confirming. Leave it out otherwise.`;

export interface CounterPromptInput {
  text: string;
  sourceLang: string;
  targetLang: string;
  /** The last few turns, so pronouns and ellipsis resolve. */
  recent?: Array<{ from: "host" | "guest"; text: string }>;
  /** Ask for a different wording than last time. */
  rephrase?: boolean;
  /** Where the counter is, e.g. "병원 접수" — sharpens vocabulary choice. */
  deskLabel?: string;
}

export function buildCounterPrompt(input: CounterPromptInput): string {
  const source = languageName(input.sourceLang);
  const target = languageName(input.targetLang);
  const lines: string[] = [];

  if (input.deskLabel) {
    lines.push(`SETTING: ${input.deskLabel}`);
  }

  if (input.recent?.length) {
    // Short context only. A counter exchange is not a document, and a long
    // history invites the model to answer rather than translate.
    lines.push(
      `RECENT TURNS (context only — do NOT translate these):\n${input.recent
        .slice(-4)
        .map((turn) => `  ${turn.from === "host" ? "STAFF" : "VISITOR"}: ${turn.text}`)
        .join("\n")}`,
    );
  }

  lines.push(`TRANSLATE FROM ${source} INTO ${target}.`);

  if (input.rephrase) {
    lines.push(
      "The previous translation did not land. Say the SAME thing a different way: simpler words, shorter sentence, more concrete. Do not change the meaning or any number.",
    );
  }

  lines.push(`UTTERANCE:\n${input.text}`);
  lines.push("Return the JSON object now.");

  return lines.join("\n\n");
}

/** JSON Schema for providers that enforce one natively. */
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
