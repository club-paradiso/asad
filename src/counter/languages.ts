/**
 * Languages offered at the counter.
 *
 * A thin view over the canonical registry (`@/languages/registry`). The
 * Counter picker keeps its own shape — `code`, `endonym`, `speechSupported` —
 * because a dozen screens read it, but every fact comes from the registry.
 * Add a language there; it shows up here in the same order.
 */
import {
  LANGUAGES,
  resolveLanguage,
  suggestLanguageId,
  type LanguageDefinition,
} from "@/languages/registry";

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
  endonym: language.name.native,
  ko: language.name.ko,
  en: language.name.en,
  speechSupported: language.browserSpeechOffered,
  ...(language.direction === "rtl" ? { rtl: true } : {}),
});

export const COUNTER_LANGUAGES: CounterLanguage[] = LANGUAGES.map(toCounterLanguage);

/** Registry id → the one CounterLanguage instance for it, so lookups are referentially stable. */
const BY_ID = new Map(COUNTER_LANGUAGES.map((language) => [language.code, language]));

/**
 * Resolve any tag a browser, an OS or a person can produce. Case-insensitive;
 * script and region subtags are honoured before the base-language fallback,
 * so `zh-Hant-HK` lands on zh-TW and `uig` on ug-CN. The registry owns the
 * alias table.
 */
export const findLanguage = (code: string): CounterLanguage | undefined => {
  const language = resolveLanguage(code);
  return language ? BY_ID.get(language.id) : undefined;
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
  return suggestLanguageId(navigatorLanguages, fallback);
}

/** Languages the visitor picker shows first — the common ones at a Korean desk. */
export const PRIORITY_LANGUAGES = [
  "en-US",
  "zh-CN",
  "vi-VN",
  "th-TH",
  "ja-JP",
  "ru-RU",
  "uz-UZ",
  "mn-MN",
] as const;
