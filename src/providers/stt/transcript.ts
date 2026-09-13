/**
 * Language-aware transcript cleanup shared by browser and cloud STT paths.
 *
 * Which languages write without spaces, and which script each one is written
 * in, come from the registry. Only the per-script character tests live here —
 * they are how an alternative is judged to be "in the expected script".
 */
import {
  isSpacelessLanguage,
  languageBase,
  languageScript,
  type WritingScript,
} from "@/languages/registry";

/**
 * Unicode ranges per writing script, for scoring recogniser alternatives.
 *
 * Latin is deliberately absent: a Latin-script language has no useful
 * "expected script" test, because names, codes and loanwords in every other
 * language are Latin too. Han covers both Chinese scripts and the kanji part
 * of Japanese; the Simplified/Traditional distinction is a separate bonus.
 */
const SCRIPT_TESTS: Partial<Record<WritingScript, RegExp>> = {
  Hang: /[가-힣ᄀ-ᇿ]/u,
  Hans: /[㐀-䶿一-鿿豈-﫿]/u,
  Hant: /[㐀-䶿一-鿿豈-﫿]/u,
  Jpan: /[぀-ヿ㐀-䶿一-鿿]/u,
  Cyrl: /[Ѐ-ӿ]/u,
  Arab: /[؀-ۿݐ-ݿࢠ-ࣿ]/u,
  Deva: /[ऀ-ॿ]/u,
  Beng: /[ঀ-৿]/u,
  Thai: /[฀-๿]/u,
  Khmr: /[ក-៿]/u,
  Mymr: /[က-႟ꩠ-ꩿ]/u,
};

/**
 * Characters whose Simplified and Traditional forms differ and which turn up
 * constantly at a counter: 这/這, 国/國, 证/證, 签/簽, 办/辦, 体/體, 门/門, 长/長,
 * 话/話, 发/發, 务/務, 关/關, 续/續, 请/請, 号/號, 录/錄, 处/處, 华/華.
 */
const SIMPLIFIED_HINT = /[这国证签办体门长话发务关续请号录处华]/u;
const TRADITIONAL_HINT = /[這國證簽辦體門長話發務關續請號錄處華]/u;

// STT defaults to Korean elsewhere in the app (webSpeechLanguage/deepgramLanguage).
// Keep helpers consistent when a caller omits a language rather than inventing
// an accidental third default that changes spacing/alternative ranking.
const DEFAULT_LANGUAGE = "ko-KR";
const withDefault = (language: string | undefined) => language ?? DEFAULT_LANGUAGE;

const cleanupJoined = (value: string) =>
  value.replace(/\s+([,.!?;:，。！？；：])/gu, "$1").trim();

/**
 * How strongly `text` is written in the Chinese script the language asks for.
 * Positive for the right script, negative for the other one, zero for a
 * language that is not Chinese.
 */
const chineseVariantBonus = (text: string, language: string | undefined): number => {
  const script = languageScript(withDefault(language));
  if (script !== "Hans" && script !== "Hant") return 0;
  const wanted = script === "Hans" ? SIMPLIFIED_HINT : TRADITIONAL_HINT;
  const unwanted = script === "Hans" ? TRADITIONAL_HINT : SIMPLIFIED_HINT;
  return [...text].reduce(
    (score, char) => score + (wanted.test(char) ? 0.08 : unwanted.test(char) ? -0.08 : 0),
    0,
  );
};

export function pickSpeechAlternative(
  alternatives: readonly string[],
  language: string | undefined,
): string {
  const usable = alternatives.map((value) => value.trim()).filter(Boolean);
  if (usable.length <= 1) return usable[0] ?? "";

  const script = languageScript(withDefault(language));
  const test = script ? SCRIPT_TESTS[script] : undefined;
  if (!test) return usable[0];

  const score = (text: string) => {
    const compact = [...text].filter((char) => /[\p{L}\p{N}]/u.test(char));
    if (!compact.length) return -1;
    const expected = compact.filter((char) => test.test(char)).length;
    return expected / compact.length + chineseVariantBonus(text, language);
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
  if (!isSpacelessLanguage(withDefault(language))) return cleanupJoined(clean.join(" "));
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
  const tag = withDefault(language);
  const glued = isSpacelessLanguage(tag) || languageBase(tag) === "ko";
  if (!glued) return cleanupJoined(clean.join(" "));
  return cleanupJoined(joinNoSpaceLanguageParts(clean));
}
