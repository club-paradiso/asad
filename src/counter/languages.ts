/**
 * Languages offered at the counter.
 *
 * THIS IS A VIEW, NOT A SOURCE. Every language fact now lives in
 * `src/lib/languages.ts`, which is the single authoritative registry shared by
 * Counter Mode, Live Interpretation, the recogniser layer and diagnostics.
 *
 * This module remains because Counter Mode's vocabulary is genuinely narrower
 * than the registry's — it wants a tag, three display names, a direction flag
 * and one boolean about the browser recogniser — and because keeping the
 * counter-shaped view here means the counter screens did not all have to learn
 * the registry's shape to gain a single source of truth.
 */
import {
  LANGUAGES,
  PRIORITY_LANGUAGES as REGISTRY_PRIORITY_LANGUAGES,
  findLanguage as findRegistryLanguage,
  type LanguageDefinition,
} from "@/lib/languages";

export interface CounterLanguage {
  /** BCP-47 tag used for STT and passed to the model. */
  code: string;
  /** Name in the language itself — what the visitor scans the list for. */
  endonym: string;
  /** Korean name, for the staff-side picker. */
  ko: string;
  /** English name, for logs and diagnostics. */
  en: string;
  /** Whether the browser's SpeechRecognition generally handles it. */
  speechSupported: boolean;
  rtl?: boolean;
}

const toCounterLanguage = (language: LanguageDefinition): CounterLanguage => ({
  code: language.id,
  endonym: language.endonym,
  ko: language.ko,
  en: language.en,
  speechSupported: language.stt.webspeech !== null,
  ...(language.direction === "rtl" ? { rtl: true } : {}),
});

export const COUNTER_LANGUAGES: CounterLanguage[] = LANGUAGES.filter(
  (language) => language.capabilities.counter,
).map(toCounterLanguage);

const BY_ID = new Map(COUNTER_LANGUAGES.map((language) => [language.code, language]));

/**
 * Resolve any input tag — alias, lowercase, script-subtagged or base-only — to
 * the counter view of its registry entry. Resolution itself belongs to the
 * registry; this only narrows the result.
 */
export const findLanguage = (code: string): CounterLanguage | undefined => {
  const resolved = findRegistryLanguage(code);
  return resolved ? BY_ID.get(resolved.id) : undefined;
};

/** The registry tag for an arbitrary input tag, or the input when unknown. */
export const normaliseLanguageTag = (code: string): string =>
  findLanguage(code)?.code ?? code.trim();

export const isSupportedLanguage = (code: string): boolean => !!findLanguage(code);

/** Display name for the model prompt and for logs. */
export const languageName = (code: string): string => findLanguage(code)?.en ?? code;

/**
 * Best guess at the visitor's language from their browser.
 *
 * Only ever a *suggestion*: the join screen pre-selects it and the visitor
 * confirms. Guessing silently and being wrong is worse than asking, because the
 * visitor may not be able to read the wrong guess well enough to fix it.
 */
export function suggestLanguage(
  navigatorLanguages: readonly string[] | undefined,
  fallback = "en-US",
): string {
  for (const candidate of navigatorLanguages ?? []) {
    const match = findLanguage(candidate);
    if (match) return match.code;
  }
  return fallback;
}

/** Languages the visitor picker shows first — the common ones at a Korean desk. */
export const PRIORITY_LANGUAGES = REGISTRY_PRIORITY_LANGUAGES;
