/**
 * Revised Romanisation of Hangul, syllable by syllable.
 *
 * Scope note: this deliberately does *not* implement inter-syllable liaison
 * (종로 → Jongno). Korean personal names are conventionally romanised
 * syllable-by-syllable with a hyphen in the given name — 류정길 → Ryu Jeong-gil
 * — which is exactly what an interpreter needs to read off a screen and say
 * out loud. For place names the output is an approximation and is presented as
 * a suggestion the interpreter can overwrite.
 */
const INITIALS = [
  "g", "kk", "n", "d", "tt", "r", "m", "b", "pp",
  "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h",
];

const VOWELS = [
  "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa",
  "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i",
];

const FINALS = [
  "", "k", "k", "k", "n", "n", "n", "t", "l", "k",
  "m", "l", "l", "l", "p", "l", "m", "p", "p", "t",
  "t", "ng", "t", "t", "k", "t", "p", "t",
];

const SYLLABLE_BASE = 0xac00;
const SYLLABLE_LAST = 0xd7a3;

const isHangulSyllable = (code: number) =>
  code >= SYLLABLE_BASE && code <= SYLLABLE_LAST;

/** Romanise one Hangul syllable. Non-Hangul characters pass through. */
export function romaniseSyllable(char: string): string {
  const code = char.codePointAt(0);
  if (code === undefined || !isHangulSyllable(code)) return char;
  const offset = code - SYLLABLE_BASE;
  const initial = Math.floor(offset / 588);
  const vowel = Math.floor((offset % 588) / 28);
  const final = offset % 28;
  return `${INITIALS[initial]}${VOWELS[vowel]}${FINALS[final]}`;
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Romanise a run of Hangul, syllable by syllable, with no capitalisation. */
export function romanise(text: string): string {
  return [...text].map(romaniseSyllable).join("");
}

/**
 * Romanise a Korean personal name using the convention interpreters actually
 * use: `Surname Given-name`, e.g. 류정길 → "Ryu Jeong-gil".
 *
 * Two-syllable surnames (남궁, 선우, 황보, 제갈, 사공, 독고) are handled.
 */
const TWO_SYLLABLE_SURNAMES = ["남궁", "선우", "황보", "제갈", "사공", "독고", "서문"];

export function romaniseName(name: string): string {
  const clean = name.trim().replace(/\s+/g, "");
  if (!clean) return "";
  if (![...clean].some((c) => isHangulSyllable(c.codePointAt(0) ?? 0))) return name.trim();

  const surnameLength = TWO_SYLLABLE_SURNAMES.some((s) => clean.startsWith(s)) ? 2 : 1;
  const surname = capitalise(romanise(clean.slice(0, surnameLength)));
  const given = [...clean.slice(surnameLength)].map(romaniseSyllable);

  if (given.length === 0) return surname;
  const givenText = capitalise(given[0]) + (given.length > 1 ? `-${given.slice(1).join("")}` : "");
  return `${surname} ${givenText}`;
}
