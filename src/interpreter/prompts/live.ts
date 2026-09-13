/**
 * Assembly of the per-turn live interpretation prompt.
 *
 * The system prompt depends on the layer and the language pair, both constant
 * across a session, so it caches well. Only this user turn changes, and it is
 * kept deliberately small — the rolling context has already been compressed
 * before it gets here.
 */
import type { InterpretRequest } from "@/lib/schema";
import type { ResolvedDomain } from "@/types";
import { DEFAULT_LANGUAGE_PAIR, type LanguagePairIds } from "@/languages/registry";
import { compactSystemPrompt } from "./compact";
import { generalSystemPrompt } from "./general";
import { sermonSystemPrompt } from "./sermon";
import { contextBlock, pairNames } from "./shared";

export interface SystemPromptOptions {
  /** Drop the prose restatement of the JSON shape when the provider validates against `INTERPRETER_JSON_SCHEMA` itself. */
  schemaEnforced?: boolean;
  /**
   * Deliberately explicit rather than inferred here. Context budgeting belongs
   * to the router; prompt assembly only renders the contract it was asked for.
   */
  ultraCompact?: boolean;
  /** Session languages. Defaults to Korean → English, the pair the contract was measured on. */
  pair?: Partial<LanguagePairIds>;
  /**
   * The Context Engine's domain. Accepted so a caller can hand the same options
   * to the system and user prompts, but NEVER rendered into the system prompt:
   * the domain drifts during a session and the system prompt must not, or the
   * provider's prompt cache misses on every drift. The user turn carries it —
   * see `buildLiveUserPrompt`.
   */
  domain?: ResolvedDomain;
}

/** The system prompt for a live turn. Constant for a given layer, pair and profile. */
export const systemPromptFor = (
  mode: "sermon" | "general",
  options: SystemPromptOptions = {},
): string => {
  const schemaEnforced = options.schemaEnforced ?? false;
  const pair = options.pair ?? DEFAULT_LANGUAGE_PAIR;
  if (options.ultraCompact) return compactSystemPrompt(mode, schemaEnforced, pair);
  return mode === "sermon"
    ? sermonSystemPrompt(schemaEnforced, pair)
    : generalSystemPrompt(schemaEnforced, pair);
};

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

/** The heading the pending source text sits under. `mock.ts` reads it back. */
export const pendingHeading = (pair: Partial<LanguagePairIds> | undefined): string =>
  `${pairNames(pair).SOURCE} TO INTERPRET NOW (stabilised):`;

export function buildLiveUserPrompt(request: InterpretRequest): string {
  const sections: string[] = [];
  const pair = request.languagePair ?? DEFAULT_LANGUAGE_PAIR;

  // One line, in the user turn rather than the system prompt, so a domain
  // drift mid-session costs nothing in cache. `generic` says nothing: the
  // layer already assumes nothing.
  if (request.domain && request.domain !== "generic") {
    sections.push(`SETTING: ${request.domain}`);
  }

  const context = contextBlock(request.context, pair);
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
    // The Repair Engine's unsettled doubts. The model is the last reader with
    // enough context to choose; it is still not allowed to invent a reading
    // that neither the recogniser nor the evidence produced.
    if (detected.hypotheses?.length) {
      hints.push(
        `RECOGNITION HYPOTHESES (the recogniser may have misheard; prefer the candidate ONLY if the context supports it, never invent a third reading):\n${detected.hypotheses
          .map((h) => `  ${h.heard} → ${h.candidate} (${h.reason})`)
          .join("\n")}`,
      );
    }
    // Translation Memory. These were validated — by the interpreter, the prep
    // sheet or repeated agreement — so the model reuses rather than re-decides.
    if (detected.memory?.length) {
      hints.push(
        `REMEMBERED RENDERINGS (validated earlier; reuse exactly when the same phrase recurs):\n${detected.memory
          .map((m) => `  ${m.source} → ${m.target}`)
          .join("\n")}`,
      );
    }
    if (hints.length) sections.push(`LOCAL DETECTION\n${hints.join("\n\n")}`);
  }

  sections.push(`${pendingHeading(pair)}\n${request.pending}`);

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
