/**
 * Language-aware normalisation that never decides meaning.
 *
 * Three consumers need three different views of the same recognised text:
 *
 *   - the console shows it, so it wants presentation cleanup (whitespace,
 *     punctuation spacing, a stutter of fillers collapsed) and nothing else;
 *   - the Translation Memory keys on it, so it wants a lookup key that treats
 *     "안녕하세요." and "안녕하세요" as the same unit;
 *   - the similarity and repair layers compare it, so they want tokens.
 *
 * The rule that keeps this module honest: it may move whitespace and
 * punctuation, but it never rewrites a word. "안녕 하세요" is a spacing
 * artefact and it stays — deciding that two syllables are one word is a
 * meaning decision, and meaning decisions belong to the evidence-gated repair
 * layer, where they can be explained and undone.
 *
 * Structured expressions (numbers, dates, times, residence codes like E-7,
 * acronyms, URLs, emails) are extracted here too, because every downstream
 * check — "did the number survive translation?" — needs the same extraction.
 */
import { isSpacelessLanguage, languageBase, languageScript } from "./registry";
import { normaliseChinesePunctuation } from "./chinese";

export interface NormalisedText {
  text: string;
  changed: boolean;
}

/**
 * Fillers that recognisers repeat when a speaker hesitates ("음 음 음").
 * Collapsing a run to one occurrence is presentation, not meaning: nobody
 * interprets the third "um". Only these exact tokens are collapsed — a
 * repeated content word ("네 네" as an emphatic yes) is left alone.
 */
const FILLERS = [
  "음", "어", "그", "저기", "아", "에",
  "um", "uh", "er", "erm", "ah", "hmm", "mm",
  "あの", "えっと", "えー", "あー",
  "嗯", "呃", "那个", "那個",
];
const FILLER_RUN = new RegExp(
  `(^|\\s)(${FILLERS.map(escapeRegExp).join("|")})(?:[\\s,，、]+\\2)+(?=[\\s,，、.。!?！？]|$)`,
  "giu",
);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Full-width ASCII letters and digits → half-width; only for CJK sources. */
const FULLWIDTH_ALNUM = /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g;

/**
 * Presentation cleanup for a transcript unit. Per script:
 *
 *   - everything: NFC, collapse runs of whitespace, trim, collapse filler runs;
 *   - Latin/Cyrillic/Korean: no space before `,.!?;:`, one space after a
 *     mark when a letter follows, case untouched;
 *   - Chinese/Japanese: half-width marks next to CJK become full-width
 *     (，。？！), spaces between CJK characters removed, full-width ASCII
 *     letters and digits become half-width.
 *
 * Numbers, dates, times, codes, acronyms, URLs and emails come out byte-for-
 * byte as they went in: every rule below only touches a mark that sits next
 * to whitespace or a CJK character, never one between two alphanumerics.
 */
export function normaliseTranscript(raw: string, language: string): NormalisedText {
  const base = languageBase(language);
  let text = raw.normalize("NFC");

  if (base === "zh" || base === "ja") {
    text = text.replace(FULLWIDTH_ALNUM, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
    text = normaliseChinesePunctuation(text);
  }

  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(FILLER_RUN, "$1$2");

  if (!isSpacelessLanguage(language)) {
    // " ." → "." and "hello ,world" → "hello, world". A comma between two
    // digits ("1,000") and a dot or colon after an alphanumeric ("3.5",
    // "a.m.", "15:30", "a@b.com") are structure, not spacing, and stay put.
    text = text.replace(/\s+([,.!?;:])/g, "$1");
    text = text.replace(/([,;!?])(?=\p{L})/gu, "$1 ");
    text = text.replace(/(?<![0-9])([,;!?])(?=[0-9])/g, "$1 ");
    text = text.replace(/(?<![A-Za-z0-9.])([.:])(?=\p{L})/gu, "$1 ");
  }

  // Duplicate terminal marks from a stuttering recogniser ("합니다.." → ".").
  text = text.replace(/([.!?。！？])\1+/g, "$1");
  text = text.replace(/\s+/g, " ").trim();

  return { text, changed: text !== raw };
}

/**
 * Punctuation is only meaningful inside a structured value when both of its
 * neighbours are Latin letters or digits: "E-7", "3.5", "15:30", "a@b.c".
 * Everywhere else it is presentation and drops out of the key.
 */
const STRUCTURAL_PUNCT = /(?<=[A-Za-z0-9\u00C0-\u024F])[\p{P}\p{S}](?=[A-Za-z0-9\u00C0-\u024F])/gu;
const ANY_PUNCT = /[\p{P}\p{S}]/gu;
const MARK = "\u2063"; // INVISIBLE SEPARATOR: never appears in transcripts

function stripLoosePunctuation(text: string): string {
  const kept = text.replace(STRUCTURAL_PUNCT, (m) => `${MARK}${m.codePointAt(0)!.toString(16)}${MARK}`);
  const stripped = kept.replace(ANY_PUNCT, "");
  return stripped.replace(/\u2063([0-9a-f]+)\u2063/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

/**
 * The Translation Memory lookup key.
 *
 * NFKC folds full-width forms; lower-casing folds Latin and Cyrillic (a
 * no-op for other scripts). Loose punctuation is removed everywhere so a
 * trailing "." or a stray "," never splits a memory; spaceless scripts also
 * drop whitespace, because a recogniser's spaces in Chinese carry no
 * information. Korean particles are part of the word and stay — 뉴송교회에서
 * and 뉴송교회를 are different units and must key differently.
 */
export function normalisationKey(text: string, language: string): string {
  let key = text.normalize("NFKC").toLowerCase();
  key = stripLoosePunctuation(key);
  if (isSpacelessLanguage(language)) return key.replace(/\s+/g, "");
  return key.replace(/\s+/g, " ").trim();
}

const HANGUL_SYLLABLE = /[가-힣]/;

/**
 * Tokens for overlap and similarity.
 *
 *   - Korean: each eojeol (whitespace-delimited word) plus its syllable
 *     bigrams, so 뉴송교회를 and 뉴송교회에서 still overlap on 뉴송/송교/교회;
 *   - spaceless scripts (zh/ja/th/km/my): character bigrams over the text
 *     with whitespace and punctuation removed, Latin/digit runs kept whole;
 *   - everything else: lower-cased words with surrounding punctuation removed.
 */
export function tokensFor(text: string, language: string): string[] {
  const base = languageBase(language);
  const clean = text.normalize("NFKC");

  if (base === "ko") {
    const out: string[] = [];
    for (const word of clean.split(/\s+/)) {
      const token = stripLoosePunctuation(word).toLowerCase();
      if (!token) continue;
      out.push(token);
      const syllables = [...token];
      if (syllables.length >= 2 && syllables.some((s) => HANGUL_SYLLABLE.test(s))) {
        for (let i = 0; i + 1 < syllables.length; i += 1) out.push(syllables[i] + syllables[i + 1]);
      }
    }
    return out;
  }

  if (isSpacelessLanguage(language)) {
    const out: string[] = [];
    // Latin/digit runs inside CJK text ("E-7", "KPI") are one token each.
    const runs = stripLoosePunctuation(clean).toLowerCase().match(/[a-z0-9][a-z0-9\-.:@]*|[^\sa-z0-9]+/g) ?? [];
    for (const run of runs) {
      if (/^[a-z0-9]/.test(run)) {
        out.push(run);
        continue;
      }
      const chars = [...run.replace(/\s+/g, "")];
      if (chars.length === 1) out.push(chars[0]);
      for (let i = 0; i + 1 < chars.length; i += 1) out.push(chars[i] + chars[i + 1]);
    }
    return out;
  }

  return clean
    .toLowerCase()
    .split(/\s+/)
    .map((word) => stripLoosePunctuation(word))
    .filter(Boolean);
}

export interface StructuredValues {
  /** Digit strings not belonging to a date, time or code, as written ("1,000"). */
  numbers: string[];
  /** Number words: Korean sino/native numerals with a multiplier or counter, Chinese numerals, English number words. */
  numeralWords: string[];
  times: string[];
  dates: string[];
  /** Visa/residence-style codes: E-7, D-10, F-2-7, and the ARC card. */
  codes: string[];
  /** All-caps abbreviations: KPI, STT. */
  acronyms: string[];
}

const URL_OR_EMAIL = /(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+\.[\w.-]+/gi;

const DATE_PATTERNS: RegExp[] = [
  /\b\d{4}[-./]\d{1,2}[-./]\d{1,2}\b/g,
  /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g,
  // Korean: 2026년 5월 31일, 9월 12일, 2026년 5월, 2026년.
  /(?:\d{4}\s?년\s?)?\d{1,2}\s?월\s?\d{1,2}\s?일|\d{4}\s?년\s?\d{1,2}\s?월|\d{4}\s?년/g,
  // Chinese/Japanese: 2026年5月31日, 9月12号.
  /(?:\d{4}\s?年\s?)?\d{1,2}\s?月\s?\d{1,2}\s?[日号號]|\d{4}\s?年\s?\d{1,2}\s?月|\d{4}\s?年/g,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi,
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:,?\s+\d{4})?\b/gi,
];

const TIME_PATTERNS: RegExp[] = [
  /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?(?:am|pm|a\.m\.|p\.m\.))?(?![a-z])/gi,
  /\b\d{1,2}\s?(?:am|pm|a\.m\.|p\.m\.|o'clock)(?![a-z])/gi,
  // Korean: 오후 3시, 3시 반, 15시 30분. 시간 (hours, a duration) is not a time.
  /(?:오전|오후|새벽|아침|저녁|밤)?\s?\d{1,2}\s?시(?!간|절|대)(?:\s?\d{1,2}\s?분)?(?:\s?반)?/g,
  /(?:上午|下午|早上|晚上|凌晨|午前|午後)?\d{1,2}\s?[点點时時](?:\s?\d{1,2}\s?分)?(?:半)?/g,
];

const CODE_PATTERN = /\b[A-Z]{1,2}-\d{1,3}(?:-\d{1,2})?\b/g;
/** Abbreviations that are document codes rather than acronyms in this domain. */
const KNOWN_CODES = new Set(["ARC"]);
const ACRONYM_PATTERN = /\b[A-Z]{2,6}\b/g;
const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;

const KOREAN_SINO_NUMERAL = /(?:[일이삼사오육칠팔구]?[십백천만억]+)+[일이삼사오육칠팔구]?/g;
const KOREAN_NATIVE_NUMERAL =
  /(?:하나|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열|스물|서른|마흔|쉰|예순|일흔|여든|아흔|한|두|세|네)\s?(?:명|개|번|살|분|권|장|대|마리|잔|그루|채|켤레|병|사람|가지|시간|달|주|년|번째|층|줄)/g;
const CHINESE_NUMERAL = /[一二三四五六七八九两兩零〇十百千万萬亿億]{2,}/g;
const ENGLISH_NUMERAL =
  /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b/gi;

function takeAll(text: string, patterns: RegExp[], into: string[]): string {
  let rest = text;
  for (const pattern of patterns) {
    rest = rest.replace(pattern, (m) => {
      into.push(m.trim());
      return " ".repeat(m.length);
    });
  }
  return rest;
}

/**
 * Extract the values that must survive translation untouched.
 *
 * Extraction is layered so a digit is claimed once: URLs and emails are
 * blanked first (they are never "numbers"), then dates, times and codes, and
 * only what is left counts as a plain number. This is why "9월 12일 3시에
 * 300명" yields dates [9월 12일], times [3시] and numbers [300] — and why a
 * target that renders the date as "September 12" is not accused of dropping
 * a "9".
 *
 * Numeral words (삼백, 三百, three hundred) are reported separately and are
 * never converted: "삼백 → 300" is a meaning decision this module does not make.
 */
export function extractStructuredValues(text: string, language: string): StructuredValues {
  const base = languageBase(language);
  const values: StructuredValues = { numbers: [], numeralWords: [], times: [], dates: [], codes: [], acronyms: [] };

  let rest = text.replace(URL_OR_EMAIL, (m) => " ".repeat(m.length));
  rest = takeAll(rest, DATE_PATTERNS, values.dates);
  rest = takeAll(rest, TIME_PATTERNS, values.times);
  rest = takeAll(rest, [CODE_PATTERN], values.codes);
  rest = rest.replace(ACRONYM_PATTERN, (m) => {
    if (KNOWN_CODES.has(m)) values.codes.push(m);
    else values.acronyms.push(m);
    return " ".repeat(m.length);
  });
  values.numbers = rest.match(NUMBER_PATTERN) ?? [];

  const words: string[] = [];
  if (base === "ko") {
    words.push(...(rest.match(KOREAN_SINO_NUMERAL) ?? []).filter((w) => [...w].length >= 2));
    words.push(...(rest.match(KOREAN_NATIVE_NUMERAL) ?? []));
  } else if (base === "zh" || base === "ja") {
    words.push(...(rest.match(CHINESE_NUMERAL) ?? []));
  } else if (languageScript(language) === "Latn" || !languageScript(language)) {
    words.push(...(rest.match(ENGLISH_NUMERAL) ?? []));
  }
  values.numeralWords = words;
  return values;
}

/**
 * Negation markers per language. Each pattern is written to avoid the
 * obvious homographs: 안 before a verb but not 안녕/안내, 못 the adverb but
 * not 못 the nail, 别 but not 特别/别人, 非 but not 非常, 未 but not 未来.
 * Recall is not perfect; precision matters more, because a false "negation
 * mismatch" flag on a live rail teaches the interpreter to ignore the flag.
 */
const NEGATION: Record<string, RegExp[]> = {
  ko: [
    /않/g,
    /없/g,
    /아니|아닙|아냐|아녜/g,
    /못(?=\s+[가-힣]|(?![이을에은도과와])[가-힣])/g,
    /(?:^|[\s"'(])안(?=\s+[가-힣]|(?:돼|되|됩|됐|해|합|했|하|한|할|가|갑|갔|와|옵|왔|먹|보|봅|봤|사|삽|샀|알|압|좋|다|받|쓰|씁|나|납|났|드|들|오|타|계|주|줍|줬|믿|만|살|열|남|낼|내))/g,
    /지\s?(?:마|말)(?=[세십라고요아\s]|$)/g,
  ],
  en: [/\b(?:not|never|no|nothing|none|neither|nor|nobody|nowhere|cannot|without)\b|n't\b/gi],
  zh: [
    /不|没|沒|未(?![来來])|勿|莫|无(?!论)|無(?!論)|非(?!常)/g,
    /(?<![特分区區个個级級类類性差])[别別](?![人的处處])/g,
  ],
  ja: [/ない|ません|なく|なかった|無い|(?<![ぁ-ん])ぬ(?=[。、\s]|$)/g],
  es: [/\b(?:no|nunca|nada|nadie|ningún|ninguno|ninguna|jamás|tampoco|ni)\b/gi],
  fr: [/\b(?:ne|pas|jamais|rien|personne|aucun|aucune|non|ni)\b|\bn'/gi],
  de: [/\b(?:nicht|nie|kein|keine|keinen|keiner|keinem|keines|niemals|nichts|niemand|nein|weder)\b/gi],
};

/** Languages whose negation detector is reliable enough to compare across a pair. */
export const NEGATION_RELIABLE: ReadonlySet<string> = new Set(["ko", "en", "zh", "ja"]);

/** Number of negation markers in the text; 0 for languages without a detector. */
export function negationCount(text: string, language: string): number {
  const patterns = NEGATION[languageBase(language)];
  if (!patterns) return 0;
  let count = 0;
  for (const pattern of patterns) count += (text.match(pattern) ?? []).length;
  return count;
}
