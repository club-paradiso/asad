/** Deterministic critical-value extraction and source/translation comparison. */
import type {
  CriticalValue,
  CriticalValueKind,
  IntegrityIssue,
  TranslationIntegrity,
} from "./types";

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

const CURRENCY: Record<string, string> = {
  "₩": "KRW",
  원: "KRW",
  krw: "KRW",
  "$": "USD",
  달러: "USD",
  usd: "USD",
  "€": "EUR",
  eur: "EUR",
  "£": "GBP",
  gbp: "GBP",
  "¥": "JPY",
  엔: "JPY",
  jpy: "JPY",
  위안: "CNY",
  cny: "CNY",
};

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

function normalizeNumber(raw: string): string {
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
    if (parts.length > 2) value = parts.join("");
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return `${negative ? "-" : ""}${value}`;
  return String(negative ? -numeric : numeric);
}

function moneyKey(raw: string): string | null {
  const lower = raw.toLocaleLowerCase("en-US");
  const currency = Object.entries(CURRENCY).find(([token]) => lower.includes(token))?.[1];
  const number = raw.match(/[+-]?\d[\d\s,.]*/)?.[0];
  return currency && number ? `${currency}:${normalizeNumber(number)}` : null;
}

function timeKey(raw: string): string | null {
  const normalized = raw.normalize("NFKC").trim();
  const colon = normalized.match(/(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i);
  const korean = normalized.match(/(?:(오전|오후)\s*)?(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  const match = colon ?? korean;
  if (!match) return null;

  let hour = Number(colon ? match[1] : match[2]);
  const minute = Number(colon ? match[2] : match[3] ?? 0);
  const meridiem = colon ? match[3]?.toLowerCase().replace(/\./g, "") : match[1];
  if (meridiem === "pm" || meridiem === "오후") hour = hour % 12 + 12;
  if ((meridiem === "am" || meridiem === "오전") && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

function identityKey(raw: string): string {
  return raw.normalize("NFKC").toLocaleUpperCase("en-US").replace(/[^\p{L}\p{N}+]/gu, "");
}

function nameKey(raw: string): string {
  return raw.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, "");
}

export function extractCriticalValues(text: string): CriticalValue[] {
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

  collect(
    "money",
    /(?:[₩$€£¥]\s*[+-]?\d[\d\s,.]*|[+-]?\d[\d\s,.]*\s*(?:원|KRW|달러|USD|EUR|GBP|JPY|엔|위안|CNY))\b/giu,
    (raw) => moneyKey(raw),
  );

  collect("date", /\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/g, (_raw, match) =>
    dateKey(Number(match[1]), Number(match[2]), Number(match[3])),
  );
  collect("date", /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, (_raw, match) =>
    dateKey(Number(match[1]), Number(match[2]), Number(match[3])),
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
  collect("date", /(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, (_raw, match) =>
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
    /\b\d{1,2}:\d{2}\s*(?:[AaPp]\.?[Mm]\.?)?\b|(?<![\d.])(?:오전|오후)?\s*\d{1,2}\s*시(?!간)(?:\s*\d{1,2}\s*분)?/g,
    (raw) => timeKey(raw),
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

  const stopNames = new Set(["thankyou", "goodmorning", "goodafternoon", "goodevening", "excuseme", "pleasewait"]);
  collect("name", /\b[A-Z][a-z]{1,24}(?:\s+[A-Z][a-z]{1,24})+\b/g, (raw) => {
    const normalized = nameKey(raw);
    return stopNames.has(normalized) ? null : normalized;
  });

  collect("decimal", /(?<![\p{L}\p{N}])[+-]?\d+[.,]\d+(?!\d)/gu, (raw) =>
    normalizeNumber(raw),
  );
  collect("integer", /(?<![\p{L}\p{N}.,])[+-]?\d+(?!\d|[.,]\d)/gu, (raw) =>
    normalizeNumber(raw),
  );

  return values
    .sort((left, right) => left.start - right.start)
    .map(({ kind, text: raw, normalized }) => ({ kind, text: raw, normalized }));
}

const matches = (source: CriticalValue, target: CriticalValue, targetText: string): boolean => {
  if (source.kind === "name") {
    return nameKey(targetText).includes(source.normalized);
  }
  return source.kind === target.kind && source.normalized === target.normalized;
};

export function validateTranslationIntegrity(
  sourceText: string,
  targetText: string,
): TranslationIntegrity {
  const source = extractCriticalValues(sourceText);
  const target = extractCriticalValues(targetText);
  const used = new Set<number>();
  const issues: IntegrityIssue[] = [];

  for (const value of source) {
    const found = target.findIndex(
      (candidate, index) => !used.has(index) && matches(value, candidate, targetText),
    );
    if (found >= 0) {
      used.add(found);
      continue;
    }

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
    issues.push({ kind: value.kind, sourceText: "", targetText: value.text, reason: "added" });
  });

  return { status: issues.length ? "mismatch" : "verified", issues };
}
