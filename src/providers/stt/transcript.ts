/** Language-aware transcript cleanup shared by browser and cloud STT paths. */

const NO_SPACE_BASES = new Set(["zh", "ja", "th", "km", "my"]);

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

const baseLanguage = (language: string | undefined) =>
  (language ?? "").split("-")[0]?.toLowerCase() ?? "";

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
    return expected / compact.length - latin / compact.length * 0.2;
  };

  return usable.reduce((best, candidate) =>
    score(candidate) > score(best) ? candidate : best,
  );
}

/** Join recognition chunks without injecting unnatural spaces into CJK/Thai/etc. */
export function joinTranscriptParts(
  parts: readonly string[],
  language: string | undefined,
): string {
  const clean = parts.map((part) => part.trim()).filter(Boolean);
  if (!clean.length) return "";
  const separator = NO_SPACE_BASES.has(baseLanguage(language)) ? "" : " ";
  return clean.join(separator).replace(/\s+([,.!?;:，。！？；：])/gu, "$1").trim();
}
