/**
 * Languages offered at the counter.
 *
 * Chosen for who actually turns up at a Korean public-service, clinic or
 * reception desk, not for coverage-count marketing. Each carries its own
 * endonym, because a visitor scanning a QR code needs to find their language in
 * a list written in *their* script, not in Korean or English.
 */
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

export const COUNTER_LANGUAGES: CounterLanguage[] = [
  { code: "ko-KR", endonym: "한국어", ko: "한국어", en: "Korean", speechSupported: true },
  { code: "en-US", endonym: "English", ko: "영어", en: "English", speechSupported: true },
  { code: "zh-CN", endonym: "中文（简体）", ko: "중국어(간체)", en: "Chinese (Simplified)", speechSupported: true },
  { code: "zh-TW", endonym: "中文（繁體）", ko: "중국어(번체)", en: "Chinese (Traditional)", speechSupported: true },
  { code: "ja-JP", endonym: "日本語", ko: "일본어", en: "Japanese", speechSupported: true },
  { code: "vi-VN", endonym: "Tiếng Việt", ko: "베트남어", en: "Vietnamese", speechSupported: true },
  { code: "th-TH", endonym: "ไทย", ko: "태국어", en: "Thai", speechSupported: true },
  { code: "id-ID", endonym: "Bahasa Indonesia", ko: "인도네시아어", en: "Indonesian", speechSupported: true },
  { code: "ru-RU", endonym: "Русский", ko: "러시아어", en: "Russian", speechSupported: true },
  { code: "uz-UZ", endonym: "Oʻzbekcha", ko: "우즈베크어", en: "Uzbek", speechSupported: false },
  { code: "mn-MN", endonym: "Монгол", ko: "몽골어", en: "Mongolian", speechSupported: false },
  { code: "ne-NP", endonym: "नेपाली", ko: "네팔어", en: "Nepali", speechSupported: false },
  { code: "km-KH", endonym: "ភាសាខ្មែរ", ko: "크메르어", en: "Khmer", speechSupported: false },
  { code: "my-MM", endonym: "မြန်မာ", ko: "미얀마어", en: "Burmese", speechSupported: false },
  { code: "tl-PH", endonym: "Tagalog", ko: "타갈로그어", en: "Tagalog", speechSupported: true },
  { code: "es-ES", endonym: "Español", ko: "스페인어", en: "Spanish", speechSupported: true },
  { code: "fr-FR", endonym: "Français", ko: "프랑스어", en: "French", speechSupported: true },
  { code: "de-DE", endonym: "Deutsch", ko: "독일어", en: "German", speechSupported: true },
  { code: "pt-BR", endonym: "Português", ko: "포르투갈어", en: "Portuguese", speechSupported: true },
  { code: "ar-SA", endonym: "العربية", ko: "아랍어", en: "Arabic", speechSupported: true, rtl: true },
  { code: "hi-IN", endonym: "हिन्दी", ko: "힌디어", en: "Hindi", speechSupported: true },
  { code: "bn-BD", endonym: "বাংলা", ko: "벵골어", en: "Bengali", speechSupported: true },
  { code: "ur-PK", endonym: "اردو", ko: "우르두어", en: "Urdu", speechSupported: true, rtl: true },
  { code: "tr-TR", endonym: "Türkçe", ko: "터키어", en: "Turkish", speechSupported: true },
];

const tagKey = (code: string): string => code.trim().toLowerCase();
const BY_CODE = new Map(COUNTER_LANGUAGES.map((language) => [tagKey(language.code), language]));
const BY_BASE = new Map<string, CounterLanguage>();
for (const language of COUNTER_LANGUAGES) {
  const base = tagKey(language.code).split("-")[0];
  if (!BY_BASE.has(base)) BY_BASE.set(base, language);
}

/**
 * BCP-47 tags are case-insensitive. Resolve an exact language+region/script
 * match before falling back to the base language. Without that ordering,
 * lowercase `zh-tw` fell through to the first `zh` entry (`zh-CN`) and silently
 * changed Traditional Chinese into Simplified Chinese.
 */
export const findLanguage = (code: string): CounterLanguage | undefined => {
  const key = tagKey(code);
  return BY_CODE.get(key) ?? BY_BASE.get(key.split("-")[0]);
};

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
