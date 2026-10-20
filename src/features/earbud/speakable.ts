import type { InterpretationChunk } from "@/types";

/**
 * A spoken sentence cannot be retracted. Only an engine-committed, non-provisional
 * translation may be voiced; guesses, low-confidence items and retrospective
 * edits stay on screen for human verification.
 */
export function unspokenCommitted(
  chunks: readonly InterpretationChunk[],
  seen: ReadonlySet<string>,
): InterpretationChunk[] {
  return chunks.filter(
    (chunk) =>
      chunk.state === "committed" &&
      !chunk.provisional &&
      chunk.confidence !== "low" &&
      !chunk.correctsChunkId &&
      chunk.text.trim().length > 0 &&
      !seen.has(chunk.id),
  );
}

/**
 * Bounded audio backlog: a translation spoken far after its source is dangerous
 * at a service counter. Once overloaded, discard pending audio, never silently
 * play minutes of old advice.
 */
export const MAX_EARBUD_AUDIO_BACKLOG = 3;
