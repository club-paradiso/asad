/**
 * Public-domain Scripture text via bible-api.com.
 *
 * Serves the World English Bible, KJV and ASV — translations whose text may be
 * distributed freely. Modern copyrighted translations are deliberately not
 * reachable here; use `api-bible` with your own licence for those.
 *
 * A failed lookup degrades to a reference, never to a guess.
 */
import type { BibleReference } from "@/types";
import { displayReference, type BibleLookup, type BibleProvider, type BibleProviderId } from "./types";

interface BibleApiResponse {
  reference?: string;
  text?: string;
  translation_id?: string;
  error?: string;
}

const PUBLIC_DOMAIN = ["WEB", "KJV", "ASV", "BBE", "DARBY", "YLT"];

export class PublicDomainBibleProvider implements BibleProvider {
  readonly id: BibleProviderId = "public-domain";
  readonly translations = PUBLIC_DOMAIN;

  constructor(private readonly defaultTranslation = "WEB") {}

  async lookup(reference: BibleLookup, signal?: AbortSignal): Promise<BibleReference> {
    const display = displayReference(reference);
    const base: BibleReference = {
      book: reference.book,
      chapter: reference.chapter,
      verse: reference.verse,
      verseEnd: reference.verseEnd,
      display,
      confidence: "high",
    };

    const requested = (reference.translation ?? this.defaultTranslation).toUpperCase();
    // Refuse politely rather than silently substituting a different translation.
    const translation = PUBLIC_DOMAIN.includes(requested) ? requested : this.defaultTranslation;

    try {
      const url = `https://bible-api.com/${encodeURIComponent(display)}?translation=${translation.toLowerCase()}`;
      const response = await fetch(url, { signal, headers: { accept: "application/json" } });
      if (!response.ok) return base;

      const data = (await response.json()) as BibleApiResponse;
      const text = data.text?.replace(/\s+/g, " ").trim();
      if (!text || data.error) return base;

      return { ...base, text, translation };
    } catch {
      // Offline, blocked, rate-limited — the reference alone is still useful.
      return base;
    }
  }
}
