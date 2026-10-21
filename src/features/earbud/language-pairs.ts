import { findLanguage, liveLanguagePairProblem } from "@/lib/languages";

/** Phase 4C: English is the first global output, not a claim that all
 * browser voices and languages have passed hardware tests. */
export const EARBUD_OUTPUT_LANGUAGES = ["ko-KR", "en-US"] as const;
export type EarbudOutputLanguage = typeof EARBUD_OUTPUT_LANGUAGES[number];

export function isEarbudTarget(code: string): code is EarbudOutputLanguage {
  return (EARBUD_OUTPUT_LANGUAGES as readonly string[]).includes(code);
}

/** Shared by all three server providers and the browser's Start gate. */
export function earbudPairProblem(source: string, target: string): string | null {
  if (!isEarbudTarget(target)) return "unsupported-output";
  return liveLanguagePairProblem(source, target);
}

export function earbudTargetName(code: string): string {
  return findLanguage(code)?.en ?? code;
}
