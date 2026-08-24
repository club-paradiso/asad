/**
 * Rhetorical compression helpers.
 *
 * Korean sermon language carries a lot of discourse padding that costs the
 * interpreter breath and the listener attention. This module identifies it —
 * but only *flags* it. Repetition in a sermon is often deliberate rhetoric, so
 * the decision to compress belongs to the model prompt and ultimately to the
 * human, never to a regex.
 */

/** Discourse fillers that usually carry no propositional content. */
export const FILLERS = [
  "여러분",
  "우리가",
  "정말",
  "사실",
  "사실은",
  "다시 한번",
  "어떻게 보면",
  "뭐랄까",
  "그러니까",
  "아시다시피",
  "제가 말씀드리고 싶은 것은",
  "제가 여러분에게 드리고 싶은 말씀은",
];

/** Long-winded frames with a short, natural spoken English equivalent. */
export const FRAME_SHORTCUTS: Array<{ korean: RegExp; english: string }> = [
  { korean: /제가\s*(?:여러분(?:에게|께))?\s*(?:다시\s*한번)?\s*꼭?\s*말씀드리고\s*싶은\s*것은/, english: "Let me emphasise this:" },
  { korean: /제가\s*오늘\s*여러분과\s*함께\s*나누고\s*싶은\s*것은/, english: "Today, I'd like to talk with you about" },
  { korean: /우리가\s*오늘\s*함께\s*살펴볼\s*말씀은/, english: "Today we're going to look at" },
  { korean: /제가\s*강조하고\s*싶은\s*것은/, english: "What I want to stress is" },
  { korean: /결론적으로\s*말씀드리면/, english: "To sum up:" },
  { korean: /한\s*가지만\s*기억하시면/, english: "If you remember one thing:" },
];

/** Rough measure of how much of a segment is discourse padding, 0–1. */
export function fillerRatio(text: string): number {
  if (!text.trim()) return 0;
  const total = text.replace(/\s/g, "").length;
  if (total === 0) return 0;
  let filled = 0;
  for (const filler of FILLERS) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(filler, from);
      if (at === -1) break;
      filled += filler.replace(/\s/g, "").length;
      from = at + filler.length;
    }
  }
  return Math.min(1, filled / total);
}

/**
 * True when a segment is padded enough that the model should be told to
 * compress rather than mirror it.
 */
export const isPadded = (text: string): boolean => fillerRatio(text) > 0.22;

/** A ready English frame for a recognised long-winded Korean opener. */
export function frameShortcut(text: string): string | null {
  for (const { korean, english } of FRAME_SHORTCUTS) {
    if (korean.test(text)) return english;
  }
  return null;
}

/**
 * True when repetition looks intentional (the same phrase three or more times
 * in a short window) and must therefore be preserved, not compressed.
 */
export function hasIntentionalRepetition(texts: string[]): boolean {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const phrase of text.split(/[.,!?。，、\s]+/)) {
      const key = phrase.trim();
      if (key.length < 3) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.values()].some((n) => n >= 3);
}
