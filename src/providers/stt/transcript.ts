/** Language-aware transcript cleanup shared by browser and cloud STT paths. */
import { findLanguage } from "@/lib/languages";

const SIMPLIFIED_HINT = /[这国证签办体门长话发务关续请号录处华]/u;
const TRADITIONAL_HINT = /[這國證簽辦體門長話發務關續請號錄處華]/u;

// STT defaults to Korean elsewhere in the app (webSpeechLanguage/deepgramLanguage).
// Keep helpers consistent when a caller omits a language rather than inventing
// an accidental third default that changes spacing/alternative ranking.
const definitionFor = (language: string | undefined) => findLanguage(language ?? "ko-KR");

/** True for writing systems that do not separate words with spaces. */
const unspaced = (language: string | undefined): boolean =>
  definitionFor(language)?.spaced === false;

/**
 * Korean IS spaced, but ONE browser recognition event can split a single
 * lexical item across result slots (안녕 + 하세요). Within an event those slots
 * are concatenated verbatim; between independently stable chunks normal word
 * spacing applies. That distinction is about the recogniser, not the script,
 * so it lives here rather than in the registry.
 */
const unspacedWithinBrowserResult = (language: string | undefined): boolean =>
  unspaced(language) || definitionFor(language)?.base === "ko";

const cleanupJoined = (value: string) =>
  value.replace(/\s+([,.!?;:，。！？；：])/gu, "$1").trim();

/**
 * Nudge the alternative picker toward the script variant that was requested.
 *
 * Only meaningful for a tag whose meaning IS a script variant; the registry
 * says which those are, so this is not a Chinese special case sitting in a
 * general-purpose function.
 */
const scriptVariantBonus = (text: string, language: string | undefined): number => {
  const definition = definitionFor(language);
  if (!definition?.scriptVariant) return 0;
  const tag = definition.id.toLowerCase();
  if (tag === "zh-cn") {
    return [...text].reduce(
      (score, char) => score + (SIMPLIFIED_HINT.test(char) ? 0.08 : TRADITIONAL_HINT.test(char) ? -0.08 : 0),
      0,
    );
  }
  if (tag === "zh-tw") {
    return [...text].reduce(
      (score, char) => score + (TRADITIONAL_HINT.test(char) ? 0.08 : SIMPLIFIED_HINT.test(char) ? -0.08 : 0),
      0,
    );
  }
  return 0;
};

export function pickSpeechAlternative(
  alternatives: readonly string[],
  language: string | undefined,
): string {
  const usable = alternatives.map((value) => value.trim()).filter(Boolean);
  if (usable.length <= 1) return usable[0] ?? "";

  const script = definitionFor(language)?.scriptPattern;
  if (!script) return usable[0];

  const score = (text: string) => {
    const compact = [...text].filter((char) => /[\p{L}\p{N}]/u.test(char));
    if (!compact.length) return -1;
    const expected = compact.filter((char) => script.test(char)).length;
    return expected / compact.length + scriptVariantBonus(text, language);
  };

  return usable.reduce((best, candidate) =>
    score(candidate) > score(best) ? candidate : best,
  );
}

/** Join separate STT chunks. Stable Korean chunks are words/phrases, so retain spaces. */
export function joinTranscriptParts(
  parts: readonly string[],
  language: string | undefined,
): string {
  const clean = parts.map((part) => part.trim()).filter(Boolean);
  if (!clean.length) return "";
  if (!unspaced(language)) return cleanupJoined(clean.join(" "));
  return cleanupJoined(joinNoSpaceLanguageParts(clean));
}

const latinBoundary = (left: string, right: string): boolean =>
  /[A-Za-z0-9]$/u.test(left) && /^[A-Za-z0-9]/u.test(right);

function joinNoSpaceLanguageParts(parts: readonly string[]): string {
  return parts.reduce(
    (joined, part) => joined + (joined && latinBoundary(joined, part) ? " " : "") + part,
    "",
  );
}

/**
 * Join multiple result slots from ONE browser recognition event. WebSpeech can
 * split a single Korean lexical item across slots (안녕 + 하세요); historically
 * those slots were concatenated verbatim. Keep that behavior for Korean while
 * still using normal word spacing between independently stable STT chunks.
 */
export function joinBrowserResultParts(
  parts: readonly string[],
  language: string | undefined,
): string {
  const clean = parts.map((part) => part.trim()).filter(Boolean);
  if (!clean.length) return "";
  if (!unspacedWithinBrowserResult(language)) {
    return cleanupJoined(clean.join(" "));
  }
  return cleanupJoined(joinNoSpaceLanguageParts(clean));
}
