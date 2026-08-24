/**
 * Sino-Korean numeral parsing.
 *
 * Speech recognisers usually emit digits, but not always — "베드로전서 이 장
 * 구 절" is a perfectly normal recognition of a spoken reference. This parses
 * the Sino-Korean number words that appear in chapter and verse positions
 * (1–999 is far more than enough: Psalm 150 is the ceiling).
 */
const DIGITS: Record<string, number> = {
  영: 0, 공: 0,
  일: 1, 이: 2, 삼: 3, 사: 4, 오: 5,
  육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9,
};

const UNITS: Record<string, number> = { 십: 10, 백: 100 };

export const SINO_NUMERAL_PATTERN = "[영공일이삼사오육륙칠팔구십백]+";

/**
 * Parse a Sino-Korean numeral string. Returns `null` when the string is not a
 * well-formed number, so callers can fall back rather than guess.
 *
 * 구 → 9, 십 → 10, 이십삼 → 23, 백오십 → 150.
 */
export function parseSinoNumeral(input: string): number | null {
  const text = input.trim();
  if (!text) return null;

  let total = 0;
  let current = 0;
  let sawAny = false;

  for (const ch of text) {
    if (ch in DIGITS) {
      current = DIGITS[ch];
      sawAny = true;
      continue;
    }
    const unit = UNITS[ch];
    if (unit === undefined) return null;
    // A bare unit means one of it: 십 = 10, not 0.
    total += (current === 0 ? 1 : current) * unit;
    current = 0;
    sawAny = true;
  }

  if (!sawAny) return null;
  return total + current;
}

/**
 * Read a chapter/verse number written either as digits or as a Sino-Korean
 * numeral.
 */
export function parseNumberToken(token: string): number | null {
  const text = token.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const n = Number.parseInt(text, 10);
    return Number.isSafeInteger(n) ? n : null;
  }
  return parseSinoNumeral(text);
}
