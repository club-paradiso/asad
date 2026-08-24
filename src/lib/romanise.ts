/**
 * Revised Romanisation of Hangul, syllable by syllable.
 *
 * Scope note: this deliberately does *not* implement inter-syllable liaison
 * (종로 → Jongno). Korean personal names are conventionally romanised
 * syllable-by-syllable with a hyphen in the given name — 류정길 → Ryu Jeong-gil
 * — which is exactly what an interpreter needs to read off a screen and say
 * out loud. For place names the output is an approximation and is presented as
 * a suggestion the interpreter can overwrite.
 *
 * Surnames are a documented exception to strict RR: see `SURNAMES` below.
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

/**
 * Conventional surname spellings.
 *
 * Strict Revised Romanisation would give 김 → "Gim" and 이 → "I", which no
 * Korean person writes and no interpreter should read out. Passports, business
 * cards and the congregation all use these forms instead, so they win.
 */
const SURNAMES: Record<string, string> = {
  김: "Kim", 이: "Lee", 박: "Park", 최: "Choi", 정: "Jung", 강: "Kang",
  조: "Cho", 윤: "Yoon", 장: "Jang", 임: "Lim", 한: "Han", 오: "Oh",
  서: "Seo", 신: "Shin", 권: "Kwon", 황: "Hwang", 안: "Ahn", 송: "Song",
  전: "Jeon", 홍: "Hong", 유: "Yu", 류: "Ryu", 고: "Ko", 문: "Moon",
  양: "Yang", 손: "Son", 배: "Bae", 백: "Baek", 허: "Heo", 남: "Nam",
  심: "Shim", 노: "Noh", 하: "Ha", 곽: "Kwak", 성: "Sung", 차: "Cha",
  주: "Joo", 우: "Woo", 구: "Koo", 민: "Min", 진: "Jin", 지: "Ji",
  엄: "Eom", 채: "Chae", 원: "Won", 천: "Cheon", 방: "Bang", 공: "Kong",
  현: "Hyun", 함: "Ham", 변: "Byun", 염: "Yeom", 여: "Yeo", 추: "Chu",
  도: "Do", 소: "So", 석: "Seok", 선: "Sun", 설: "Seol", 마: "Ma",
  길: "Gil", 연: "Yeon", 위: "Wi", 표: "Pyo", 명: "Myung", 기: "Ki",
  반: "Ban", 왕: "Wang", 금: "Keum", 옥: "Ok", 육: "Yook", 인: "In",
  맹: "Maeng", 제: "Je", 모: "Mo", 봉: "Bong", 탁: "Tak", 국: "Kook",
  남궁: "Namgung", 선우: "Sunwoo", 황보: "Hwangbo", 제갈: "Jegal",
  사공: "Sagong", 독고: "Dokgo", 서문: "Seomun",
};

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
  const surnameKorean = clean.slice(0, surnameLength);
  const surname = SURNAMES[surnameKorean] ?? capitalise(romanise(surnameKorean));
  const given = [...clean.slice(surnameLength)].map(romaniseSyllable);

  if (given.length === 0) return surname;
  const givenText = capitalise(given[0]) + (given.length > 1 ? `-${given.slice(1).join("")}` : "");
  return `${surname} ${givenText}`;
}
