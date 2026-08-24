/**
 * Bible provider factory.
 *
 * Default is `reference-only`: no network call, no licensing exposure, and no
 * possibility of showing wording that was not actually in the translation.
 */
import { ApiBibleProvider } from "./api-bible";
import { PublicDomainBibleProvider } from "./public-domain";
import { ReferenceOnlyBibleProvider } from "./reference-only";
import type { BibleProvider, BibleProviderId } from "./types";

export * from "./types";

export function resolveBibleProvider(): { provider: BibleProvider; note?: string } {
  const requested = (process.env.BIBLE_PROVIDER ?? "reference-only").trim().toLowerCase();
  const translation = process.env.BIBLE_TRANSLATION?.trim() || "WEB";

  if (requested === "public-domain") {
    return { provider: new PublicDomainBibleProvider(translation) };
  }

  if (requested === "api-bible") {
    const key = process.env.BIBLE_API_KEY?.trim();
    const bibleId = process.env.BIBLE_ID?.trim();
    if (!key || !bibleId) {
      return {
        provider: new ReferenceOnlyBibleProvider(),
        note: "api-bible needs BIBLE_API_KEY and BIBLE_ID — showing references only.",
      };
    }
    return { provider: new ApiBibleProvider(key, bibleId, [translation]) };
  }

  return { provider: new ReferenceOnlyBibleProvider() };
}

export const BIBLE_PROVIDER_INFO: Record<BibleProviderId, { label: string; detail: string }> = {
  "reference-only": {
    label: "Reference only",
    detail: "Normalises the reference and never shows verse wording. No licence needed.",
  },
  "public-domain": {
    label: "Public domain",
    detail: "WEB / KJV / ASV text. Freely distributable.",
  },
  "api-bible": {
    label: "api.bible",
    detail: "Your own licensed translation. Requires a key and a Bible id you may use.",
  },
};
