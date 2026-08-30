import type { InterpretRequest } from "@/lib/schema";
import { contextBlock } from "./shared";

/**
 * Input for a Rescue turn.
 *
 * It deliberately reuses the same bounded rolling context shape as normal live
 * interpretation, but the Korean payload is a recent *window*, not a new
 * stabiliser drain. The caller must keep it short via `rescueKoreanText`.
 */
export interface RescuePromptInput {
  mode: InterpretRequest["mode"];
  recentKorean: string;
  context: InterpretRequest["context"];
}

/**
 * Build the user prompt for the emergency catch-up action.
 *
 * Rescue is NOT "translate the last twelve seconds". The interpreter has
 * already spoken some unknown portion of that window and needs the smallest
 * safe bridge into the speaker's current resolved idea. The normal structured
 * InterpreterOutput is still useful, but anticipated chunks are forbidden.
 */
export function buildRescueUserPrompt(input: RescuePromptInput): string {
  const korean = input.recentKorean.trim();
  if (!korean) return "";

  const sections: string[] = [];
  const context = contextBlock(input.context);
  if (context) sections.push(context);

  sections.push(`RESCUE MODE — HUMAN INTERPRETER HAS FALLEN BEHIND
The text below is a short RECENT WINDOW, not a fresh sentence to translate in full.
Your job is to help the interpreter resume speaking NOW.

Return only the minimum safe English bridge into the LATEST resolved idea:
- normally 1 safeChunk; at most 2;
- each chunk must be immediately sayable aloud;
- prefer the newest meaningful point over completeness;
- do NOT summarise the whole window;
- do NOT repeat English already delivered in context;
- do NOT backfill examples, padding or earlier clauses merely because they appear below;
- do NOT invent missing names, numbers, quotations or Scripture wording;
- return NO anticipatedChunks;
- if there is no safe current idea, return an empty safeChunks array with low confidence.`);

  sections.push(`RECENT KOREAN WINDOW (oldest → newest):\n${korean}`);

  if (input.mode === "sermon") {
    sections.push(
      "SERMON RESCUE: preserve theological precision and an explicitly detected Scripture reference, but never recite verse wording that was not supplied.",
    );
  }

  sections.push("Return the normal InterpreterOutput JSON object now. Nothing else.");
  return sections.join("\n\n");
}
