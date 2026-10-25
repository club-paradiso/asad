/** Deterministic critical-value extraction and source/translation comparison. */
import type {
  CriticalValue,
  CriticalValueKind,
  IntegrityIssue,
  TranslationIntegrity,
} from "./types";
import { isResidenceStatusCode } from "./domain-vocabulary";
import { compareNegation } from "./negation";
import { softNumbers } from "./number-words";

interface Candidate extends CriticalValue {
  start: number;
  end: number;
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const LOCAL_MONTHS: Record<string, number> = {
  ...MONTHS,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12,
  yanvarya: 1, января: 1, fevralya: 2, февраля: 2, marta: 3, марта: 3,
  aprelya: 4, апреля: 4, maya: 5, мая: 5, iyunya: 6, июня: 6, iyulya: 7,
  июля: 7, avgusta: 8, августа: 8, sentyabrya: 9, сентября: 9, oktyabrya: 10,
  октября: 10, noyabrya: 11, ноября: 11, dekabrya: 12, декабря: 12,
  januari: 1, februari: 2, maret: 3, mei: 5, juni: 6, juli: 7, agustus: 8,
  oktober: 10, november: 11, desember: 12,
  ocak: 1, şubat: 2, subat: 2, mart: 3, nisan: 4, mayıs: 5, mayis: 5,
  haziran: 6, temmuz: 7, ağustos: 8, agustos: 8, eylül: 9, eylul: 9,
  ekim: 10, kasım: 11, kasim: 11, aralık: 12, aralik: 12,
  يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, مايو: 5, يونيو: 6,
  يوليو: 7, أغسطس: 8, اغسطس: 8, سبتمبر: 9, أكتوبر: 10, اكتوبر: 10,
  نوفمبر: 11, ديسمبر: 12,
  जनवरी: 1, फ़रवरी: 2, फरवरी: 2, मार्च: 3, अप्रैल: 4, मई: 5, जून: 6,
  जुलाई: 7, अगस्त: 8, सितंबर: 9, सितम्बर: 9, अक्टूबर: 10, नवंबर: 11,
  नवम्बर: 11, दिसंबर: 12, दिसम्बर: 12,
};

const localMonth = (raw: string): number | undefined =>
  LOCAL_MONTHS[raw.normalize("NFKC").toLocaleLowerCase("und").replace(/[.'’]/g, "")];

/**
 * Currency markers, longest first where one is a prefix of another.
 *
 * The English words matter as much as the symbols: a faithful rendering of
 * "50,000원" is "50,000 won" far more often than "₩50,000", and until the word
 * was here that rendering was reported as a lost amount on every fee a desk
 * quoted.
 */
const CURRENCY: Record<string, string> = {
  "₩": "KRW",
  원: "KRW",
  krw: "KRW",
  won: "KRW",
  "$": "USD",
  달러: "USD",
  usd: "USD",
  dollars: "USD",
  dollar: "USD",
  "€": "EUR",
  eur: "EUR",
  euros: "EUR",
  euro: "EUR",
  "£": "GBP",
  gbp: "GBP",
  pounds: "GBP",
  pound: "GBP",
  "¥": "JPY",
  엔: "JPY",
  jpy: "JPY",
  yen: "JPY",
  円: "JPY",
  위안: "CNY",
  cny: "CNY",
  yuan: "CNY",
  rmb: "CNY",
  元: "CNY",
  ウォン: "KRW", 韩元: "KRW", 韓元: "KRW", вон: "KRW", von: "KRW", วอน: "KRW", وون: "KRW", वोन: "KRW",
  ドル: "USD", 美元: "USD", доллар: "USD", долларов: "USD", dollar_: "USD",
  ユーロ: "EUR", 欧元: "EUR", 歐元: "EUR", евро: "EUR",
  日元: "JPY",
  人民币: "CNY", 人民幣: "CNY",
};
const CURRENCY_WORDS =
  "won|dollars?|euros?|pounds?|yen|yuan|rmb|ウォン|韩元|韓元|вон|von|วอน|وون|वोन|ドル|美元|доллар(?:ов|а)?|ユーロ|欧元|歐元|евро|日元|人民币|人民幣";

const DURATION_UNITS: Record<string, string> = {
  일: "d", day: "d", days: "d", 天: "d", 日間: "d", ngày: "d",
  주: "w", 주일: "w", week: "w", weeks: "w", 周: "w", 週: "w", tuần: "w",
  개월: "m", 달: "m", month: "m", months: "m", 个月: "m", 個月: "m", ヶ月: "m", か月: "m", tháng: "m",
  년: "y", year: "y", years: "y", 年間: "y", năm: "y",
  시간: "h", hour: "h", hours: "h", 小时: "h", 小時: "h", 時間: "h", giờ: "h",
  분: "min", minute: "min", minutes: "min", 分钟: "min", 分鐘: "min", phút: "min",
};

const NAME_STOP_PHRASES = new Set([
  "thankyou", "goodmorning", "goodafternoon", "goodevening", "excuseme", "pleasewait",
]);

/**
 * Words that mark a capitalised run as a term rather than a person.
 *
 * The English side of the immigration glossary, weekday and month names, and
 * the title-case nouns a service desk writes in every other sentence.
 */
const ADMINISTRATIVE_TITLE_WORDS = new Set([
  "alien", "registration", "card", "residence", "immigration", "office", "form",
  "application", "certificate", "visa", "permit", "status", "period", "stay",
  "extension", "change", "report", "workplace", "address", "center", "centre",
  "service", "insurance", "health", "national", "pension", "tax", "bank", "account",
  "passport", "appointment", "fee", "document", "documents", "deadline", "integrated",
  "foreigner", "foreign", "resident", "number", "counter", "desk", "please", "thank",
  "hello", "good", "morning", "afternoon", "evening", "welcome", "sorry", "yes", "no",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december", "korea", "korean", "seoul",
  "hikorea", "arc", "ministry", "justice", "department", "online", "website",
]);

/**
 * East Asian numeral scales: 6만 원 is 60,000 won, 2천만 is 20,000,000.
 *
 * Korean, Japanese and Chinese amounts are spoken and written with these
 * multipliers; a validator that reads "6만" as the integer 6 reports the
 * correct "60,000 won" as both a lost amount and an invented one. Each digit
 * group carries its own full multiplier (3만 5천 = 30,000 + 5,000), which is
 * how spoken amounts at a counter are actually composed.
 */
const SCALE_UNITS: Record<string, number> = {
  억: 1e8, 億: 1e8, 亿: 1e8,
  만: 1e4, 万: 1e4, 萬: 1e4,
  천: 1e3, 千: 1e3,
  백: 1e2, 百: 1e2,
};
const SCALE_CHARS = Object.keys(SCALE_UNITS).join("");
const SCALED_NUMBER_RE = new RegExp(
  `(\\d[\\d,.]*)\\s*([${SCALE_CHARS}]+)`,
  "gu",
);
/** A run of scaled groups, an optional plain tail, and an optional currency. */
const SCALED_AMOUNT_RE = new RegExp(
  `((?:\\d[\\d,.]*\\s*[${SCALE_CHARS}]+\\s*)+)(\\d[\\d,.]*)?\\s*(원|달러|엔|위안|円|元|₩|ウォン|韩元|韓元|ドル|美元|ユーロ|欧元|歐元|日元|人民币|人民幣)?`,
  "gu",
);

function scaledValue(groups: string, tail: string | undefined): number | null {
  let total = 0;
  SCALED_NUMBER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCALED_NUMBER_RE.exec(groups)) !== null) {
    const digits = Number(normalizeNumber(match[1]));
    if (!Number.isFinite(digits)) return null;
    let multiplier = 1;
    for (const unit of match[2]) multiplier *= SCALE_UNITS[unit] ?? 1;
    total += digits * multiplier;
  }
  if (tail) {
    const plain = Number(normalizeNumber(tail));
    if (!Number.isFinite(plain)) return null;
    total += plain;
  }
  return total;
}

const pad = (value: number) => String(value).padStart(2, "0");

function validDate(year: number, month: number, day: number): boolean {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
}

function dateKey(year: number, month: number, day: number): string | null {
  return validDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;
}

function partialDateKey(month: number, day: number): string | null {
  return validDate(2000, month, day) ? `--${pad(month)}-${pad(day)}` : null;
}

function normalizeNumber(raw: string, options: { money?: boolean } = {}): string {
  let value = raw.normalize("NFKC").replace(/\s/g, "");
  const negative = value.startsWith("-");
  value = value.replace(/^[+-]/, "");
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? /\./g : /,/g;
    value = value.replace(thousands, "").replace(decimal, ".");
  } else if (lastComma >= 0) {
    const parts = value.split(",");
    value = parts.length > 2 || parts.at(-1)?.length === 3
      ? parts.join("")
      : `${parts[0]}.${parts[1]}`;
  } else if (lastDot >= 0) {
    const parts = value.split(".");
    // "30.000 won" is thirty thousand in Indonesian, Vietnamese, German and
    // most of Europe; an amount is never quoted to three decimal places.
    if (parts.length > 2 || (options.money && parts.at(-1)?.length === 3)) value = parts.join("");
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return `${negative ? "-" : ""}${value}`;
  return String(negative ? -numeric : numeric);
}

function moneyKey(raw: string): string | null {
  const lower = raw.toLocaleLowerCase("en-US");
  // Longest marker first: "dollars" before "dollar", "韩元" before "元".
  const currency = Object.entries(CURRENCY)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([token]) => lower.includes(token))?.[1];
  const number = raw.match(/[+-]?\d[\d\s,.]*/)?.[0];
  return currency && number ? `${currency}:${normalizeNumber(number, { money: true })}` : null;
}

/**
 * Times normalise to HH:MM. A bare hour with no meridiem — "3시", "3 giờ",
 * "3時" — is prefixed with "~": it is a genuine ambiguity in the source, and
 * "3 PM" is a faithful reading of it, not a changed value. "오후 3시" is not
 * ambiguous and still has to come out as 15:00.
 */
function timeKey(raw: string): string | null {
  const normalized = raw.normalize("NFKC").trim();
  // 15:30, 3:00 PM, 3 PM, 3pm, 3 p.m., 3 o'clock
  const latin = normalized.match(
    /(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?\s?m\.?|(o['’]clock))?/i,
  );
  // 오후 3시 30분 · 3시 반 · 午後3時半 · 下午3点30分 · 3 giờ 30 · 3 giờ rưỡi
  const asian = normalized.match(
    /(?:(오전|오후|아침|저녁|밤|午前|午後|上午|下午|晚上|早上|sáng|chiều|tối|trưa)\s*)?(\d{1,2})\s*(?:시|時|时|点|點|giờ)(?:\s*(\d{1,2})\s*(?:분|分|phút)?|\s*(반|半|rưỡi))?/,
  );
  // Vietnamese "3 giờ" is three hours as often as three o'clock. It is a clock
  // time only with a clock marker: "lúc"/"vào", minutes, rưỡi, or a part of
  // the day. Without one the span is left for the duration collector.
  if (asian && /giờ/.test(asian[0])) {
    const clockMarked =
      asian[1] !== undefined ||
      asian[3] !== undefined ||
      asian[4] !== undefined ||
      /(?:lúc|vào)\s*$/.test(normalized.slice(0, asian.index)) ||
      /giờ\s*(?:sáng|chiều|tối|trưa)/.test(normalized);
    if (!clockMarked) return null;
  }
  // दोपहर 3 बजे · 3:30 बजे · साँझ 5 बजे
  const indic = normalized.match(
    /(?:(सुबह|बिहान|दोपहर|दिउँसो|शाम|साँझ|रात|राति)\s*)?(\d{1,2})(?::(\d{2}))?\s*बजे/,
  );
  const asianAfter = normalized.match(
    /(\d{1,2})\s*(?:giờ)(?:\s*(\d{1,2}))?\s*(sáng|chiều|tối|trưa)/,
  );
  const latinUsable =
    latin && (latin[2] !== undefined || latin[3] !== undefined || latin[4] !== undefined);
  const match = asian ?? indic ?? (latinUsable ? latin : null);
  if (!match) return null;

  let hour: number;
  let minute: number;
  let meridiem: string | undefined;
  if (match === indic) {
    hour = Number(indic[2]);
    minute = Number(indic[3] ?? 0);
    meridiem = indic[1];
  } else if (match === asian) {
    hour = Number(asian[2]);
    minute = asian[4] ? 30 : Number(asian[3] ?? 0);
    meridiem = asian[1] ?? asianAfter?.[3];
  } else {
    hour = Number(latin![1]);
    minute = Number(latin![2] ?? 0);
    meridiem = latin![3]?.toLowerCase() === "p" ? "pm" : latin![3] ? "am" : undefined;
  }
  const pm = new Set(["pm", "오후", "저녁", "밤", "午後", "下午", "晚上", "chiều", "tối", "दोपहर", "दिउँसो", "शाम", "साँझ", "रात", "राति"]);
  const am = new Set(["am", "오전", "아침", "午前", "上午", "早上", "sáng", "सुबह", "बिहान"]);
  if (meridiem && pm.has(meridiem) && hour < 12) hour += 12;
  if (meridiem && am.has(meridiem) && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const ambiguous =
    !meridiem && hour >= 1 && hour <= 12 && (match === asian || match === indic || latin?.[4] !== undefined);
  return `${ambiguous ? "~" : ""}${pad(hour)}:${pad(minute)}`;
}

/** Two time keys agree when exact, or when the ambiguous one fits the other's hour. */
function timesAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const strip = (key: string) => key.replace(/^~/, "");
  const [ha, ma] = strip(a).split(":").map(Number);
  const [hb, mb] = strip(b).split(":").map(Number);
  if (ma !== mb) return false;
  if (!a.startsWith("~") && !b.startsWith("~")) return false;
  return ha % 12 === hb % 12;
}

function identityKey(raw: string): string {
  return raw.normalize("NFKC").toLocaleUpperCase("en-US").replace(/[^\p{L}\p{N}+]/gu, "");
}

function nameKey(raw: string): string {
  return raw.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, "");
}

export function extractCriticalValues(text: string, language?: string): CriticalValue[] {
  if (!text.trim()) return [];
  const claimed = new Array<boolean>(text.length).fill(false);
  const values: Candidate[] = [];

  const add = (
    kind: CriticalValueKind,
    raw: string,
    start: number,
    normalized: string | null,
  ) => {
    if (!normalized) return;
    const end = start + raw.length;
    if (claimed.slice(start, end).some(Boolean)) return;
    for (let index = start; index < end; index += 1) claimed[index] = true;
    values.push({ kind, text: raw.trim(), normalized, start, end });
  };

  const collect = (
    kind: CriticalValueKind,
    pattern: RegExp,
    normalize: (raw: string, match: RegExpExecArray) => string | null,
  ) => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      add(kind, match[0], match.index, normalize(match[0], match));
    }
  };

  // First, because every later pattern would take a piece of it: the integer
  // collector reads E-7 as the number 7, at which point E-7 and F-7 compare
  // equal and a changed visa category passes as verified.
  collect(
    "status-code",
    // A hyphen is optional because speech-to-text writes "E7" as often as
    // "E-7", and the various Unicode dashes all mean the same thing here.
    // Boundary is Latin-only: Korean attaches particles straight onto the code
    // ("D-2에서"), and a Unicode letter boundary would skip every Korean turn.
    /(?<![A-Za-z0-9])([A-Ha-h])[-\u2010\u2011\u2012\u2013\u2014]?(10|[1-9])(?![A-Za-z0-9])/gu,
    (_raw, match) =>
      isResidenceStatusCode(match[1], match[2])
        ? `${match[1].toUpperCase()}-${match[2]}`
        : null,
  );

  // Scaled East Asian amounts claim their characters before the plain money
  // and integer collectors can read "6만 원" as the integer 6.
  SCALED_AMOUNT_RE.lastIndex = 0;
  let scaled: RegExpExecArray | null;
  while ((scaled = SCALED_AMOUNT_RE.exec(text)) !== null) {
    const [whole, groups, tail, currency] = scaled;
    // A plain number after the scaled groups only belongs to the amount when
    // a currency follows it: "3만 500원" is one sum, "3만 2장" is not.
    const consumed = tail && !currency ? groups : whole;
    if (tail && !currency) SCALED_AMOUNT_RE.lastIndex = scaled.index + groups.length;
    const value = scaledValue(groups, tail && currency ? tail : undefined);
    if (value === null) continue;
    const code = currency ? CURRENCY[currency] : undefined;
    add(
      code ? "money" : "integer",
      consumed,
      scaled.index,
      code ? `${code}:${value}` : String(value),
    );
  }

  collect(
    "money",
    new RegExp(
      `(?:[₩$€£¥]\\s*[+-]?\\d[\\d\\s,.]*|[+-]?\\d[\\d\\s,.]*\\s*(?:(?:원|달러|엔|위안|円|元)|(?:KRW|USD|EUR|GBP|JPY|CNY|RMB|${CURRENCY_WORDS})(?![\\p{L}])))`,
      "giu",
    ),
    (raw) => moneyKey(raw),
  );

  collect("date", /\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/g, (_raw, match) =>
    dateKey(Number(match[1]), Number(match[2]), Number(match[3])),
  );
  collect("date", /(\d{4})\s*[년年]\s*(\d{1,2})\s*[월月]\s*(\d{1,2})\s*[일日]/g, (_raw, match) =>
    dateKey(Number(match[1]), Number(match[2]), Number(match[3])),
  );
  collect(
    "date",
    /(?<!\d)(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?!\d)/g,
    (_raw, match) => {
      const monthFirst = language?.toLowerCase() === "en-us";
      return dateKey(
        Number(match[3]),
        Number(monthFirst ? match[1] : match[2]),
        Number(monthFirst ? match[2] : match[1]),
      );
    },
  );
  collect(
    "date",
    /(?<!\p{L})(\d{1,2})\s+(?:de\s+)?([\p{L}.'’]+)\s+(?:de\s+)?(\d{4})(?!\d)/giu,
    (_raw, match) => {
      const month = localMonth(match[2]);
      return month ? dateKey(Number(match[3]), month, Number(match[1])) : null;
    },
  );
  collect(
    "date",
    /(?<!\p{L})([\p{L}.'’]+)\s+(\d{1,2})[,]?\s+(\d{4})(?!\d)/giu,
    (_raw, match) => {
      const month = localMonth(match[1]);
      return month ? dateKey(Number(match[3]), month, Number(match[2])) : null;
    },
  );
  collect(
    "date",
    /ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/giu,
    (_raw, match) => dateKey(Number(match[3]), Number(match[2]), Number(match[1])),
  );
  collect(
    "date",
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/gi,
    (_raw, match) => dateKey(Number(match[3]), MONTHS[match[1].toLowerCase()], Number(match[2])),
  );
  collect(
    "date",
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,]?\s+(\d{4})\b/gi,
    (_raw, match) => dateKey(Number(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1])),
  );
  collect(
    "date",
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+of\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,]?\s+(\d{4})\b/gi,
    (_raw, match) => dateKey(Number(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1])),
  );
  collect(
    "date",
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+of\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/gi,
    (_raw, match) => partialDateKey(MONTHS[match[2].toLowerCase()], Number(match[1])),
  );
  collect("date", /(\d{1,2})\s*[월月]\s*(\d{1,2})\s*[일日]/g, (_raw, match) =>
    partialDateKey(Number(match[1]), Number(match[2])),
  );
  collect(
    "date",
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi,
    (_raw, match) => partialDateKey(MONTHS[match[1].toLowerCase()], Number(match[2])),
  );
  collect(
    "date",
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/gi,
    (_raw, match) => partialDateKey(MONTHS[match[2].toLowerCase()], Number(match[1])),
  );
  collect("date", /\b(\d{1,2})\/(\d{1,2})\b/g, (_raw, match) =>
    partialDateKey(Number(match[1]), Number(match[2])),
  );

  collect(
    "time",
    /(?<![\d:])\d{1,2}(?::\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?(?![A-Za-z])|o['’]clock)|\b\d{1,2}:\d{2}\b|(?<![\d.])(?:오전|오후|아침|저녁|밤|午前|午後|上午|下午|晚上|早上)?\s*\d{1,2}\s*(?:시(?!간)|時(?!間)|时(?!间)|点|點)(?:\s*\d{1,2}\s*(?:분|分)|\s*(?:반|半))?|(?<![\d.])(?:(?:lúc|vào)\s+)?(?:(?:sáng|chiều|tối|trưa)\s*)?\d{1,2}\s*giờ(?:\s*\d{1,2}(?:\s*phút)?|\s*rưỡi)?(?:\s*(?:sáng|chiều|tối|trưa))?|(?<![\d.])(?:(?:सुबह|बिहान|दोपहर|दिउँसो|शाम|साँझ|रात|राति)\s*)?\d{1,2}(?::\d{2})?\s*बजे/gu,
    (raw) => timeKey(raw),
  );

  // Durations: "15일 이내" and "within 15 weeks" share a number and differ by
  // the one thing that decides whether a deadline was met. Only languages
  // with a unit table produce the kind; elsewhere the number stays an
  // integer and the comparison relaxes to the number alone.
  collect(
    "duration",
    /(?<![\d.,])(\d+)\s*(일(?=\s*(?:이내|내에|동안|후|뒤|안에|간|이상|이하|정도|쯤|까지))|주일|주|개월|달|년|시간|분(?=\s*(?:이내|내에|동안|후|뒤|안에|간|정도|쯤)))|(?<![\d.,])(\d+)\s*(days?|weeks?|months?|years?|hours?|minutes?)(?![\p{L}])|(?<![\d.,])(\d+)\s*(天|日間|周|週|个月|個月|ヶ月|か月|年間|小时|小時|時間|分钟|分鐘)|(?<![\d.,])(\d+)\s*(ngày|tuần|tháng|năm|giờ|phút)(?![\p{L}])/giu,
    (_raw, match) => {
      const amount = Number(match[1] ?? match[3] ?? match[5] ?? match[7]);
      const unit = (match[2] ?? match[4] ?? match[6] ?? match[8]).toLowerCase();
      const code = DURATION_UNITS[unit];
      return code ? `${amount}${code}` : null;
    },
  );

  collect("phone", /\+?\d[\d\s().-]{6,}\d/g, (raw) => {
    const digits = raw.replace(/\D/g, "");
    return digits.length >= 8 && /[+\s().-]/.test(raw) ? `${raw.trim().startsWith("+") ? "+" : ""}${digits}` : null;
  });

  collect(
    "identifier",
    /\b(?=[A-Z0-9-]{5,}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi,
    (raw) => identityKey(raw),
  );
  collect(
    "identifier",
    /(?<![\p{L}\p{N}])\p{L}{1,3}-?\d{5,}(?![\p{L}\p{N}])/gu,
    (raw) => identityKey(raw),
  );
  collect("identifier", /\b\d{6,}\b/g, (raw) => identityKey(raw));

  collect("name", /\b[A-Z][a-z]{1,24}(?:\s+[A-Z][a-z]{1,24})+\b/g, (raw) => {
    const normalized = nameKey(raw);
    if (NAME_STOP_PHRASES.has(normalized)) return null;
    // "Alien Registration Card" and "Immigration Office" are title-cased
    // administrative terms, not people. A Korean rendering of them has no
    // Latin letters to keep, and reporting each one as a lost name made the
    // warning fire on the vocabulary this desk uses most.
    if (raw.split(/\s+/).some((word) => ADMINISTRATIVE_TITLE_WORDS.has(word.toLowerCase()))) {
      return null;
    }
    return normalized;
  });

  // Adjacency to a LATIN letter hides a digit (A4, COVID19); adjacency to any
  // other script does not — Korean, Japanese and Chinese write "3番", "10월"
  // and "下午3点" with nothing between the digit and the word.
  collect("decimal", /(?<![A-Za-z0-9])[+-]?\d+[.,]\d+(?!\d)/gu, (raw) => normalizeNumber(raw));
  collect("integer", /(?<![A-Za-z0-9.,])[+-]?\d+(?!\d|[.,]\d)/gu, (raw) => normalizeNumber(raw));

  return values
    .sort((left, right) => left.start - right.start)
    .map(({ kind, text: raw, normalized }) => ({ kind, text: raw, normalized }));
}

const matches = (source: CriticalValue, target: CriticalValue, targetText: string): boolean => {
  if (source.kind === "name") {
    return nameKey(targetText).includes(source.normalized);
  }
  if (source.kind !== target.kind) return false;
  if (source.kind === "time") return timesAgree(source.normalized, target.normalized);
  return source.normalized === target.normalized;
};

/**
 * A duration can only be compared with a duration. When the other side's
 * language produced none — no unit table, or a rendering that spelled the
 * unit out — the number alone is still worth checking, so the value is
 * compared as the integer it would otherwise have been.
 */
function relaxDurations(own: CriticalValue[], other: CriticalValue[]): CriticalValue[] {
  if (other.some((value) => value.kind === "duration")) return own;
  return own.map((value) =>
    value.kind === "duration"
      ? { ...value, kind: "integer", normalized: value.normalized.replace(/[a-z]+$/, "") }
      : value,
  );
}

export function validateTranslationIntegrity(
  sourceText: string,
  targetText: string,
  sourceLanguage?: string,
  targetLanguage?: string,
): TranslationIntegrity {
  const source = relaxDurations(
    extractCriticalValues(sourceText, sourceLanguage),
    extractCriticalValues(targetText, targetLanguage),
  );
  const target = relaxDurations(
    extractCriticalValues(targetText, targetLanguage),
    extractCriticalValues(sourceText, sourceLanguage),
  );
  const used = new Set<number>();
  const issues: IntegrityIssue[] = [];

  // Numbers written as words. They can only ever SATISFY a check, never raise
  // one: "two copies" answers for "2부", but "one moment, please" must not be
  // reported as an invented quantity when the source said "잠시만요".
  const sourceWords = softNumbers(sourceText, sourceLanguage);
  const targetWords = softNumbers(targetText, targetLanguage);
  const consumeWord = (words: number[], value: string): boolean => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return false;
    const at = words.indexOf(numeric);
    if (at === -1) return false;
    words.splice(at, 1);
    return true;
  };

  // Checked before the values, because a reversed negation is the finding a
  // reader most needs to see first.
  const negation = compareNegation(sourceText, targetText, sourceLanguage, targetLanguage);
  if (negation === "dropped") {
    issues.push({ kind: "negation", sourceText, targetText, reason: "missing" });
  } else if (negation === "added") {
    issues.push({ kind: "negation", sourceText: "", targetText, reason: "added" });
  }

  for (const value of source) {
    const found = target.findIndex(
      (candidate, index) => !used.has(index) && matches(value, candidate, targetText),
    );
    if (found >= 0) {
      used.add(found);
      continue;
    }

    if (value.kind === "integer" && consumeWord(targetWords, value.normalized)) continue;

    const changed = target.findIndex(
      (candidate, index) => !used.has(index) && candidate.kind === value.kind,
    );
    if (changed >= 0 && value.kind !== "name") {
      used.add(changed);
      issues.push({
        kind: value.kind,
        sourceText: value.text,
        targetText: target[changed].text,
        reason: "changed",
      });
    } else {
      issues.push({ kind: value.kind, sourceText: value.text, reason: "missing" });
    }
  }

  target.forEach((value, index) => {
    if (used.has(index) || value.kind === "name") return;
    if (value.kind === "integer" && consumeWord(sourceWords, value.normalized)) return;
    issues.push({ kind: value.kind, sourceText: "", targetText: value.text, reason: "added" });
  });

  return { status: issues.length ? "mismatch" : "verified", issues };
}
