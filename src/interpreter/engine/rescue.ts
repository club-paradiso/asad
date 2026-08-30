import type { TranscriptSegment } from "@/types";

/** How far back Rescue is allowed to look by default. */
export const RESCUE_WINDOW_MS = 12_000;

/**
 * Hard ceiling on Korean copied into a rescue request.
 *
 * Rescue is for catching up, not for asking the model to summarise a miniature
 * sermon. A character cap also keeps an unusually fast speaker from turning a
 * single rescue tap into a large, slow inference request.
 */
export const RESCUE_MAX_CHARS = 1_200;

export interface RescueWindowOptions {
  windowMs?: number;
  maxChars?: number;
}

/**
 * Select the newest stable Korean that is still temporally relevant.
 *
 * Segment timestamps are milliseconds since session start, the same timeline
 * used by the interpretation engine. We intentionally do NOT fall back to an
 * old segment when the recent window is empty: after a long pause, resurrecting
 * stale content is more dangerous than showing that Rescue has nothing current
 * to work with.
 */
export function selectRescueSegments(
  segments: TranscriptSegment[],
  nowMs: number,
  options: RescueWindowOptions = {},
): TranscriptSegment[] {
  const windowMs = Math.max(1_000, options.windowMs ?? RESCUE_WINDOW_MS);
  const maxChars = Math.max(80, options.maxChars ?? RESCUE_MAX_CHARS);
  const floor = Math.max(0, nowMs - windowMs);

  const recent = segments.filter(
    (segment) => segment.at >= floor && segment.at <= nowMs && segment.text.trim(),
  );

  if (recent.length === 0) return [];

  // Walk newest-first so the most recent resolved idea always survives the cap.
  const selected: TranscriptSegment[] = [];
  let chars = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const segment = recent[index];
    const text = segment.text.trim();
    const cost = text.length + (selected.length ? 1 : 0);
    if (selected.length > 0 && chars + cost > maxChars) break;

    // A single oversized latest segment is clipped later by `rescueKoreanText`;
    // keeping the segment here preserves its timestamp/id for diagnostics.
    selected.push(segment);
    chars += cost;
    if (chars >= maxChars) break;
  }

  return selected.reverse();
}

/** Plain Korean payload suitable for a rescue inference request. */
export function rescueKoreanText(
  segments: TranscriptSegment[],
  nowMs: number,
  options: RescueWindowOptions = {},
): string {
  const maxChars = Math.max(80, options.maxChars ?? RESCUE_MAX_CHARS);
  const text = selectRescueSegments(segments, nowMs, options)
    .map((segment) => segment.text.trim())
    .join(" ")
    .trim();

  // Preserve the newest text if clipping is necessary. The interpreter needs
  // the point to resume from, not the beginning of what they already missed.
  return text.length <= maxChars ? text : text.slice(-maxChars).trimStart();
}
