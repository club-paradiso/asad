/**
 * Numbers written as words.
 *
 * A faithful translation very often spells a small quantity out — "서류 3장"
 * becomes "three documents", "두 번째 창구" becomes "counter 2" — and the
 * digit-only extractor in `integrity.ts` reported every one of those as a lost
 * or invented number. That is the most common false positive the integrity
 * warning produced, and a warning that fires on correct translations trains
 * people to ignore it when it is right.
 *
 * These values are deliberately SOFT: they can satisfy a digit on the other
 * side of a translation, but they never raise an issue on their own. "One
 * moment, please" for "잠시만요" is not an invented quantity, and a Korean 한
 * in 한국 is not the number one. Keeping the words out of the hard extractor
 * is what makes the leniency safe: a dropped digit is still a dropped digit.
 *
 * Korean native numerals are only read when a counter word follows them,
 * because 세, 네, 한 and 열 are far more often syllables of ordinary words
 * (오세요, 네, 한국, 열다) than numbers.
 */

type WordTable = Readonly<Record<string, number>>;

const EN: WordTable = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
  ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, twice: 2,
  // Month names answer for a bare Korean "10월": October IS 10.
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
};

/** Space-delimited languages: matched as whole words, case-insensitively. */
const WORDS: Record<string, WordTable> = {
  en: EN,
  vi: { "một": 1, hai: 2, ba: 3, "bốn": 4, "năm": 5, "sáu": 6, "bảy": 7, "tám": 8, "chín": 9, "mười": 10 },
  ru: {
    один: 1, одна: 1, одно: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6,
    семь: 7, восемь: 8, девять: 9, десять: 10, первый: 1, второй: 2, третий: 3,
  },
  uk: {
    один: 1, одна: 1, два: 2, дві: 2, три: 3, чотири: 4, "п'ять": 5, шість: 6, сім: 7,
    вісім: 8, "дев'ять": 9, десять: 10,
  },
  es: {
    uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
    nueve: 9, diez: 10, primero: 1, primera: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3,
  },
  fr: {
    deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
    premier: 1, première: 1, deuxième: 2, troisième: 3,
  },
  de: {
    eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9,
    zehn: 10, erste: 1, zweite: 2, dritte: 3,
  },
  pt: {
    dois: 2, duas: 2, três: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
    dez: 10, primeiro: 1, primeira: 1, segundo: 2, segunda: 2, terceiro: 3, terceira: 3,
  },
  id: {
    satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8,
    sembilan: 9, sepuluh: 10, pertama: 1, kedua: 2, ketiga: 3,
  },
  tr: {
    bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10,
    birinci: 1, ikinci: 2, üçüncü: 3,
  },
  uz: {
    bir: 1, ikki: 2, uch: 3, "to'rt": 4, "toʻrt": 4, "to‘rt": 4, besh: 5, olti: 6, yetti: 7,
    sakkiz: 8, "to'qqiz": 9, "toʻqqiz": 9, "o'n": 10, "oʻn": 10,
  },
  tl: {
    isa: 1, dalawa: 2, tatlo: 3, apat: 4, lima: 5, anim: 6, pito: 7, walo: 8, siyam: 9,
    sampu: 10, una: 1, ikalawa: 2, pangalawa: 2, ikatlo: 3,
  },
  mn: {
    нэг: 1, хоёр: 2, гурав: 3, гурван: 3, дөрөв: 4, дөрвөн: 4, тав: 5, таван: 5,
    зургаа: 6, зургаан: 6, долоо: 7, долоон: 7, найм: 8, найман: 8, ес: 9, есөн: 9,
    арав: 10, арван: 10,
  },
  hi: { एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, सात: 7, आठ: 8, नौ: 9, दस: 10 },
  ne: { एक: 1, दुई: 2, तीन: 3, चार: 4, पाँच: 5, छ: 6, सात: 7, आठ: 8, नौ: 9, दस: 10 },
  bn: { এক: 1, দুই: 2, তিন: 3, চার: 4, পাঁচ: 5, ছয়: 6, সাত: 7, আট: 8, নয়: 9, দশ: 10 },
  ur: { ایک: 1, دو: 2, تین: 3, چار: 4, پانچ: 5, چھ: 6, سات: 7, آٹھ: 8, نو: 9, دس: 10 },
  ar: {
    واحد: 1, واحدة: 1, اثنان: 2, اثنين: 2, اثنتان: 2, ثلاثة: 3, ثلاث: 3, أربعة: 4, أربع: 4,
    خمسة: 5, خمس: 5, ستة: 6, ست: 6, سبعة: 7, سبع: 7, ثمانية: 8, ثماني: 8, تسعة: 9, تسع: 9,
    عشرة: 10, عشر: 10,
  },
};

/**
 * Scripts without word spacing: matched as substrings. 一 is left out on
 * purpose — it begins 一起, 一下 and a dozen other everyday words, and a soft
 * one that matches everywhere would quietly excuse a dropped "1".
 */
const SUBSTRINGS: Record<string, WordTable> = {
  zh: { 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 },
  ja: { 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 },
  th: { หนึ่ง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9, สิบ: 10 },
};

const KOREAN_NATIVE: WordTable = {
  하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7,
  여덟: 8, 아홉: 9, 열: 10, 스무: 20, 스물: 20,
};
/** Counter words a native numeral must be attached to before it counts. */
const KOREAN_COUNTERS =
  "명|분|개|장|부|번째|번|시간|시|달|주|개월|사람|곳|통|권|매|건|살|병|잔|줄|쌍|대|마리|가지|군데|차례|회";
const KOREAN_NATIVE_RE = new RegExp(
  `(${Object.keys(KOREAN_NATIVE).join("|")})\\s?(?:${KOREAN_COUNTERS})`,
  "gu",
);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const baseTag = (language: string | undefined) =>
  (language ?? "").trim().toLowerCase().split("-")[0];

/**
 * Every number spelled out in `text`, as values, in order of appearance.
 *
 * Duplicates are kept: "two copies and two photos" satisfies two separate 2s.
 */
export function softNumbers(text: string, language: string | undefined): number[] {
  const base = baseTag(language);
  const value = text.normalize("NFKC");
  const found: Array<{ at: number; value: number }> = [];

  const words = WORDS[base];
  if (words) {
    const lower = value.toLocaleLowerCase("en-US");
    for (const [word, number] of Object.entries(words)) {
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`,
        "giu",
      );
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(lower)) !== null) found.push({ at: match.index, value: number });
    }
  }

  const substrings = SUBSTRINGS[base];
  if (substrings) {
    for (const [token, number] of Object.entries(substrings)) {
      let from = 0;
      for (;;) {
        const at = value.indexOf(token, from);
        if (at === -1) break;
        found.push({ at, value: number });
        from = at + token.length;
      }
    }
  }

  if (base === "ko") {
    KOREAN_NATIVE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = KOREAN_NATIVE_RE.exec(value)) !== null) {
      found.push({ at: match.index, value: KOREAN_NATIVE[match[1]] });
    }
  }

  return found.sort((a, b) => a.at - b.at).map((entry) => entry.value);
}
