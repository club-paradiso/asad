/**
 * Scripture reference format enforcement.
 *
 * Two rules, both downstream of "모르면 새로 쓰지 않는다":
 *
 *  1. CANONICAL FORMAT — every reference the system carries is rendered in the
 *     장:절 notation ("1 Peter 2:9"). Whatever shape the model returns, it is
 *     normalised to this form or rejected; there is no third option where a
 *     plausible-looking string slips through unvalidated.
 *
 *  2. NO FABRICATION — a reference the model produces is only as trustworthy
 *     as its provenance. `verifyReferences` checks every model-returned
 *     reference against references the local detector actually heard (or the
 *     session already knew) and annotates the verdict. The annotation is
 *     non-destructive: already-delivered text is never rewritten — temporal
 *     locking still holds — but unverified references are marked so the rail
 *     and diagnostics can treat them as claims, not facts.
 */
import type { BibleReference } from "@/types";
import {
  buildDisplay,
  detectScriptureReferences,
  parseEnglishReference,
} from "./detect";

/**
 * The canonical 장:절 rendering of a reference — "1 Peter 2:9",
 * "Romans 5:1-3", "Psalms 23". Delegates to the detector's single owner of
 * this shape.
 */
export function formatReference(reference: BibleReference): string {
  return buildDisplay(reference.book, reference.chapter, reference.verse, reference.verseEnd);
}

/** True when a string is already in canonical 장:절 display form. */
export function isCanonicalFormat(text: string): boolean {
  return /^[1-3]?\s?[A-Za-z][A-Za-z\s.]*\s\d{1,3}(?::\d{1,3}(?:\s*[-–]\s*\d{1,3})?)?$/.test(
    text.trim(),
  );
}

/**
 * Normalise whatever the model returned into a canonical reference.
 *
 * Accepts canonical English ("1 Peter 2:9"), loose English ("John 3:16-18"),
 * and Korean spoken forms ("요한복음 3장 16절"). Returns null when the input
 * cannot be read confidently — a reference that fails validation is dropped,
 * not shown, exactly like the detector treats unheard speech.
 */
export function normaliseModelReference(raw: string): BibleReference | null {
  const input = raw.trim();
  if (!input) return null;

  const english = parseEnglishReference(input);
  if (english) return { ...english, display: formatReference(english) };

  const korean = detectScriptureReferences(input);
  if (korean.length === 1) {
    const { index: _index, ...ref } = korean[0];
    return { ...ref, display: formatReference(ref) };
  }
  return null;
}

export interface ProvenanceCheckedReference extends BibleReference {
  /** True when the local detector heard it or the session already knew it. */
  verified: boolean;
}

/**
 * Check model-returned references against trusted ones.
 *
 * A reference is trusted when its canonical display matches a reference the
 * local detector resolved from source speech or the session already carries
 * (e.g. verse text enriched from a provider the user has rights to). Anything
 * else is annotated `verified: false` — the system records the model's claim
 * without endorsing it.
 */
export function verifyReferences(
  modelRefs: BibleReference[],
  trustedRefs: BibleReference[],
): ProvenanceCheckedReference[] {
  const trusted = new Set(trustedRefs.map((ref) => ref.display.trim()));
  return modelRefs.map((ref) => {
    const display = isCanonicalFormat(ref.display)
      ? ref.display.trim()
      : formatReference(ref);
    return { ...ref, display, verified: trusted.has(display) };
  });
}
