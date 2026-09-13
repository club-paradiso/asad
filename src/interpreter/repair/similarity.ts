/**
 * Surface similarity for repair decisions.
 *
 * A recogniser does not make random errors: it substitutes a phonetically
 * close syllable (뉴송 → 뉴스송), drops a space, or hears a name as a common
 * word. To decide whether "뉴스송 처치" is the known entity "뉴송 처치", we
 * need a measure that scores those errors as *close* and unrelated words as
 * *far*. Plain character edit distance is too coarse for Hangul — one wrong
 * vowel makes a whole different syllable — so Korean is also compared at the
 * jamo level, where a wrong vowel is one edit out of ten instead of one
 * syllable out of four.
 *
 * Everything here is deterministic and symmetric. Scores are 0–1, 1 being
 * identical. Whitespace is ignored throughout, because a recogniser's spaces
 * are the least reliable thing it emits.
 */
import { isSpacelessLanguage, languageBase } from "@/languages/registry";
import { tokensFor } from "@/languages/normalise";
import { endsWord } from "@/interpreter/glossary/match-korean";

const SYLLABLE_BASE = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
const JAMO_L_BASE = 0x1100;
const JAMO_V_BASE = 0x1161;
const JAMO_T_BASE = 0x11a7;

/**
 * Decompose Hangul syllables into conjoining jamo (초성·중성·종성). A syllable
 * without a final consonant yields two jamo; with one, three. Anything that is
 * not a precomposed syllable passes through unchanged.
 */
export function toJamo(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < SYLLABLE_BASE || code > SYLLABLE_LAST) {
      out += ch;
      continue;
    }
    const offset = code - SYLLABLE_BASE;
    const initial = Math.floor(offset / 588);
    const vowel = Math.floor((offset % 588) / 28);
    const final = offset % 28;
    out += String.fromCharCode(JAMO_L_BASE + initial, JAMO_V_BASE + vowel);
    if (final > 0) out += String.fromCharCode(JAMO_T_BASE + final);
  }
  return out;
}

/** Levenshtein distance over code points. */
function levenshtein(a: string[], b: string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/** Normalised edit similarity, 1 = identical, 0 = nothing in common. Two empty strings are identical. */
export function similarity(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const longest = Math.max(x.length, y.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(x, y) / longest;
}

const stripSpace = (s: string) => s.replace(/\s+/g, "");

/** Lower-case, strip diacritics, keep only letters and digits. */
function latinLetters(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Language-aware surface similarity.
 *
 *   - Korean: the better of syllable-level and jamo-level similarity, so a
 *     one-vowel slip and a dropped syllable both score as close;
 *   - Chinese/Japanese/other spaceless scripts: character sequences;
 *   - everything else: lower-cased letters with diacritics stripped, so
 *     "Nguyễn" and "Nguyen" are the same name.
 */
export function surfaceSimilarity(a: string, b: string, language: string): number {
  const base = languageBase(language);
  if (base === "ko") {
    const x = stripSpace(a.normalize("NFC"));
    const y = stripSpace(b.normalize("NFC"));
    return Math.max(similarity(x, y), similarity(toJamo(x), toJamo(y)));
  }
  if (isSpacelessLanguage(language)) {
    return similarity(stripSpace(a.normalize("NFKC")), stripSpace(b.normalize("NFKC")));
  }
  return similarity(latinLetters(a), latinLetters(b));
}

/** Jaccard overlap of the token sets of two texts. Two empty texts overlap fully. */
export function tokenOverlap(a: string, b: string, language: string): number {
  const x = new Set(tokensFor(a, language));
  const y = new Set(tokensFor(b, language));
  if (x.size === 0 && y.size === 0) return 1;
  let shared = 0;
  for (const token of x) if (y.has(token)) shared += 1;
  const union = x.size + y.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface SpanMatch {
  /** Offset of the span in the original text. */
  index: number;
  /** The exact span text, inner whitespace included. */
  text: string;
  score: number;
}

interface Unit {
  start: number;
  end: number;
}

/**
 * How a text is cut into comparison units for windowing: syllables for
 * Korean, characters for spaceless scripts, words for everything else.
 */
function unitsOf(text: string, language: string): Unit[] {
  const units: Unit[] = [];
  const pattern =
    languageBase(language) === "ko" || isSpacelessLanguage(language)
      ? /[\p{L}\p{N}]/gu
      : /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
  for (const m of text.matchAll(pattern)) {
    units.push({ start: m.index, end: m.index + m[0].length });
  }
  return units;
}

const MIN_CJK_UNITS = 2;
const MIN_LATIN_LETTERS = 3;

/**
 * Find spans of `text` that look like `needle` written differently.
 *
 * Windows are one unit shorter to one unit longer than the needle, because
 * recogniser errors are local — a syllable inserted or dropped, a letter
 * substituted — and a window two units off is already a different phrase.
 * In Korean a window must start where a word starts and end where a word
 * (or its particle chain) ends, so 뉴송교회 is found in 뉴송교회를 but a
 * needle never matches the tail of a longer, unrelated word. In word-scripted
 * languages the units are words, so boundaries come for free; in spaceless
 * scripts there are no boundaries to respect.
 *
 * Needles shorter than two syllables/characters or three Latin letters are
 * never searched: at that length everything looks like everything.
 *
 * Returns the best non-overlapping matches at or above `threshold`, in text order.
 */
export function findSimilarSpans(
  text: string,
  needle: string,
  language: string,
  options: { threshold?: number } = {},
): SpanMatch[] {
  const threshold = options.threshold ?? 0.72;
  const korean = languageBase(language) === "ko";
  const syllabic = korean || isSpacelessLanguage(language);
  const needleUnits = unitsOf(needle, language).length;
  if (syllabic ? needleUnits < MIN_CJK_UNITS : latinLetters(needle).length < MIN_LATIN_LETTERS) return [];

  const units = unitsOf(text, language);
  if (units.length === 0) return [];
  const needleChars = new Set([...stripSpace(needle.normalize("NFC")).toLowerCase()]);
  const minLength = syllabic ? MIN_CJK_UNITS : 1;
  const candidates: Array<SpanMatch & { end: number; lengthDelta: number }> = [];

  for (const length of [needleUnits - 1, needleUnits, needleUnits + 1]) {
    if (length < minLength) continue;
    for (let start = 0; start + length <= units.length; start += 1) {
      const from = units[start].start;
      const to = units[start + length - 1].end;
      if (korean && !koreanBoundary(text, from, to)) continue;
      const candidate = text.slice(from, to);
      // Cheap prefilter: a span sharing no character with the needle cannot
      // reach the threshold at these lengths.
      if (![...candidate.toLowerCase()].some((ch) => needleChars.has(ch))) continue;
      const score = surfaceSimilarity(candidate, needle, language);
      if (score >= threshold) {
        candidates.push({ index: from, end: to, text: candidate, score, lengthDelta: Math.abs(length - needleUnits) });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.lengthDelta - b.lengthDelta || a.index - b.index);
  const chosen: Array<SpanMatch & { end: number }> = [];
  for (const candidate of candidates) {
    if (chosen.some((c) => candidate.index < c.end && candidate.end > c.index)) continue;
    chosen.push(candidate);
  }
  return chosen
    .sort((a, b) => a.index - b.index)
    .map(({ index, text: span, score }) => ({ index, text: span, score }));
}

const KOREAN_WORD_CHAR = /[가-힣A-Za-z0-9]/;

function koreanBoundary(text: string, from: number, to: number): boolean {
  if (from > 0 && KOREAN_WORD_CHAR.test(text[from - 1])) return false;
  return endsWord(text, to);
}
