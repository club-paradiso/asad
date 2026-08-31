/** Language-aware transcript cleanup shared by browser and cloud STT paths. */

const NO_SPACE_BASES = new Set(["zh", "ja", "th", "km", "my"]);
const BROWSER_RESULT_NO_SPACE_BASES = new Set([...NO_SPACE_BASES, "ko"]);

const SCRIPT_TESTS: Record<string, RegExp> = {
  ko: /[\uac00-\ud7a3\u1100-\u11ff]/u,
  zh: /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u,
  ja: /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u,
  ru: /[\u0400-\u04ff]/u,
  ar: /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u,
  ur: /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u,
  hi: /[\u0900-\u097f]/u,
  ne: /[\u0900-\u097f]/u,
  bn: /[\u0980-\u09ff]/u,
  th: /[\u0e00-\u0e7f]/u,
  km: /[\u1780-\u17ff]/u,
  my: /[\u1000-\u109f\uaa60-\uaa7f]/u,
};

// A deliberately small, high-signal set rather than pretending script
// conversion is a dictionary. These characters commonly distinguish public-
// service phrases and let us break ties when WebSpeech returns both variants.
const SIMPLIFIED_HINT = /[这国证签办体门长话发务关续请号录处华]/u;
const TRADITIONAL_HINT = /[這國證簽辦體門長話發務關續請號錄處華]/u;

const baseLanguage = (language: string | undefined) =>
  (language ?? "").split("-")[0]?.toLowerCase() ?? "";

const cleanupJoined = (value: string) =>
  value.replace(/\s+([,.!?;:，。！？；：])/gu, "$1").trim();

const chineseVariantBonus = (text: string, language: string | undefined): number => {
  const tag = (language ?? "").toLowerCase();
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

/**
 * Select the recognition alternative that best matches the script expected for
 * the chosen language. Browsers sometimes rank a Latin-looking phonetic guess
 * above the native-script result for Chinese, Arabic, Hindi, etc.
 */
export function pickSpeechAlternative(
  alternatives: readonly string[],
  language: string | undefined,
): string {
  const usable = alternatives.map((value) => value.trim()).filter(Boolean);
  if (usable.length <= 1) return usable[0] ?? "";

  const base = baseLanguage(language);
  const script = SCRIPT_TESTS[base];
  if (!script) return usable[0];

  const score = (text: string) => {
    const compact = [...text].filter((char) => /[\p{L}\p{N}]/u.test(char));
    if (!compact.length) return -1;
    const expected = compact.filter((char) => script.test(char)).length;
    const latin = compact.filter((char) => /[A-Za-z]/u.test(char)).length;
    return (
      expected / compact.length -
      (latin / compact.length) * 0.2 +
      chineseVariantBonus(text, language)
    );
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
  const separator = NO_SPACE_BASES.has(baseLanguage(language)) ? "" : " ";
  return cleanupJoined(clean.join(separator));
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
  const separator = BROWSER_RESULT_NO_SPACE_BASES.has(baseLanguage(language)) ? "" : " ";
  return cleanupJoined(clean.join(separator));
}
