/**
 * Confirmation-worthy spans.
 *
 * At a counter the errors that actually hurt are numbers and names: a time
 * heard as 13:00 instead of 3:00, a price with a digit dropped, a surname
 * mangled past recognition. Everything else is usually recoverable by asking
 * again; those are not, because both parties walk away believing they agreed.
 *
 * So these are detected in the TRANSLATED text and surfaced for read-back,
 * rather than trusted. Deterministic and local — no model call, no latency.
 */
import type { RiskSpan } from "./types";

/** Ordered most-specific first; earlier patterns claim their characters. */
const PATTERNS: Array<{ kind: RiskSpan["kind"]; re: RegExp }> = [
  // Times: 3:00, 15:30, 3 PM, 오후 3시, 3시 30분
  { kind: "time", re: /\b\d{1,2}:\d{2}\s*(?:[AaPp]\.?[Mm]\.?)?\b/g },
  { kind: "time", re: /\b\d{1,2}\s*[AaPp]\.?[Mm]\.?\b/g },
  { kind: "time", re: /(?:오전|오후|아침|저녁)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?/g },
  // Money: ₩50,000 / 50,000원 / $30 / 30 USD
  { kind: "money", re: /[₩$€£¥]\s?\d[\d,.]*/g },
  { kind: "money", re: /\d[\d,.]*\s*(?:원|won|달러|USD|KRW|EUR|JPY|엔|위안)\b/gi },
  // Dates: 2026-08-24, 8/24, 8월 24일, 24 August
  { kind: "date", re: /\b\d{4}[-./]\d{1,2}[-./]\d{1,2}\b/g },
  { kind: "date", re: /\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b/g },
  { kind: "date", re: /\d{1,2}\s*월\s*\d{1,2}\s*일/g },
  {
    kind: "date",
    re: /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/gi,
  },
  // Bare numbers worth confirming: 2+ digits, or any digit run with separators.
  { kind: "number", re: /\b\d[\d,\-+()\s]{1,}\d\b/g },
  { kind: "number", re: /\b\d{2,}\b/g },
];

/**
 * Latin-script capitalised runs that are probably names.
 *
 * Deliberately conservative: only fires on two or more consecutive capitalised
 * words, and skips a run that starts the sentence, because a false "confirm
 * this name" prompt on the word "Please" trains people to ignore the feature.
 */
const NAME_RE = /(?<![.!?]\s)\b([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})+)\b/g;

const NAME_STOPWORDS = new Set([
  "Thank You",
  "Good Morning",
  "Good Afternoon",
  "Good Evening",
  "Excuse Me",
  "Please Wait",
]);

export function detectRisks(text: string): RiskSpan[] {
  if (!text.trim()) return [];

  const claimed = new Array<boolean>(text.length).fill(false);
  const out: RiskSpan[] = [];

  const claim = (start: number, end: number): boolean => {
    for (let i = start; i < end; i += 1) if (claimed[i]) return false;
    for (let i = start; i < end; i += 1) claimed[i] = true;
    return true;
  };

  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const value = match[0].trim();
      if (!value) continue;
      if (claim(match.index, match.index + match[0].length)) {
        out.push({ text: value, kind });
      }
    }
  }

  NAME_RE.lastIndex = 0;
  let nameMatch: RegExpExecArray | null;
  while ((nameMatch = NAME_RE.exec(text)) !== null) {
    const value = nameMatch[1];
    if (NAME_STOPWORDS.has(value)) continue;
    if (claim(nameMatch.index, nameMatch.index + value.length)) {
      out.push({ text: value, kind: "name" });
    }
  }

  // Cap it: highlighting nine things is the same as highlighting nothing.
  return out.slice(0, 6);
}

/**
 * A short read-back line for the confirm action.
 *
 * Sent as its own message so the other party sees only the values in question,
 * not the whole sentence again.
 */
export function buildConfirmationText(risks: Array<Pick<RiskSpan, "text">>): string {
  if (risks.length === 0) return "";
  return risks.map((r) => r.text).join(" · ");
}
