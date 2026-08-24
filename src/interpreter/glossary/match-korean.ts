/**
 * Whole-word matching for Korean.
 *
 * Korean agglutinates, so plain substring search is actively wrong for a
 * glossary: 감사 fires inside 감사합니다 ("thank you", not "thanksgiving"),
 * 한 fires inside 거룩한, 정 fires inside 정말. A false term on a live console
 * is worse than a missing one — the interpreter has half a second and will
 * take what the screen says.
 *
 * A match is accepted when the term is followed by end-of-string, whitespace,
 * punctuation, or one of the particles/suffixes that legitimately attach to a
 * noun. Anything else means the term is part of a longer word.
 */

/**
 * Particles, suffixes and copula endings that attach directly to a noun.
 * Matched longest-first, and chained — Korean stacks them (성도 + 들 + 이).
 */
export const NOUN_SUFFIXES = [
  // case, topic and connective particles
  "이", "가", "을", "를", "은", "는", "의", "에", "에서", "에게", "에게서",
  "으로", "로", "와", "과", "도", "만", "까지", "부터", "마다", "조차",
  "밖에", "처럼", "같이", "이나", "나", "든지", "이든", "이며", "며",
  "이라", "이라는", "이라고", "라고", "라는", "이요", "요", "이고", "고",
  // plural and honorific suffixes
  "님", "들", "께", "께서",
  // copula endings — 은혜입니다, 제사장이요, 나라였습니다
  "입니다", "입니까", "이다", "예요", "이에요", "이었", "였", "임", "이란",
  "이시", "이지", "이야", "인", "이신", "이라면",
  // verbal noun endings that still leave the noun intact
  "습니다", "ㅂ니다",
] as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SUFFIX_ALTERNATION = [...NOUN_SUFFIXES]
  .sort((a, b) => b.length - a.length)
  .map(escape)
  .join("|");

const HANGUL = /[가-힣]/;

/**
 * True when the text at `index` ends a whole Korean word.
 *
 * `index` is the offset just past the term.
 */
const SUFFIX_RE = new RegExp(`^(?:${SUFFIX_ALTERNATION})`);

/** Guard against pathological input; no real word stacks more than a few. */
const MAX_SUFFIX_CHAIN = 4;

export function endsWord(text: string, index: number): boolean {
  let rest = text.slice(index);

  // Korean stacks suffixes — 성도 + 들 + 이, 하나님 + 께서 + 는 — so consume
  // them in a chain rather than expecting exactly one.
  for (let i = 0; i <= MAX_SUFFIX_CHAIN; i += 1) {
    if (rest.length === 0) return true;
    if (!HANGUL.test(rest[0])) return true;
    const match = rest.match(SUFFIX_RE);
    // Anything left that is still Hangul and is not a suffix means the term
    // was part of a longer word: 감사 inside 감사합니다.
    if (!match) return false;
    rest = rest.slice(match[0].length);
  }
  return false;
}

/**
 * True when the character before `index` does not continue a Korean word.
 *
 * Prevents 나라 matching inside 우리나라 when the term is meant as a free noun.
 */
export function startsWord(text: string, index: number): boolean {
  if (index === 0) return true;
  return !HANGUL.test(text[index - 1]);
}

/** Every whole-word occurrence of `term` in `text`. */
export function findWholeWordOccurrences(text: string, term: string): number[] {
  if (!term) return [];
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(term, from);
    if (at === -1) return out;
    if (startsWord(text, at) && endsWord(text, at + term.length)) out.push(at);
    from = at + 1;
  }
}
