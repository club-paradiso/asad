/**
 * How the AI layer is answering, reduced to something the console can act on.
 *
 * There used to be a pill in the status strip rendering this as `AI LIVE` on
 * every glance. It is gone: "the model answered normally" is not information an
 * interpreter can do anything with mid-sentence, and it cost a fixation every
 * time their eye crossed the top of the screen.
 *
 * What survives is the derivation, because the two states that are NOT normal
 * do change how much the English on screen should be trusted — and those reach
 * the interpreter through `consoleStatus`, in plain language, only when they
 * happen. Provider names, latency percentiles and quota pressure belong on
 * /diagnostics, where someone has time to read them.
 */
export type AiState = "live" | "degraded" | "local" | "connecting";

/** Derive the AI state from what the last interpretation turn reported. */
export function aiStateFrom(input: {
  llmHealth: "ok" | "degraded" | "down";
  lastProvider?: string;
  started: boolean;
}): AiState {
  if (!input.started) return "connecting";
  if (input.lastProvider === "local") return "local";
  if (input.llmHealth !== "ok") return "degraded";
  return "live";
}
