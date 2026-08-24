/**
 * Spoken Korean Bible reference detection and normalisation.
 *
 * Design rules:
 *  - Never guess. A reference that fails validation is dropped, not shown.
 *  - Ambiguous Korean forms (아가 "baby", 마, 요, 시) only match when a chapter
 *    number immediately follows, and resolve at lower confidence.
 *  - Chapter and verse are validated against the book's real chapter count.
 */
import type { BibleReference, Confidence } from "@/types";
import { BOOK_FORMS, type BibleBook } from "./books";
import { SINO_NUMERAL_PATTERN, parseNumberToken } from "./numerals";

const NUM = `(?:\\d{1,3}|${SINO_NUMERAL_PATTERN})`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const BOOK_ALTERNATION = BOOK_FORMS.map((f) => escape(f.form)).join("|");

/**
 * Matches the spoken forms:
 *   베드로전서 2장 9절
 *   베드로전서 2장 9절부터 11절까지
 *   시편 23편 1절
 *   요한복음 3:16
 *   로마서 5장
 */
const REFERENCE_RE = new RegExp(
  `(${BOOK_ALTERNATION})\\s*` +
    `(${NUM})\\s*(?:장|편|[:：])\\s*` +
    `(?:(${NUM})\\s*절?` +
    `(?:\\s*(?:부터|에서|~|-|–)\\s*(${NUM})\\s*절?(?:\\s*까지)?)?` +
    `)?`,
  "g",
);

export interface DetectedReference extends BibleReference {
  /** Character offset in the source text, used to de-duplicate. */
  index: number;
}

const buildDisplay = (
  book: string,
  chapter: number,
  verse?: number,
  verseEnd?: number,
): string => {
  if (verse === undefined) return `${book} ${chapter}`;
  if (verseEnd !== undefined && verseEnd > verse) {
    return `${book} ${chapter}:${verse}-${verseEnd}`;
  }
  return `${book} ${chapter}:${verse}`;
};

const gradeConfidence = (
  book: BibleBook,
  abbreviated: boolean,
  hasVerse: boolean,
): Confidence => {
  if (book.ambiguous) return hasVerse ? "medium" : "low";
  if (abbreviated) return hasVerse ? "medium" : "low";
  return hasVerse ? "high" : "medium";
};

/**
 * Find every Bible reference in a piece of recognised Korean speech.
 *
 * Returns an empty array rather than a speculative match when nothing is
 * confidently identifiable.
 */
export function detectScriptureReferences(text: string): DetectedReference[] {
  if (!text) return [];
  const out: DetectedReference[] = [];
  REFERENCE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = REFERENCE_RE.exec(text)) !== null) {
    const [raw, formText, chapterText, verseText, verseEndText] = match;
    const form = BOOK_FORMS.find((f) => f.form === formText);
    if (!form) continue;

    const chapter = parseNumberToken(chapterText);
    if (chapter === null || chapter < 1 || chapter > form.book.chapters) continue;

    const verse = verseText ? parseNumberToken(verseText) ?? undefined : undefined;
    if (verseText && verse === undefined) continue;
    if (verse !== undefined && (verse < 1 || verse > 200)) continue;

    let verseEnd = verseEndText ? parseNumberToken(verseEndText) ?? undefined : undefined;
    if (verseEnd !== undefined && verse !== undefined && verseEnd <= verse) {
      verseEnd = undefined;
    }

    // An ambiguous book form must be a real reference, not a stray syllable:
    // require a verse, or a full (non-abbreviated) spelling.
    if (form.book.ambiguous && form.abbreviated && verse === undefined) continue;

    out.push({
      book: form.book.en,
      chapter,
      verse,
      verseEnd,
      display: buildDisplay(form.book.en, chapter, verse, verseEnd),
      koreanRaw: raw.trim(),
      confidence: gradeConfidence(form.book, form.abbreviated, verse !== undefined),
      index: match.index,
    });
  }

  return dedupe(out);
}

const dedupe = (refs: DetectedReference[]): DetectedReference[] => {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.display)) return false;
    seen.add(ref.display);
    return true;
  });
};

/**
 * Parse an English reference typed into the prep sheet, e.g. "1 Peter 2:9".
 * Returns `null` when it cannot be read confidently.
 */
export function parseEnglishReference(input: string): BibleReference | null {
  const m = input
    .trim()
    .match(/^([1-3]?\s*[A-Za-z][A-Za-z\s]*?)\s*(\d{1,3})(?::(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)?$/);
  if (!m) return null;
  const [, bookRaw, chapterRaw, verseRaw, verseEndRaw] = m;
  const normalisedBook = bookRaw.replace(/\s+/g, " ").trim();
  const book = BOOK_FORMS.find(
    (f) => f.book.en.toLowerCase() === normalisedBook.toLowerCase(),
  )?.book;
  if (!book) return null;

  const chapter = Number.parseInt(chapterRaw, 10);
  if (chapter < 1 || chapter > book.chapters) return null;
  const verse = verseRaw ? Number.parseInt(verseRaw, 10) : undefined;
  let verseEnd = verseEndRaw ? Number.parseInt(verseEndRaw, 10) : undefined;
  if (verseEnd !== undefined && verse !== undefined && verseEnd <= verse) verseEnd = undefined;

  return {
    book: book.en,
    chapter,
    verse,
    verseEnd,
    display: buildDisplay(book.en, chapter, verse, verseEnd),
    confidence: "high",
  };
}
