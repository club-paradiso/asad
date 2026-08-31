/**
 * Provider-specific STT language tags.
 *
 * The product uses BCP-47 tags because the UI needs region/script distinctions,
 * but speech vendors do not accept the same set of tags. Keep that translation
 * at the provider boundary instead of throwing away region information globally.
 */

/**
 * Deepgram Nova-3 language codes currently used by Counter Mode.
 *
 * Preserve region/script variants where Deepgram has distinct models (notably
 * Simplified vs Traditional Chinese). Return null for languages Nova-3 does not
 * currently support so Counter Mode can fall back to browser speech immediately.
 */
const DEEPGRAM_LANGUAGE: Record<string, string> = {
  "ko-KR": "ko-KR",
  "en-US": "en-US",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  "ja-JP": "ja",
  "vi-VN": "vi",
  "th-TH": "th-TH",
  "id-ID": "id",
  "ru-RU": "ru",
  "mn-MN": "mn",
  "ne-NP": "ne",
  "tl-PH": "tl",
  "es-ES": "es",
  "fr-FR": "fr",
  "de-DE": "de",
  "pt-BR": "pt-BR",
  "ar-SA": "ar-SA",
  "hi-IN": "hi",
  "bn-BD": "bn",
  "ur-PK": "ur",
  "tr-TR": "tr-TR",
};

export function deepgramLanguage(language: string | undefined): string | null {
  if (!language) return "ko-KR";
  return DEEPGRAM_LANGUAGE[language] ?? null;
}

/**
 * Browser SpeechRecognition wants BCP-47. Most app tags can pass through, but
 * Google's browser speech backend commonly exposes Filipino as fil-PH rather
 * than the older tl-PH tag used by the product/model layer.
 */
export function webSpeechLanguage(language: string | undefined): string {
  if (!language) return "ko-KR";
  if (language === "tl-PH") return "fil-PH";
  return language;
}
