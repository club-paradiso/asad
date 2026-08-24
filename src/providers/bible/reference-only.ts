/**
 * The default Bible provider: normalise the reference, never the text.
 *
 * Zero network, zero licensing exposure, zero risk of hallucinated Scripture.
 */
import type { BibleReference } from "@/types";
import { displayReference, type BibleLookup, type BibleProvider, type BibleProviderId } from "./types";

export class ReferenceOnlyBibleProvider implements BibleProvider {
  readonly id: BibleProviderId = "reference-only";
  readonly translations: string[] = [];

  async lookup(reference: BibleLookup): Promise<BibleReference> {
    return {
      book: reference.book,
      chapter: reference.chapter,
      verse: reference.verse,
      verseEnd: reference.verseEnd,
      display: displayReference(reference),
      confidence: "high",
    };
  }
}
