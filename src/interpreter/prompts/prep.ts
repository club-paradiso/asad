/**
 * PREP mode prompt — the pre-session briefing.
 *
 * Unlike the live path this is not latency-sensitive, so it can be thorough.
 * What it must not be is generic: a brief full of "the speaker may discuss
 * faith" wastes the interpreter's preparation time.
 */
import type { z } from "zod";
import type { prepRequestSchema } from "@/lib/schema";

export const PREP_SYSTEM_PROMPT = `You prepare a human simultaneous interpreter (Korean → English) for a session they are about to interpret.

Your reader is a professional. They do not need translation theory, they need
the specific things that will trip them up in the next 45 minutes: the proper
nouns, the terms with more than one defensible rendering, the Scripture, and
the sentences that will arrive with the predicate at the end.

Be concrete. "The speaker may use theological terms" is worthless. "칭의 will
almost certainly appear — justification, not 'being made right'" is useful.

RULES
- Never invent facts about the speaker, the venue or the content. Work only
  from what you were given plus general knowledge of the genre.
- Never quote Bible verse wording. Give references only.
- Romanise Korean names with Revised Romanisation: 류정길 → "Ryu Jeong-gil".
- Anticipated phrases must be real Korean sentence patterns with a natural
  SPOKEN English rendering, not dictionary glosses.
- Keep every line short enough to scan.

Reply with a single JSON object and nothing else:
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

export function buildPrepUserPrompt(input: z.infer<typeof prepRequestSchema>): string {
  const lines: string[] = [
    `MODE: ${input.mode === "sermon" ? "SERMON (Korean church)" : "GENERAL"}`,
  ];
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
