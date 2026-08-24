/**
 * Bible provider contract.
 *
 * The default provider returns no verse text at all, and that is a deliberate
 * product decision rather than a limitation: NIV, ESV, NLT, NASB and NKJV are
 * all under copyright and none of them may be bundled or proxied without a
 * licence. A reference on screen is genuinely useful to an interpreter; an
 * invented verse is a disaster. So the rule is absolute — tong-yuck shows
 * verse wording only when a provider legally supplied it, and otherwise shows
 * the reference alone.
 */
import type { BibleReference } from "@/types";

export type BibleProviderId = "reference-only" | "public-domain" | "api-bible";

export interface BibleLookup {
  book: string;
  chapter: number;
  verse?: number;
  verseEnd?: number;
  /** Preferred translation code, e.g. "WEB". */
  translation?: string;
}

export interface BibleProvider {
  readonly id: BibleProviderId;
  /** Translations this provider can legally serve. */
  readonly translations: string[];
  /**
   * Resolve a reference. Always returns the normalised reference; `text` is
   * present only when the provider legally has it.
   */
  lookup(reference: BibleLookup, signal?: AbortSignal): Promise<BibleReference>;
}

/** Render "1 Peter 2:9" / "1 Peter 2:9-11" / "Romans 5". */
export function displayReference(reference: BibleLookup): string {
  const { book, chapter, verse, verseEnd } = reference;
  if (verse === undefined) return `${book} ${chapter}`;
  if (verseEnd !== undefined && verseEnd > verse) return `${book} ${chapter}:${verse}-${verseEnd}`;
  return `${book} ${chapter}:${verse}`;
}
