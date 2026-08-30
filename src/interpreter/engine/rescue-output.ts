import type { ParsedInterpreterOutput } from "@/lib/schema";

/**
 * Rescue is intentionally narrower than ordinary live interpretation.
 *
 * Even a provider that ignores the prompt cannot turn Rescue into a second
 * timeline: predictions are stripped and at most two sayable safe chunks are
 * allowed through. Other context aids can remain useful to the operator.
 */
export function sanitizeRescueOutput(
  output: ParsedInterpreterOutput,
): ParsedInterpreterOutput {
  const { anticipatedChunks: _anticipated, ...rest } = output;
  return {
    ...rest,
    safeChunks: output.safeChunks.slice(0, 2),
  };
}

/** Safe response when no Rescue-capable cloud model is available. */
export const emptyRescueOutput = (): ParsedInterpreterOutput => ({
  safeChunks: [],
  confidence: "low",
});
