/**
 * The canonical language registry — the single source of truth for every
 * language ASAD speaks, listens to, or translates into.
 *
 * Before this file existed the same facts lived in three places that could
 * disagree: the Counter picker (`counter/languages.ts`), the STT vendor tag
 * tables (`providers/stt/language.ts`) and the capability matrix
 * (`providers/stt/capability.ts`). The Live console did not consult any of
 * them — it was hard-wired to Korean → English. Chinese was the casualty: a
 * Traditional-script speaker could be recognised as Simplified by one path and
 * translated as the other by the next, and nothing in the code could say which
 * was right because nothing owned the answer.
 *
 * Every consumer now derives its view from here. Add a language once; every
 * picker, recogniser and prompt sees it.
 *
 * Provider identifiers are declared, not discovered. A `null` means "do not
 * send this language to that provider at all" — a recogniser that accepts a
 * tag it cannot transcribe produces confident text in the wrong language, which
 * is worse than no microphone.
 */

/** ISO 15924-style script labels used for normalisation and display rules. */
export type WritingScript =
  | "Hang" // Hangul
  | "Latn"
  | "Hans" // Simplified Chinese
  | "Hant" // Traditional Chinese
  | "Jpan"
  | "Cyrl"
  | "Arab"
  | "Deva"
  | "Beng"
  | "Thai"
  | "Khmr"
  | "Mymr";

export interface LanguageDefinition {
  /** Canonical application id. Always a BCP-47 tag; always the key used everywhere. */
  id: string;
  /** ISO 639-1 base subtag, lower-case. */
  base: string;
  name: {
    en: string;
    ko: string;
    /** The language's own name for itself — what a visitor scans a picker for. */
    native: string;
  };
  script: WritingScript;
  direction: "ltr" | "rtl";
  /** Whether words are separated by spaces. Drives joining, matching and normalisation. */
  spacing: "word" | "none";
  /** Recogniser identifiers per provider. `null` = never send this language there. */
  stt: {
    webspeech: string | null;
    deepgram: string | null;
    /** Whisper-family base code (OpenAI realtime transcription). */
    openai: string | null;
    /** Hugging Face Whisper batch fallback. */
    hf: string | null;
    /**
     * Whisper cannot be told a script through its language code — `zh` alone
     * lets the model pick Simplified or Traditional. A prompt written in the
     * wanted script is the documented way to bias it. Only set where it matters.
     */
    openaiPrompt?: string;
  };
  /** Chrome's built-in Translator API tag, or null when the pair is not offered. */
  browserTranslator: string | null;
  /**
   * Whether the browser recogniser is offered for this language in the
   * product. A product decision recorded once: the vendor may accept the tag
   * and still recognise badly enough that typing is the honest path.
   */
  browserSpeechOffered: boolean;
  /** Tags a browser, an OS or a hand-typed config emits that must resolve here. */
  aliases: string[];
}

const def = (
  id: string,
  name: LanguageDefinition["name"],
  script: WritingScript,
  stt: LanguageDefinition["stt"],
  extra: Partial<Pick<LanguageDefinition, "direction" | "spacing" | "browserTranslator" | "browserSpeechOffered" | "aliases">> = {},
): LanguageDefinition => ({
  id,
  base: id.split("-")[0].toLowerCase(),
  name,
  script,
  direction: extra.direction ?? "ltr",
  spacing: extra.spacing ?? "word",
  stt,
  // `null` is a deliberate "not offered"; only an absent field takes the base-code default.
  browserTranslator:
    extra.browserTranslator === undefined ? id.split("-")[0].toLowerCase() : extra.browserTranslator,
  browserSpeechOffered: extra.browserSpeechOffered ?? true,
  aliases: extra.aliases ?? [],
});

/**
 * The registry. Ordered for the Counter picker: Korean, English, then the
 * languages that actually turn up at a Korean public-service, clinic or
 * reception desk.
 */
export const LANGUAGES: readonly LanguageDefinition[] = [
  def("ko-KR", { en: "Korean", ko: "한국어", native: "한국어" }, "Hang",
    { webspeech: "ko-KR", deepgram: "ko-KR", openai: "ko", hf: "ko" },
    { aliases: ["ko", "kor", "ko-kp"] }),
  def("en-US", { en: "English", ko: "영어", native: "English" }, "Latn",
    { webspeech: "en-US", deepgram: "en-US", openai: "en", hf: "en" },
    { aliases: ["en", "eng", "en-gb", "en-au", "en-ca", "en-in", "en-nz", "en-sg"] }),
  def("zh-CN", { en: "Chinese (Simplified)", ko: "중국어(간체)", native: "中文（简体）" }, "Hans",
    {
      webspeech: "zh-CN",
      deepgram: "zh-CN",
      openai: "zh",
      hf: "zh",
      openaiPrompt: "以下是普通话的简体中文转写。",
    },
    {
      spacing: "none",
      // Chrome's Translator API keys Simplified Chinese as plain `zh`.
      browserTranslator: "zh",
      aliases: ["zh", "zho", "cmn", "zh-hans", "zh-hans-cn", "zh-hans-sg", "zh-sg", "cmn-hans-cn"],
    }),
  def("zh-TW", { en: "Chinese (Traditional)", ko: "중국어(번체)", native: "中文（繁體）" }, "Hant",
    {
      webspeech: "zh-TW",
      deepgram: "zh-TW",
      openai: "zh",
      hf: "zh",
      openaiPrompt: "以下是國語的繁體中文轉寫。",
    },
    {
      spacing: "none",
      browserTranslator: "zh-Hant",
      aliases: ["zh-hant", "zh-hant-tw", "zh-hant-hk", "zh-hant-mo", "zh-hk", "zh-mo", "cmn-hant-tw"],
    }),
  def("ja-JP", { en: "Japanese", ko: "일본어", native: "日本語" }, "Jpan",
    { webspeech: "ja-JP", deepgram: "ja", openai: "ja", hf: "ja" },
    { spacing: "none", aliases: ["ja", "jpn"] }),
  def("vi-VN", { en: "Vietnamese", ko: "베트남어", native: "Tiếng Việt" }, "Latn",
    { webspeech: "vi-VN", deepgram: "vi", openai: "vi", hf: "vi" },
    { aliases: ["vi", "vie"] }),
  def("th-TH", { en: "Thai", ko: "태국어", native: "ไทย" }, "Thai",
    { webspeech: "th-TH", deepgram: "th-TH", openai: "th", hf: "th" },
    { spacing: "none", aliases: ["th", "tha"] }),
  def("id-ID", { en: "Indonesian", ko: "인도네시아어", native: "Bahasa Indonesia" }, "Latn",
    { webspeech: "id-ID", deepgram: "id", openai: "id", hf: "id" },
    { aliases: ["id", "ind"] }),
  def("ru-RU", { en: "Russian", ko: "러시아어", native: "Русский" }, "Cyrl",
    { webspeech: "ru-RU", deepgram: "ru", openai: "ru", hf: "ru" },
    { aliases: ["ru", "rus"] }),
  def("uk-UA", { en: "Ukrainian", ko: "우크라이나어", native: "Українська" }, "Cyrl",
    { webspeech: "uk-UA", deepgram: "uk", openai: "uk", hf: "uk" },
    { aliases: ["uk", "ukr"] }),
  def("uz-UZ", { en: "Uzbek", ko: "우즈베크어", native: "Oʻzbekcha" }, "Latn",
    { webspeech: "uz-UZ", deepgram: null, openai: "uz", hf: "uz" },
    { browserSpeechOffered: false, browserTranslator: null, aliases: ["uz", "uzb"] }),
  def("mn-MN", { en: "Mongolian", ko: "몽골어", native: "Монгол" }, "Cyrl",
    { webspeech: "mn-MN", deepgram: "mn", openai: "mn", hf: "mn" },
    { browserSpeechOffered: false, browserTranslator: null, aliases: ["mn", "mon"] }),
  def("ne-NP", { en: "Nepali", ko: "네팔어", native: "नेपाली" }, "Deva",
    { webspeech: "ne-NP", deepgram: "ne", openai: "ne", hf: "ne" },
    { browserSpeechOffered: false, browserTranslator: null, aliases: ["ne", "nep"] }),
  def("km-KH", { en: "Khmer", ko: "크메르어", native: "ភាសាខ្មែរ" }, "Khmr",
    { webspeech: "km-KH", deepgram: null, openai: "km", hf: "km" },
    { spacing: "none", browserSpeechOffered: false, browserTranslator: null, aliases: ["km", "khm"] }),
  def("my-MM", { en: "Burmese", ko: "미얀마어", native: "မြန်မာ" }, "Mymr",
    { webspeech: "my-MM", deepgram: null, openai: "my", hf: "my" },
    { spacing: "none", browserSpeechOffered: false, browserTranslator: null, aliases: ["my", "mya"] }),
  def("tl-PH", { en: "Tagalog", ko: "타갈로그어", native: "Tagalog" }, "Latn",
    // Google's browser speech backend exposes Filipino as fil-PH, not tl-PH.
    { webspeech: "fil-PH", deepgram: "tl", openai: "tl", hf: "tl" },
    { browserTranslator: null, aliases: ["tl", "tgl", "fil", "fil-ph"] }),
  def("es-ES", { en: "Spanish", ko: "스페인어", native: "Español" }, "Latn",
    { webspeech: "es-ES", deepgram: "es", openai: "es", hf: "es" },
    { aliases: ["es", "spa", "es-mx", "es-419", "es-us"] }),
  def("fr-FR", { en: "French", ko: "프랑스어", native: "Français" }, "Latn",
    { webspeech: "fr-FR", deepgram: "fr", openai: "fr", hf: "fr" },
    { aliases: ["fr", "fra", "fr-ca"] }),
  def("de-DE", { en: "German", ko: "독일어", native: "Deutsch" }, "Latn",
    { webspeech: "de-DE", deepgram: "de", openai: "de", hf: "de" },
    { aliases: ["de", "deu", "de-at", "de-ch"] }),
  def("pt-BR", { en: "Portuguese", ko: "포르투갈어", native: "Português" }, "Latn",
    { webspeech: "pt-BR", deepgram: "pt-BR", openai: "pt", hf: "pt" },
    { aliases: ["pt", "por", "pt-pt"] }),
  def("ar-SA", { en: "Arabic", ko: "아랍어", native: "العربية" }, "Arab",
    { webspeech: "ar-SA", deepgram: "ar-SA", openai: "ar", hf: "ar" },
    { direction: "rtl", aliases: ["ar", "ara", "ar-eg", "ar-ae"] }),
  def("hi-IN", { en: "Hindi", ko: "힌디어", native: "हिन्दी" }, "Deva",
    { webspeech: "hi-IN", deepgram: "hi", openai: "hi", hf: "hi" },
    { aliases: ["hi", "hin"] }),
  def("bn-BD", { en: "Bengali", ko: "벵골어", native: "বাংলা" }, "Beng",
    { webspeech: "bn-BD", deepgram: "bn", openai: "bn", hf: "bn" },
    { aliases: ["bn", "ben", "bn-in"] }),
  def("ur-PK", { en: "Urdu", ko: "우르두어", native: "اردو" }, "Arab",
    { webspeech: "ur-PK", deepgram: "ur", openai: "ur", hf: "ur" },
    { direction: "rtl", aliases: ["ur", "urd", "ur-in"] }),
  def("tr-TR", { en: "Turkish", ko: "터키어", native: "Türkçe" }, "Latn",
    { webspeech: "tr-TR", deepgram: "tr-TR", openai: "tr", hf: "tr" },
    { aliases: ["tr", "tur"] }),
  // Uyghur is written in the Perso-Arabic script but is a Turkic language and
  // is NOT Arabic, Uzbek, or Turkish. Every recogniser slot is null so nothing
  // downstream can quietly reroute it — a mistake that produces confident,
  // fluent, completely wrong administrative text.
  def("ug-CN", { en: "Uyghur", ko: "위구르어", native: "ئۇيغۇرچە" }, "Arab",
    { webspeech: null, deepgram: null, openai: null, hf: null },
    {
      direction: "rtl",
      browserSpeechOffered: false,
      browserTranslator: null,
      aliases: ["ug", "uig", "ug-arab", "ug-arab-cn", "ug-latn", "ug-cyrl"],
    }),
];

/** Ids that may appear as a Live source or target. Everything in the registry. */
export const LANGUAGE_IDS: readonly string[] = LANGUAGES.map((language) => language.id);

const tagKey = (tag: string): string => tag.trim().toLowerCase().replace(/_/g, "-");

const BY_KEY = new Map<string, LanguageDefinition>();
const BY_BASE = new Map<string, LanguageDefinition>();
for (const language of LANGUAGES) {
  BY_KEY.set(tagKey(language.id), language);
  for (const alias of language.aliases) BY_KEY.set(tagKey(alias), language);
  // The first entry for a base language is its default variant: `zh` → zh-CN.
  if (!BY_BASE.has(language.base)) BY_BASE.set(language.base, language);
}

/**
 * Resolve any tag a browser, an OS or a person can produce to its registry
 * entry. Case-insensitive; script and region subtags are honoured before the
 * base-language fallback, so `zh-Hant-HK` lands on zh-TW and never on zh-CN.
 */
export function resolveLanguage(tag: string | undefined | null): LanguageDefinition | undefined {
  if (!tag) return undefined;
  const key = tagKey(tag);
  if (!key) return undefined;
  const direct = BY_KEY.get(key);
  if (direct) return direct;

  const parts = key.split("-");
  // xx-Scpt-RR → try xx-Scpt, then xx-RR, then xx.
  if (parts.length >= 3) {
    const byScript = BY_KEY.get(`${parts[0]}-${parts[1]}`);
    if (byScript) return byScript;
    const withoutScript = BY_KEY.get(`${parts[0]}-${parts.slice(2).join("-")}`);
    if (withoutScript) return withoutScript;
  }
  return BY_BASE.get(parts[0]);
}

/** The registry id for an arbitrary tag, or the trimmed input when unknown. */
export const canonicalLanguageId = (tag: string): string => resolveLanguage(tag)?.id ?? tag.trim();

export const isKnownLanguage = (tag: string | undefined | null): boolean => !!resolveLanguage(tag);

/** English display name for prompts and logs. */
export const languageDisplayName = (tag: string): string => resolveLanguage(tag)?.name.en ?? tag;

/** Base subtag (`zh`, `ko`) for a tag, resolved through the registry when possible. */
export const languageBase = (tag: string | undefined | null): string =>
  resolveLanguage(tag)?.base ?? (tag ?? "").trim().toLowerCase().split("-")[0];

export const languageScript = (tag: string | undefined | null): WritingScript | undefined =>
  resolveLanguage(tag)?.script;

/** Whether the language writes without spaces between words. */
export const isSpacelessLanguage = (tag: string | undefined | null): boolean =>
  resolveLanguage(tag)?.spacing === "none";

/** Provider recogniser id for a language, or null when that provider must not receive it. */
export function sttLanguageFor(
  provider: keyof LanguageDefinition["stt"] & ("webspeech" | "deepgram" | "openai" | "hf"),
  tag: string | undefined | null,
): string | null {
  const language = resolveLanguage(tag);
  if (!language) return null;
  return language.stt[provider];
}

/** Whisper script-biasing prompt for a language, when the registry defines one. */
export const whisperPromptFor = (tag: string | undefined | null): string | undefined =>
  resolveLanguage(tag)?.stt.openaiPrompt;

/** Chrome Translator tag for a language, or null when the pair is not offered. */
export const browserTranslatorTagFor = (tag: string | undefined | null): string | null =>
  resolveLanguage(tag)?.browserTranslator ?? null;

/** A Live language pair, always in canonical ids. */
export interface LanguagePairIds {
  source: string;
  target: string;
}

export const DEFAULT_LANGUAGE_PAIR: LanguagePairIds = { source: "ko-KR", target: "en-US" };

/** Normalise a pair; unknown tags fall back to the default side. */
export function canonicalPair(pair: Partial<LanguagePairIds> | undefined): LanguagePairIds {
  const source = resolveLanguage(pair?.source)?.id ?? DEFAULT_LANGUAGE_PAIR.source;
  let target = resolveLanguage(pair?.target)?.id ?? DEFAULT_LANGUAGE_PAIR.target;
  if (target === source) target = source === "en-US" ? "ko-KR" : "en-US";
  return { source, target };
}

/** True when the pair is the one the demo, the Korean detectors and the sermon lexicon were written for. */
export const isKoreanToEnglish = (pair: LanguagePairIds): boolean =>
  languageBase(pair.source) === "ko" && languageBase(pair.target) === "en";

/** Compact direction label for the console chrome, e.g. `KO → EN`, `ZH-TW → KO`. */
export function pairLabel(pair: LanguagePairIds): string {
  const short = (id: string) => {
    const language = resolveLanguage(id);
    if (!language) return id.toUpperCase();
    // Chinese needs its script in the label; nothing else needs its region.
    return language.base === "zh" ? language.id.toUpperCase() : language.base.toUpperCase();
  };
  return `${short(pair.source)} → ${short(pair.target)}`;
}

/** Suggest a language from `navigator.languages`; only ever a suggestion. */
export function suggestLanguageId(
  navigatorLanguages: readonly string[] | undefined,
  fallback = "en-US",
): string {
  for (const candidate of navigatorLanguages ?? []) {
    const match = resolveLanguage(candidate);
    if (match) return match.id;
  }
  return fallback;
}
