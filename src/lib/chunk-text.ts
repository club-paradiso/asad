/**
 * Splitting produced text into console-sized chunks.
 *
 * Lives here rather than beside the on-device translator because two callers
 * now need the same rule and neither should own it: the Chrome Translator
 * fallback, which returns one long string, and the engine's pass-through lane,
 * which renders a target-language utterance without translating it. Both have
 * to land inside `chunkDraftSchema`'s limits, and one splitter is better than
 * two that drift.
 */

/** `chunkDraftSchema.text` allows 400 characters; stay under it with margin. */
export const MAX_CHUNK_CHARS = 380;
/** `interpreterOutputSchema.safeChunks` allows eight. */
export const MAX_CHUNKS = 8;

/**
 * Break text on sentence boundaries, then on the last space or comma before the
 * limit, so a chunk is never cut mid-word.
 *
 * Normal live units are far shorter than the limit; the defensive splitting
 * exists so a long final flush cannot turn an otherwise good result into a
 * schema-invalid one.
 */
export function chunkTranslation(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks: string[] = [];

  for (const sentence of sentences) {
    let rest = sentence.trim();
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars + 1);
      const splitAt = Math.max(window.lastIndexOf(" "), window.lastIndexOf(","));
      const at = splitAt >= Math.floor(maxChars * 0.55) ? splitAt : maxChars;
      chunks.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) chunks.push(rest);
  }

  // Keep the latest material rather than manufacturing an invalid ninth chunk.
  if (chunks.length <= MAX_CHUNKS) return chunks;
  return [
    ...chunks.slice(0, MAX_CHUNKS - 1),
    chunks.slice(MAX_CHUNKS - 1).join(" ").slice(0, maxChars).trim(),
  ].filter(Boolean);
}
