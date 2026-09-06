/**
 * The narrow, reversible cleanup between what the recogniser wrote and what
 * the person is shown to check.
 *
 * The rule this file exists to hold: it may change how something is *written*
 * and never what it *says*. Spacing, a doubled "uh", "E seven" written as
 * "E-7" — those are transcription conventions. Anything that requires deciding
 * what the speaker meant is not cleanup, and belongs to the person about to
 * press send, who is standing right there and can simply be asked.
 *
 * Concretely forbidden, and tested:
 *   - touching negation in any direction
 *   - completing a sentence the recogniser left unfinished
 *   - resolving an uncertain word to the likelier one
 *   - inventing a date, a number, a status, or a deadline
 *
 * Everything here is deterministic, local, and applied before the editable
 * review field — so a wrong call costs one keystroke, not a mistranslation.
 */
import { isResidenceStatusCode } from "./domain-vocabulary";

/** Words a recogniser emits for hesitation, per language it can write them in. */
const FILLERS: Record<string, readonly string[]> = {
  en: ["uh", "um", "erm", "er", "ah", "hmm", "mm"],
  ko: ["어", "음", "아", "그"],
  ja: ["えっと", "あの", "ええ"],
  zh: ["嗯", "那个", "呃"],
};

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};

const MONTHS = [
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
];

/** Duration units after which a spelled number is unambiguously a quantity. */
const UNITS = [
  "day", "days", "week", "weeks", "month", "months", "year", "years",
  "time", "times", "copy", "copies", "page", "pages",
];

/**
 * Words that make a bare letter-plus-number a residence status rather than a
 * seat, an exit, or a paper size.
 *
 * Required only for the spoken form ("E seven"). A transcript that already
 * reads "E-7" or "E7" is code-shaped on its own and needs no cue.
 */
const STATUS_CONTEXT =
  /(?:visa|status|sojourn|residence|resident|extension|extend|change|immigration|permit|register|registration|체류|자격|비자|연장|변경|등록|출입국|근무처)/i;

const collapseWhitespace = (text: string): string =>
  text.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

const tidyPunctuation = (text: string): string =>
  text
    // A space the recogniser inserted before punctuation it added itself.
    .replace(/\s+([,.!?;:%)\]}])/gu, "$1")
    .replace(/([([{])\s+/gu, "$1")
    // Runs of the same terminal mark, which no speaker produced.
    .replace(/([,;:])\1+/gu, "$1")
    .replace(/\.{4,}/gu, "...")
    .replace(/([!?])\1{2,}/gu, "$1");

/**
 * Collapse an immediately repeated filler to one.
 *
 * It only removes a *duplicate*. A single "uh" is left exactly where it was:
 * deleting it is an editorial judgement about how someone speaks, and this
 * layer does not make those.
 */
function collapseRepeatedFillers(text: string, language: string): string {
  const fillers = FILLERS[language.split("-")[0].toLowerCase()];
  if (!fillers?.length) return text;
  let result = text;
  for (const filler of fillers) {
    const escaped = filler.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const repeated = new RegExp(
      `(?<![\\p{L}\\p{N}])(${escaped})(?:[\\s,]+\\1(?![\\p{L}\\p{N}]))+`,
      "giu",
    );
    result = result.replace(repeated, "$1");
  }
  return result;
}

/** "twenty one" / "twenty-first" / "seven" → 21 / 21 / 7, or null. */
function spelledNumber(words: readonly string[]): { value: number; consumed: number } | null {
  const first = words[0]?.toLowerCase();
  if (!first) return null;

  if (TENS[first] !== undefined) {
    const second = words[1]?.toLowerCase();
    if (second && ONES[second] !== undefined && ONES[second] > 0 && ONES[second] < 10) {
      return { value: TENS[first] + ONES[second], consumed: 2 };
    }
    if (second && ORDINALS[second] !== undefined && ORDINALS[second] < 10) {
      return { value: TENS[first] + ORDINALS[second], consumed: 2 };
    }
    return { value: TENS[first], consumed: 1 };
  }
  if (ONES[first] !== undefined) return { value: ONES[first], consumed: 1 };
  if (ORDINALS[first] !== undefined) return { value: ORDINALS[first], consumed: 1 };
  return null;
}

const NUMBER_WORDS = [
  ...Object.keys(TENS).flatMap((ten) => [
    ...Object.keys(ONES).filter((one) => ONES[one] > 0 && ONES[one] < 10).map((one) => `${ten}[\\s-]${one}`),
    ...Object.keys(ORDINALS).filter((ord) => ORDINALS[ord] < 10).map((ord) => `${ten}[\\s-]${ord}`),
    ten,
  ]),
  ...Object.keys(ONES).sort((a, b) => b.length - a.length),
  ...Object.keys(ORDINALS).sort((a, b) => b.length - a.length),
].join("|");

const MONTH_NUMBER_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${MONTHS.join("|")})\\s+(${NUMBER_WORDS})(?![\\p{L}\\p{N}])`,
  "giu",
);

const UNIT_NUMBER_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${NUMBER_WORDS})\\s+(${UNITS.join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

const parsePhrase = (phrase: string): number | null => {
  const parsed = spelledNumber(phrase.split(/[\s-]+/u));
  return parsed ? parsed.value : null;
};

/**
 * Write spelled numbers as digits where the surrounding words fix the meaning.
 *
 * Only after a month name ("May thirty first") or before a duration unit
 * ("three months"). Both are contexts where the digits say precisely what the
 * words did — and where leaving the words means the date and duration checks
 * downstream cannot see the value at all, because they look for digits.
 *
 * Bare numbers elsewhere are left alone. "one moment" is not a quantity.
 */
function digitiseNumbers(text: string): string {
  const withDates = text.replace(MONTH_NUMBER_RE, (whole, month: string, phrase: string) => {
    const value = parsePhrase(phrase);
    return value !== null && value >= 1 && value <= 31 ? `${month} ${value}` : whole;
  });
  return withDates.replace(UNIT_NUMBER_RE, (whole, phrase: string, unit: string) => {
    const value = parsePhrase(phrase);
    return value !== null ? `${value} ${unit}` : whole;
  });
}

/**
 * Canonicalise residence status codes.
 *
 * Three written forms reach here for one spoken thing — "E-7", "E7", "E seven"
 * — and only the first is what an application form expects. Every conversion
 * is checked against the real list of statuses, so "A-4" stays a paper size
 * and "F1" only becomes F-1 because F-1 exists.
 */
function normaliseStatusCodes(text: string): string {
  const contextual = STATUS_CONTEXT.test(text);

  // Already code-shaped: "E7", "e-7", "D—10".
  // The boundary is "not adjacent to more Latin text" rather than "not next to
  // a letter": Korean attaches the particle straight onto the code (D-2에서),
  // and a Unicode letter boundary rejects exactly those sentences.
  let result = text.replace(
    /(?<![A-Za-z0-9])([A-Ha-h])[-‐‑‒–—]?(10|[1-9])(?![A-Za-z0-9])/gu,
    (whole, letter: string, digits: string) =>
      isResidenceStatusCode(letter, digits) ? `${letter.toUpperCase()}-${digits}` : whole,
  );

  // Spoken: "E seven", "D ten". Needs an administrative cue somewhere in the
  // utterance, so an ordinary sentence containing a stray letter and a number
  // word is not rewritten into a visa category.
  if (contextual) {
    result = result.replace(
      /(?<![A-Za-z0-9])([A-Ha-h])[\s-]+(one|two|three|four|five|six|seven|eight|nine|ten)(?![A-Za-z0-9])/gu,
      (whole, letter: string, word: string) => {
        const digits = String(ONES[word.toLowerCase()]);
        return isResidenceStatusCode(letter, digits) ? `${letter.toUpperCase()}-${digits}` : whole;
      },
    );
  }
  return result;
}

/** Names that are one token in the real world and several in a transcript. */
function normaliseAcronyms(text: string, contextual: boolean): string {
  let result = text.replace(/(?<![A-Za-z0-9])hi[\s-]?korea(?![A-Za-z0-9])/giu, "HiKorea");
  result = result.replace(/(?<![A-Za-z0-9])A\.\s?R\.\s?C\.?(?![A-Za-z0-9])/gu, "ARC");
  if (contextual) {
    // "arc" is an ordinary English word, so it is only capitalised inside an
    // utterance that is already about residence documents.
    result = result.replace(/(?<![A-Za-z0-9])arc(?![A-Za-z0-9])/giu, "ARC");
  }
  return result;
}

export interface TranscriptNormalisationOptions {
  /** Source language of the transcript. Selects the filler list. */
  language: string;
}

/**
 * Clean one speech transcript for review.
 *
 * Returns the input unchanged when there is nothing safe to do, which is the
 * common case for short utterances.
 */
export function normaliseTranscript(
  raw: string,
  { language }: TranscriptNormalisationOptions,
): string {
  if (!raw.trim()) return "";
  const base = language.split("-")[0].toLowerCase();

  let text = collapseWhitespace(raw);
  text = collapseRepeatedFillers(text, base);
  text = normaliseStatusCodes(text);
  text = normaliseAcronyms(text, STATUS_CONTEXT.test(text));
  if (base === "en") text = digitiseNumbers(text);
  text = tidyPunctuation(text);
  return collapseWhitespace(text);
}
