/**
 * Assembly of the per-turn live interpretation prompt.
 *
 * The system prompt is mode-dependent and constant across a session, so it
 * caches well. Only this user turn changes, and it is kept deliberately small
 * — the rolling context has already been compressed before it gets here.
 */
import type { InterpretRequest } from "@/lib/schema";
import { generalSystemPrompt } from "./general";
import { sermonSystemPrompt } from "./sermon";
import { contextBlock } from "./shared";

/**
 * The system prompt for a live turn.
 *
 * `schemaEnforced` drops the prose restatement of the JSON shape when the
 * provider is validating against `INTERPRETER_JSON_SCHEMA` itself. Measured at
 * ~230 tokens saved per call — which matters at eleven calls a minute for
 * forty-five minutes.
 */
export const systemPromptFor = (
  mode: "sermon" | "general",
  options: { schemaEnforced?: boolean } = {},
): string =>
  mode === "sermon"
    ? sermonSystemPrompt(options.schemaEnforced ?? false)
    : generalSystemPrompt(options.schemaEnforced ?? false);

/** Per-lag steer, appended to the user turn. */
const LAG_STEER: Record<InterpretRequest["lag"], string> = {
  fast: "LAG: FAST (~1s). Emit early and short. Prediction is welcome; the interpreter accepts correction risk.",
  balanced:
    "LAG: BALANCED (~2–3s). Emit complete thought units. Predict only when the Korean is clearly mid-thought.",
  safe: "LAG: SAFE (~4–6s). Wait for the thought to resolve. Do not predict at all. Accuracy over speed.",
};

export function buildLiveUserPrompt(request: InterpretRequest): string {
  const sections: string[] = [];

  const context = contextBlock(request.context);
  if (context) sections.push(context);

  const detected = request.detected;
  if (detected) {
    const hints: string[] = [];
    if (detected.scripture.length) {
      hints.push(
        `Scripture detected locally (already normalised — reuse exactly, do not re-derive):\n${detected.scripture
          .map((s) => `  ${s.koreanRaw ?? ""} → ${s.display}${s.text ? `\n    text (${s.translation}): ${s.text}` : ""}`)
          .join("\n")}`,
      );
    }
    if (detected.glossary.length) {
      hints.push(
        `Terms present in this segment:\n${detected.glossary
          .map((g) => `  ${g.korean} → ${g.english}${g.note ? ` (${g.note})` : ""}`)
          .join("\n")}`,
      );
    }
    if (detected.culturalNotes.length) {
      hints.push(
        `Cultural/wordplay signals detected locally — act on these:\n${detected.culturalNotes
          .map((c) => `  [${c.kind}] ${c.korean}: ${c.note}${c.suggestion ? ` → suggested: "${c.suggestion}"` : ""}`)
          .join("\n")}`,
      );
    }
    if (hints.length) sections.push(`LOCAL DETECTION\n${hints.join("\n\n")}`);
  }

  sections.push(`KOREAN TO INTERPRET NOW (stabilised):\n${request.pending}`);

  if (request.partial?.trim()) {
    sections.push(
      `UNRESOLVED TAIL (still being recognised — use ONLY for anticipation, never interpret it as confirmed):\n${request.partial.trim()}`,
    );
  }

  sections.push(LAG_STEER[request.lag]);

  if (!request.allowAnticipation) {
    sections.push("Do not return anticipatedChunks for this turn.");
  }

  sections.push("Return the JSON object now.");
  return sections.join("\n\n");
}
