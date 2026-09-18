/**
 * The language registry — one authoritative record per language.
 *
 * Before this module, language knowledge was spread across five files:
 * the counter picker's list, the Deepgram/Web Speech tag maps, the Whisper
 * coverage set, the script regexes used to rank recogniser alternatives, and
 * the per-target writing guidance in the counter prompt. Nothing tied them
 * together, so Live Interpretation — which sits above all of them — could only
 * ever be Korean, because the registry it would have needed lived under
 * `counter/`.
 *
 * Everything a caller can need about a language is here, and it is the only
 * place that knows it:
 *
 *   id            canonical BCP-47 tag; the key used everywhere else
 *   base          ISO-639 subtag, for providers that accept nothing finer
 *   script        ISO-15924 code
 *   scriptVariant true when the tag's MEANING depends on the script subtag
 *   spaced        whether the writing system separates words with spaces
 *   direction     ltr / rtl
 *   stt           what each recogniser family calls this language, or null
 *   translator    Chrome's on-device Translator code, or null
 *   capabilities  where this language may legitimately be offered
 *
 * `scriptVariant` is the field that fixes a real, reported bug rather than a
 * theoretical one. `zh-CN` and `zh-TW` are different written languages to the
 * reader, and Whisper's API has no parameter that selects between them: it
 * takes `zh`. A pipeline that treats "the provider accepts the base subtag" as
 * "the provider supports this language" hands a Traditional-script reader
 * Simplified characters and reports it as a success. The registry states the
 * limitation once, and `providers/stt/capability.ts` degrades honestly from it
 * for every such pair — not for Chinese as a special case.
 */

export type LanguageDirection = "ltr" | "rtl";

/** How well a recogniser family serves a language, as declared not discovered. */
export type SttFidelity =
  /** The vendor lists it and it is in ordinary use. */
  | "native"
  /** Accepted, but quality or training data is not established. */
  | "experimental"
  /**
   * Accepted only as the base language, losing a script distinction this tag
   * carries. Usable; not what the user asked for.
   */
  | "variant-lossy";

export interface SttCoverage {
  /** What this recogniser calls the language. */
  code: string;
  fidelity: SttFidelity;
}

export interface LanguageDefinition {
  /** Canonical BCP-47 tag. The id used by every other module. */
  id: string;
  /** ISO-639 base subtag. */
  base: string;
  /** Name in the language itself — what a reader scans a list for. */
  endonym: string;
  /** Korean name, for Korean-facing pickers. */
  ko: string;
  /** English name, for prompts, logs and diagnostics. */
  en: string;
  /** ISO-15924 script code. */
  script: string;
  direction: LanguageDirection;
  /** False for writing systems that do not put spaces between words. */
  spaced: boolean;
  /**
   * True when this tag differs from its base language by SCRIPT, so a provider
   * that accepts only the base subtag cannot honour the request.
   */
  scriptVariant: boolean;
  /** Characters that belong to this language's script, for alternative ranking. */
  scriptPattern?: RegExp;
  stt: {
    webspeech: SttCoverage | null;
    deepgram: SttCoverage | null;
    /** The Whisper family: OpenAI realtime transcription and the HF fallback. */
    whisper: SttCoverage | null;
  };
  /** Chrome's on-device Translator language code, when it has one. */
  translator: string | null;
  capabilities: {
    /** May be chosen as the spoken source of a live session. */
    liveSource: boolean;
    /** May be chosen as the rendered target of a live session. */
    liveTarget: boolean;
    /** Offered in Counter Mode's language picker. */
    counter: boolean;
  };
}

const HANGUL = /[가-힣ᄀ-ᇿ]/u;
const HAN = /[㐀-䶿一-鿿豈-﫿]/u;
const KANA_OR_HAN = /[぀-ヿ㐀-䶿一-鿿]/u;
const CYRILLIC = /[Ѐ-ӿ]/u;
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿ]/u;
const DEVANAGARI = /[ऀ-ॿ]/u;
const BENGALI = /[ঀ-৿]/u;
const THAI = /[฀-๿]/u;
const KHMER = /[ក-៿]/u;
const BURMESE = /[က-႟ꩠ-ꩿ]/u;

const native = (code: string): SttCoverage => ({ code, fidelity: "native" });
const experimental = (code: string): SttCoverage => ({ code, fidelity: "experimental" });
const variantLossy = (code: string): SttCoverage => ({ code, fidelity: "variant-lossy" });

/**
 * Every language the product knows about.
 *
 * Chosen for who actually turns up at a Korean church booth, public-service
 * desk, clinic or reception — not for a coverage count. Ordering is the order
 * the counter picker shows them in.
 */
export const LANGUAGES: LanguageDefinition[] = [
  {
    id: "ko-KR", base: "ko", endonym: "한국어", ko: "한국어", en: "Korean",
    script: "Hang", direction: "ltr", spaced: true, scriptVariant: false,
    scriptPattern: HANGUL,
    stt: { webspeech: native("ko-KR"), deepgram: native("ko-KR"), whisper: native("ko") },
    translator: "ko",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "en-US", base: "en", endonym: "English", ko: "영어", en: "English",
    script: "Latn", direction: "ltr", spaced: true, scriptVariant: false,
    stt: { webspeech: native("en-US"), deepgram: native("en-US"), whisper: native("en") },
    translator: "en",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "zh-CN", base: "zh", endonym: "中文（简体）", ko: "중국어(간체)", en: "Chinese (Simplified)",
    script: "Hans", direction: "ltr", spaced: false, scriptVariant: true,
    scriptPattern: HAN,
    // Deepgram and the browser recogniser both accept the region tag and emit
    // Simplified characters for it. Whisper takes only `zh`; Simplified is what
    // it produces by default, so the base tag happens to be right here.
    stt: { webspeech: native("zh-CN"), deepgram: native("zh-CN"), whisper: native("zh") },
    translator: "zh-Hans",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "zh-TW", base: "zh", endonym: "中文（繁體）", ko: "중국어(번체)", en: "Chinese (Traditional)",
    script: "Hant", direction: "ltr", spaced: false, scriptVariant: true,
    scriptPattern: HAN,
    // Whisper's transcription API selects a LANGUAGE, not a script. Asking it
    // for `zh` returns Simplified characters, which is not what a Traditional
    // reader asked for — declared here rather than discovered on stage.
    stt: { webspeech: native("zh-TW"), deepgram: native("zh-TW"), whisper: variantLossy("zh") },
    translator: "zh-Hant",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "ja-JP", base: "ja", endonym: "日本語", ko: "일본어", en: "Japanese",
    script: "Jpan", direction: "ltr", spaced: false, scriptVariant: false,
    scriptPattern: KANA_OR_HAN,
    stt: { webspeech: native("ja-JP"), deepgram: native("ja"), whisper: native("ja") },
    translator: "ja",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "vi-VN", base: "vi", endonym: "Tiếng Việt", ko: "베트남어", en: "Vietnamese",
    script: "Latn", direction: "ltr", spaced: true, scriptVariant: false,
    stt: { webspeech: native("vi-VN"), deepgram: native("vi"), whisper: native("vi") },
    translator: "vi",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "th-TH", base: "th", endonym: "ไทย", ko: "태국어", en: "Thai",
    script: "Thai", direction: "ltr", spaced: false, scriptVariant: false,
    scriptPattern: THAI,
    stt: { webspeech: native("th-TH"), deepgram: native("th-TH"), whisper: native("th") },
    translator: "th",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "id-ID", base: "id", endonym: "Bahasa Indonesia", ko: "인도네시아어", en: "Indonesian",
    script: "Latn", direction: "ltr", spaced: true, scriptVariant: false,
    stt: { webspeech: native("id-ID"), deepgram: native("id"), whisper: native("id") },
    translator: "id",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "ru-RU", base: "ru", endonym: "Русский", ko: "러시아어", en: "Russian",
    script: "Cyrl", direction: "ltr", spaced: true, scriptVariant: false,
    scriptPattern: CYRILLIC,
    stt: { webspeech: native("ru-RU"), deepgram: native("ru"), whisper: native("ru") },
    translator: "ru",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "uk-UA", base: "uk", endonym: "Українська", ko: "우크라이나어", en: "Ukrainian",
    script: "Cyrl", direction: "ltr", spaced: true, scriptVariant: false,
    scriptPattern: CYRILLIC,
    stt: { webspeech: native("uk-UA"), deepgram: native("uk"), whisper: native("uk") },
    translator: "uk",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "uz-UZ", base: "uz", endonym: "Oʻzbekcha", ko: "우즈베크어", en: "Uzbek",
    script: "Latn", direction: "ltr", spaced: true, scriptVariant: false,
    stt: { webspeech: null, deepgram: null, whisper: native("uz") },
    translator: null,
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "mn-MN", base: "mn", endonym: "Монгол", ko: "몽골어", en: "Mongolian",
    script: "Cyrl", direction: "ltr", spaced: true, scriptVariant: false,
    scriptPattern: CYRILLIC,
    stt: { webspeech: null, deepgram: native("mn"), whisper: experimental("mn") },
    translator: null,
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "ne-NP", base: "ne", endonym: "नेपाली", ko: "네팔어", en: "Nepali",
    script: "Deva", direction: "ltr", spaced: true, scriptVariant: false,
    scriptPattern: DEVANAGARI,
    stt: { webspeech: null, deepgram: native("ne"), whisper: experimental("ne") },
    translator: null,
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "km-KH", base: "km", endonym: "ភាសាខ្មែរ", ko: "크메르어", en: "Khmer",
    script: "Khmr", direction: "ltr", spaced: false, scriptVariant: false,
    scriptPattern: KHMER,
    stt: { webspeech: null, deepgram: null, whisper: experimental("km") },
    translator: null,
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "my-MM", base: "my", endonym: "မြန်မာ", ko: "미얀마어", en: "Burmese",
    script: "Mymr", direction: "ltr", spaced: false, scriptVariant: false,
    scriptPattern: BURMESE,
    stt: { webspeech: null, deepgram: null, whisper: experimental("my") },
    translator: null,
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "tl-PH", base: "tl", endonym: "Tagalog", ko: "타갈로그어", en: "Tagalog",
    script: "Latn", direction: "ltr", spaced: true, scriptVariant: false,
    // Google's browser speech backend exposes Filipino as fil-PH, not tl-PH.
    stt: { webspeech: native("fil-PH"), deepgram: native("tl"), whisper: native("tl") },
    translator: null,
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "es-ES", base: "es", endonym: "Español", ko: "스페인어", en: "Spanish",
    script: "Latn", direction: "ltr", spaced: true, scriptVariant: false,
    stt: { webspeech: native("es-ES"), deepgram: native("es"), whisper: native("es") },
    translator: "es",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "fr-FR", base: "fr", endonym: "Français", ko: "프랑스어", en: "French",
    script: "Latn", direction: "ltr", spaced: true, scriptVariant: false,
    stt: { webspeech: native("fr-FR"), deepgram: native("fr"), whisper: native("fr") },
    translator: "fr",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "de-DE", base: "de", endonym: "Deutsch", ko: "독일어", en: "German",
    script: "Latn", direction: "ltr", spaced: true, scriptVariant: false,
    stt: { webspeech: native("de-DE"), deepgram: native("de"), whisper: native("de") },
    translator: "de",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "pt-BR", base: "pt", endonym: "Português", ko: "포르투갈어", en: "Portuguese",
    script: "Latn", direction: "ltr", spaced: true, scriptVariant: false,
    stt: { webspeech: native("pt-BR"), deepgram: native("pt-BR"), whisper: native("pt") },
    translator: "pt",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "ar-SA", base: "ar", endonym: "العربية", ko: "아랍어", en: "Arabic",
    script: "Arab", direction: "rtl", spaced: true, scriptVariant: false,
    scriptPattern: ARABIC,
    stt: { webspeech: native("ar-SA"), deepgram: native("ar-SA"), whisper: native("ar") },
    translator: "ar",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "hi-IN", base: "hi", endonym: "हिन्दी", ko: "힌디어", en: "Hindi",
    script: "Deva", direction: "ltr", spaced: true, scriptVariant: false,
    scriptPattern: DEVANAGARI,
    stt: { webspeech: native("hi-IN"), deepgram: native("hi"), whisper: native("hi") },
    translator: "hi",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "bn-BD", base: "bn", endonym: "বাংলা", ko: "벵골어", en: "Bengali",
    script: "Beng", direction: "ltr", spaced: true, scriptVariant: false,
    scriptPattern: BENGALI,
    stt: { webspeech: native("bn-BD"), deepgram: native("bn"), whisper: native("bn") },
    translator: "bn",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "ur-PK", base: "ur", endonym: "اردو", ko: "우르두어", en: "Urdu",
    script: "Arab", direction: "rtl", spaced: true, scriptVariant: false,
    scriptPattern: ARABIC,
    stt: { webspeech: native("ur-PK"), deepgram: native("ur"), whisper: native("ur") },
    translator: null,
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    id: "tr-TR", base: "tr", endonym: "Türkçe", ko: "터키어", en: "Turkish",
    script: "Latn", direction: "ltr", spaced: true, scriptVariant: false,
    stt: { webspeech: native("tr-TR"), deepgram: native("tr-TR"), whisper: native("tr") },
    translator: "tr",
    capabilities: { liveSource: true, liveTarget: true, counter: true },
  },
  {
    // Uyghur is written in a Perso-Arabic script but is a Turkic language and
    // is NOT Arabic, Uzbek, or Turkish. It has its own entry so nothing
    // downstream can quietly reroute it to `ar`, `uz`, or `tr` — a mistake that
    // produces confident, fluent, completely wrong administrative text.
    //
    // Whisper is null rather than experimental: it is not trained on Uyghur, so
    // passing `ug` does not produce Uyghur, it produces confident text in
    // whichever neighbouring language the model decided it heard.
    id: "ug-CN", base: "ug", endonym: "ئۇيغۇرچە", ko: "위구르어", en: "Uyghur",
    script: "Arab", direction: "rtl", spaced: true, scriptVariant: false,
    scriptPattern: ARABIC,
    stt: { webspeech: null, deepgram: null, whisper: null },
    translator: null,
    capabilities: { liveSource: false, liveTarget: true, counter: true },
  },
];

/* --------------------------------------------------------------------------
 * Code-switching
 * ------------------------------------------------------------------------ */

/**
 * How well a recogniser family keeps a SECOND language intact inside a stream
 * whose declared language is the first.
 *
 * This is a different question from `SttFidelity`, which asks how well a
 * provider serves ONE language. A real speaker says "오늘 살펴볼 개념은 social
 * capital입니다", and what happens to those two English words depends entirely
 * on how the decoder was built:
 *
 *   inherent    the model is multilingual by construction and the language tag
 *               only BIASES it. The Whisper family works this way: ask for
 *               Korean and an embedded English phrase still comes back as
 *               English. This is the best case and needs no extra parameter.
 *   multi-model the provider has a dedicated multilingual model reached by its
 *               own language code. Deepgram's `language=multi` is this — and it
 *               is worth stating plainly that KOREAN IS NOT IN THAT SET, so the
 *               product's primary pair cannot use it.
 *   none        monolingual decoding. A foreign span is forced through this
 *               language's phonology and comes back as an invented native-script
 *               approximation. The browser recogniser is here.
 *
 * Declared, never discovered — same principle as `SttFidelity`. Sending
 * `language=multi` to find out whether Korean is supported is a socket that
 * gets refused mid-service.
 */
export type CodeSwitchSupport = "inherent" | "multi-model" | "none";

/**
 * The languages Deepgram's multilingual code-switching model covers.
 *
 * Verified against Deepgram's published Nova-3 multilingual coverage
 * (2026-09): ten languages, and Korean is not one of them. Korean remains a
 * strong MONOLINGUAL Nova-3 model, which is why the product still routes
 * Korean sessions to `ko` and leans on keyterm prompting instead.
 *
 * Kept as bases rather than tags because the multilingual model selects a
 * language, not a region.
 */
const DEEPGRAM_CODE_SWITCH_BASES: ReadonlySet<string> = new Set([
  "en", "es", "fr", "de", "hi", "ru", "pt", "ja", "it", "nl",
]);

/** The code Deepgram's multilingual model is reached by. */
const DEEPGRAM_MULTILINGUAL_CODE = "multi";

/**
 * Whether Deepgram can decode this language as part of a code-switched stream.
 *
 * Both halves matter: the language must be in the multilingual model AND be one
 * Deepgram serves at all, so a language the registry does not route to Deepgram
 * cannot accidentally claim multilingual coverage.
 */
export function deepgramCodeSwitches(code: string): boolean {
  const definition = findLanguage(code);
  return !!definition?.stt.deepgram && DEEPGRAM_CODE_SWITCH_BASES.has(definition.base);
}

/**
 * The language code a Deepgram stream should declare for this pair.
 *
 * `multi` only when Deepgram genuinely covers BOTH sides — otherwise the
 * session's own language, which is what it has always sent. Returning null
 * means Deepgram cannot serve the source language at all, exactly as
 * `deepgramLanguage` already reported.
 */
export function deepgramStreamLanguage(
  source: string | undefined,
  guest?: string,
): string | null {
  const primary = findLanguage(source ?? "")?.stt.deepgram?.code ?? null;
  if (!primary) return null;
  if (!guest) return primary;
  if (findLanguage(source ?? "")?.base === findLanguage(guest)?.base) return primary;
  return deepgramCodeSwitches(source ?? "") && deepgramCodeSwitches(guest)
    ? DEEPGRAM_MULTILINGUAL_CODE
    : primary;
}

/* --------------------------------------------------------------------------
 * Lookup
 * ------------------------------------------------------------------------ */

const tagKey = (code: string): string => code.trim().toLowerCase().replace(/_/g, "-");

const BY_ID = new Map(LANGUAGES.map((language) => [tagKey(language.id), language]));
const BY_BASE = new Map<string, LanguageDefinition>();
for (const language of LANGUAGES) {
  if (!BY_BASE.has(language.base)) BY_BASE.set(language.base, language);
}

/**
 * Tags a browser, an OS, or a hand-typed configuration really emits, and which
 * the base-language fallback alone resolves to the wrong entry.
 *
 * Two families matter:
 *
 *  - Chinese script subtags. `zh-Hant-TW` and `zh-HK` fall through to the first
 *    `zh` entry, so a Traditional-script reader is handed Simplified Chinese
 *    without ever being asked.
 *  - Uyghur. It has ISO 639-2/3 aliases (`uig`) and is routinely written with
 *    an explicit script subtag. It must never resolve to Arabic or Uzbek merely
 *    because it shares a script with one and a language family with the other.
 */
const TAG_ALIASES: Record<string, string> = {
  "zh-hant": "zh-TW",
  "zh-hant-tw": "zh-TW",
  "zh-hant-hk": "zh-TW",
  "zh-hant-mo": "zh-TW",
  "zh-hk": "zh-TW",
  "zh-mo": "zh-TW",
  "zh-hans": "zh-CN",
  "zh-hans-cn": "zh-CN",
  "zh-hans-sg": "zh-CN",
  "zh-sg": "zh-CN",
  cmn: "zh-CN",
  "fil-ph": "tl-PH",
  fil: "tl-PH",
  uig: "ug-CN",
  "ug-arab": "ug-CN",
  "ug-arab-cn": "ug-CN",
  "ug-latn": "ug-CN",
  "ug-cyrl": "ug-CN",
};

/**
 * BCP-47 tags are case-insensitive. Resolve an exact language+region/script
 * match before falling back to the base language. Without that ordering,
 * lowercase `zh-tw` falls through to the first `zh` entry (`zh-CN`) and
 * silently turns Traditional Chinese into Simplified Chinese.
 */
export function findLanguage(code: string): LanguageDefinition | undefined {
  const key = tagKey(code);
  const alias = TAG_ALIASES[key];
  if (alias) return BY_ID.get(tagKey(alias));
  const direct = BY_ID.get(key);
  if (direct) return direct;

  // Strip a script subtag before the base fallback so `xx-Scpt-RR` resolves the
  // same way `xx-RR` does, instead of only ever reaching the base entry.
  const parts = key.split("-");
  if (parts.length >= 3) {
    const withoutScript = BY_ID.get(`${parts[0]}-${parts.slice(2).join("-")}`);
    if (withoutScript) return withoutScript;
  }
  return BY_BASE.get(parts[0]);
}

/** The registry tag for an arbitrary input tag, or the trimmed input when unknown. */
export const normaliseLanguageTag = (code: string): string =>
  findLanguage(code)?.id ?? code.trim();

export const isSupportedLanguage = (code: string): boolean => !!findLanguage(code);

/** Display name for the model prompt and for logs. */
export const languageName = (code: string): string => findLanguage(code)?.en ?? code;

/** Endonym, for a picker a speaker of that language has to read. */
export const languageEndonym = (code: string): string =>
  findLanguage(code)?.endonym ?? code;

export const languageDirection = (code: string): LanguageDirection =>
  findLanguage(code)?.direction ?? "ltr";

/** True for writing systems that do not separate words with spaces. */
export const isSpacedScript = (code: string): boolean =>
  findLanguage(code)?.spaced ?? true;

/**
 * Best guess at someone's language from their browser.
 *
 * Only ever a *suggestion*: a picker pre-selects it and the person confirms.
 * Guessing silently and being wrong is worse than asking, because they may not
 * be able to read the wrong guess well enough to fix it.
 */
export function suggestLanguage(
  navigatorLanguages: readonly string[] | undefined,
  fallback = "en-US",
): string {
  for (const candidate of navigatorLanguages ?? []) {
    const match = findLanguage(candidate);
    if (match) return match.id;
  }
  return fallback;
}

/** Languages a visitor picker shows first — the common ones at a Korean desk. */
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

/* --------------------------------------------------------------------------
 * Live Interpretation
 * ------------------------------------------------------------------------ */

export const LIVE_SOURCE_LANGUAGES: LanguageDefinition[] = LANGUAGES.filter(
  (language) => language.capabilities.liveSource,
);

export const LIVE_TARGET_LANGUAGES: LanguageDefinition[] = LANGUAGES.filter(
  (language) => language.capabilities.liveTarget,
);

/** The pair a fresh install starts on. */
export const DEFAULT_LIVE_SOURCE = "ko-KR";
export const DEFAULT_LIVE_TARGET = "en-US";

export type LanguagePairProblem = "unknown-source" | "unknown-target" | "same-language";

/**
 * Whether a live session may be started on this pair, and why not when it may
 * not. Checked BEFORE Start rather than after the microphone opens: an
 * unsupported pair is a disabled control, never a mid-session failure.
 */
export function liveLanguagePairProblem(
  source: string,
  target: string,
): LanguagePairProblem | null {
  const from = findLanguage(source);
  const to = findLanguage(target);
  if (!from?.capabilities.liveSource) return "unknown-source";
  if (!to?.capabilities.liveTarget) return "unknown-target";
  // Same base language is not interpretation; zh-CN → zh-TW is transliteration
  // rather than the job this console does.
  if (from.base === to.base) return "same-language";
  return null;
}

/**
 * The Chrome Translator pair for the on-device fast lane, or null when either
 * side has no code. Never guessed from the base subtag: asking the Translator
 * for `zh` when the reader chose Traditional is the same script-variant bug
 * one layer up.
 */
export function translatorPair(
  source: string,
  target: string,
): { source: string; target: string } | null {
  const from = findLanguage(source)?.translator;
  const to = findLanguage(target)?.translator;
  return from && to ? { source: from, target: to } : null;
}
