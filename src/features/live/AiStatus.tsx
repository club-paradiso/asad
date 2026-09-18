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
import { RECOVERY_PROVIDER } from "@/providers/llm/recovery-id";
export type AiState = "live" | "recovered" | "degraded" | "local" | "connecting";

/** Derive the AI state from what the last interpretation turn reported. */
export function aiStateFrom(input: {
  llmHealth: "ok" | "degraded" | "down";
  lastProvider?: string;
  started: boolean;
}): AiState {
  if (!input.started) return "connecting";
  if (input.lastProvider === "local") return "local";
  // A recovery route IS a real cloud translation, so this is not the same
  // warning as "rule-based". It is worth one line anyway, and only one: a
  // different model chose the wording, so a term settled ten minutes ago may
  // come back differently, and the interpreter is the only one who can catch
  // that. Naming it is the difference between a drift they expected and a
  // drift that makes them doubt their own glossary.
  if (input.lastProvider === RECOVERY_PROVIDER) return "recovered";
  if (input.llmHealth !== "ok") return "degraded";
  return "live";
}
