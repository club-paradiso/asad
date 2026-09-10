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
  fast: "LAG: FAST (~1s). Emit early, short chunks. Anticipation is allowed.",
  balanced:
    "LAG: BALANCED (~2–3s). Emit complete thought units; anticipate only a clear mid-thought.",
  safe: "LAG: SAFE (~4–6s). No anticipation. Accuracy first.",
};

/**
 * What the engine knows about where it cut, said out loud.
 *
 * The stabiliser fires on a completed sentence when it can and on a clock when
 * it cannot, and the difference is the whole delayed-predicate problem: a
 * `sentence` unit is a thought the model may finish, while a `timeout` unit is
 * a thought the SPEAKER has not finished, where a fluent closing sentence is an
 * invention the interpreter has to talk over. The engine has always known
 * which it just did; until now it kept that to itself and the model had to
 * guess from the text.
 */
function boundarySteer(request: InterpretRequest): string | null {
  const lines: string[] = [];

  if (request.continuesPrevious) {
    lines.push(
      "CONTINUATION: continue the unfinished English scaffold from the previous turn. Do not restart or repeat delivered English.",
    );
  }

  if (request.boundary && request.boundary !== "sentence") {
    lines.push(
      "OPEN END: this unit is still mid-thought. Keep the English structurally open; do not invent missing payload. Mark dependent trailing chunks low.",
    );
  } else if (request.boundary === "sentence") {
    lines.push("CLOSED END: the speaker completed the thought; finish the English sentence.");
  }

  return lines.length ? lines.join("\n") : null;
}

export function buildLiveUserPrompt(request: InterpretRequest): string {
  const sections: string[] = [];

  const context = contextBlock(request.context);
  if (context) sections.push(context);

  const detected = request.detected;
  if (detected) {
    const hints: string[] = [];
    if (detected.scripture.length) {
      hints.push(
        `Scripture in play (already normalised — reuse these exact forms, do not re-derive).\n` +
          `Where verse text is given it is the real translation and you may render it; where it is absent, name the reference and do not recite it:\n${detected.scripture
            .map(
              (s) =>
                `  ${s.koreanRaw ? `${s.koreanRaw} → ` : ""}${s.display}${
                  s.text ? `\n    text (${s.translation ?? "supplied"}): ${s.text}` : ""
                }`,
            )
            .join("\n")}`,
      );
    }
    // Discourse markers are separated from terminology on purpose. Telling the
    // model that 그래서 means "so" is worthless; telling it that 결론적으로 is
    // on the table means the speaker is CLOSING, which settles the English
    // frame before the Korean predicate arrives.
    const terms = detected.glossary.filter((g) => !g.register);
    const markers = detected.glossary.filter((g) => g.register);

    if (terms.length) {
      hints.push(
        `Terms present in this segment:\n${terms
          .map((g) => `  ${g.korean} → ${g.english}${g.note ? ` (${g.note})` : ""}`)
          .join("\n")}`,
      );
    }
    if (markers.length) {
      hints.push(
        `Discourse markers present — they name the rhetorical move, so use them to choose the English frame, then compress them out of the output:\n${markers
          .map((g) => `  ${g.korean} (${g.english})`)
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

  const boundary = boundarySteer(request);
  if (boundary) sections.push(boundary);

  if (!request.allowAnticipation) {
    sections.push("Do not return anticipatedChunks for this turn.");
  }

  sections.push("Return the JSON object now.");
  return sections.join("\n\n");
}
