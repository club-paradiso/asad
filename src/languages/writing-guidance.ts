/**
 * Per-language writing and recogniser guidance for prompts.
 *
 * Two consumers, one table. The Counter prompt (`counter/prompt.ts`) grew
 * these lines first — how a target language should be written, and what its
 * speech recogniser tends to get wrong — and the Live prompt needed the same
 * facts once it stopped being hard-wired to Korean → English. Keeping them
 * here, keyed by the canonical registry id, means a language is described
 * once and both prompts agree on the script it is written in.
 *
 * `targetLanguageGuidance` / `sourceVoiceGuidance` are the Counter's lines,
 * byte-for-byte — the Counter's tests are the proof that moving them changed
 * nothing. `targetWritingGuidance` / `sourceSpeechGuidance` are the Live
 * variants: the same orthography facts without the service-counter register,
 * because a sermon or a lecture is not a help desk.
 */
import { languageDisplayName, resolveLanguage } from "./registry";

/** Canonical registry id for any tag, or the lower-cased tag when unknown. */
const keyFor = (tag: string): string => resolveLanguage(tag)?.id ?? tag.trim().toLowerCase();

/* --------------------------------------------------------------------------
 * Counter — service-desk register. Do not edit wording without the Counter's
 * prompt tests in front of you.
 * ------------------------------------------------------------------------ */

const UYGHUR_TARGET = [
  "TARGET WRITING: Use modern Uyghur in the Perso-Arabic script (ئۇيغۇر ئەرەب يېزىقى).",
  "Uyghur is a Turkic language written in an Arabic-derived script. It is NOT Arabic, NOT Uzbek, and NOT Turkish. Do not output Arabic, Uzbek, or Turkish, and do not substitute vocabulary from them.",
  "Keep Latin-script administrative tokens exactly as written and in Latin script — residence status codes such as E-7 or D-10, HiKorea, ARC, phone numbers, passport numbers, and dates in numerals. Do not transliterate them into Arabic script and do not reorder their characters.",
].join(" ");

const COUNTER_TARGET_WRITING: Record<string, string> = {
  "zh-CN":
    "TARGET WRITING: Use natural Mainland Mandarin in Simplified Chinese (简体中文). Do not output pinyin or Traditional Chinese unless the source explicitly contains it.",
  "zh-TW":
    "TARGET WRITING: Use natural Taiwan Mandarin in Traditional Chinese (繁體中文). Do not output pinyin or Simplified-only wording unless the source explicitly contains it.",
  "ja-JP":
    "TARGET WRITING: Use natural modern Japanese service-counter speech. Prefer ordinary polite Japanese, not stiff legalistic prose.",
  "ko-KR":
    "TARGET WRITING: Use natural Korean 존댓말 suitable for a public-facing counter. Avoid translationese and unnecessary Sino-Korean formality.",
  "vi-VN":
    "TARGET WRITING: Use natural contemporary Vietnamese for a service counter. Do not invent kinship terms when the relationship is unknown.",
  "th-TH":
    "TARGET WRITING: Use clear contemporary Thai suitable for a service counter, with natural politeness and no added explanation.",
  "id-ID":
    "TARGET WRITING: Use natural contemporary Indonesian suitable for a public-facing service interaction.",
  "ar-SA":
    "TARGET WRITING: Use clear Modern Standard Arabic appropriate for a service interaction unless the source itself requires a named dialect expression.",
  "ru-RU":
    "TARGET WRITING: Use natural contemporary Russian suitable for a service counter, preserving formal/informal address without becoming bureaucratic.",
  "mn-MN": "TARGET WRITING: Use natural modern Mongolian in Cyrillic suitable for a service interaction.",
  "uz-UZ":
    "TARGET WRITING: Use natural modern Uzbek in Latin script unless the source explicitly requires another script.",
  "ne-NP": "TARGET WRITING: Use clear modern Nepali in Devanagari suitable for a service interaction.",
  "km-KH": "TARGET WRITING: Use clear modern Khmer suitable for a service counter.",
  "my-MM": "TARGET WRITING: Use clear modern Burmese suitable for a service counter.",
  "ug-CN": UYGHUR_TARGET,
};

const LOWER_RESOURCE_ASR =
  "LOWER-RESOURCE ASR: Treat odd tokens as possible recognition errors, but repair only when grammar and recent context make the intended reading clear. Never silently guess names, numbers, dates, documents, or identifiers.";

const COUNTER_SOURCE_VOICE: Record<string, string> = {
  "zh-CN":
    "MANDARIN ASR: Spoken Mandarin may contain homophone substitutions or missing word boundaries. Repair only when one reading is strongly supported by grammar and recent turns. Preserve names, numbers, dates, document names, visa/status codes, and addresses exactly as recognized when uncertain; lower confidence instead of guessing.",
  "zh-TW":
    "TAIWAN MANDARIN ASR: Spoken Mandarin may contain homophone substitutions, mixed Simplified/Traditional characters, or missing boundaries. Normalize obvious script noise only when meaning is unchanged. Never guess a name, number, date, document, status code, or address.",
  "vi-VN":
    "VIETNAMESE ASR: Be alert to missing tone distinctions and short function-word errors. Repair only obvious grammatical artifacts; do not guess names, numbers, dates, or document terms.",
  "th-TH":
    "THAI ASR: Word boundaries may be absent or inconsistent. Re-segment obvious phrases for understanding, but do not alter factual values or proper nouns.",
  "ar-SA":
    "ARABIC ASR: Dialectal speech may be rendered imperfectly in standard spelling. Translate the intended utterance only when strongly supported; preserve uncertain names and factual values and lower confidence.",
  "mn-MN": LOWER_RESOURCE_ASR,
  "uz-UZ": LOWER_RESOURCE_ASR,
  "ne-NP": LOWER_RESOURCE_ASR,
  "km-KH": LOWER_RESOURCE_ASR,
  "my-MM": LOWER_RESOURCE_ASR,
};

/** The Counter's target-writing line for a language, or null when it has none. */
export function targetLanguageGuidance(targetLang: string): string | null {
  return COUNTER_TARGET_WRITING[keyFor(targetLang)] ?? null;
}

/** The Counter's recogniser-noise line for a spoken source language, or null. */
export function sourceVoiceGuidance(sourceLang: string): string | null {
  return COUNTER_SOURCE_VOICE[keyFor(sourceLang)] ?? null;
}

/* --------------------------------------------------------------------------
 * Live — register-neutral. One line each; the live system prompt is billed on
 * every call and these are sent on all of them.
 * ------------------------------------------------------------------------ */

const LIVE_TARGET_WRITING: Record<string, string> = {
  "ko-KR":
    "TARGET WRITING: Korean, natural spoken 존댓말 at the level the room calls for. No translationese, no unnecessary Sino-Korean formality.",
  "zh-CN":
    "TARGET WRITING: Simplified Chinese (简体中文), natural spoken Mandarin. Never output Traditional characters or pinyin.",
  "zh-TW":
    "TARGET WRITING: Traditional Chinese (繁體中文), natural spoken Taiwan Mandarin. Never output Simplified characters or pinyin.",
  "ja-JP":
    "TARGET WRITING: Japanese, natural spoken polite form (です・ます) unless the room is plainly informal. No stiff written prose.",
  "vi-VN":
    "TARGET WRITING: Vietnamese, natural contemporary spoken register with full diacritics. Do not invent kinship terms when the relationship is unknown.",
  "th-TH":
    "TARGET WRITING: Thai, clear contemporary spoken register with natural politeness particles.",
  "id-ID": "TARGET WRITING: Indonesian, natural contemporary spoken register.",
  "ru-RU":
    "TARGET WRITING: Russian, natural spoken register; keep formal/informal address as the speaker set it.",
  "uk-UA": "TARGET WRITING: Ukrainian, natural spoken register. Never drift into Russian.",
  "ar-SA":
    "TARGET WRITING: Modern Standard Arabic in Arabic script unless the speaker's own dialect expression must be kept.",
  "mn-MN": "TARGET WRITING: Mongolian in Cyrillic script, natural spoken register.",
  "uz-UZ": "TARGET WRITING: Uzbek in Latin script, natural spoken register.",
  "ne-NP": "TARGET WRITING: Nepali in Devanagari, natural spoken register.",
  "hi-IN": "TARGET WRITING: Hindi in Devanagari, natural spoken register. No romanised Hindi.",
  "bn-BD": "TARGET WRITING: Bengali in Bengali script, natural spoken register.",
  "ur-PK": "TARGET WRITING: Urdu in Nastaliq/Arabic script, natural spoken register. No romanised Urdu.",
  "km-KH": "TARGET WRITING: Khmer in Khmer script, natural spoken register.",
  "my-MM": "TARGET WRITING: Burmese in Myanmar script, natural spoken register.",
  "tr-TR": "TARGET WRITING: Turkish, natural spoken register.",
  "tl-PH": "TARGET WRITING: Tagalog, natural spoken register; keep the code-switching a Filipino speaker would.",
  "ug-CN":
    "TARGET WRITING: Uyghur in the Perso-Arabic script (ئۇيغۇر ئەرەب يېزىقى). Uyghur is Turkic and is NOT Arabic, NOT Uzbek and NOT Turkish — never output those or borrow their vocabulary. Keep Latin-script codes, numbers and names in Latin script, unchanged.",
};

const LIVE_SOURCE_SPEECH: Record<string, string> = {
  "zh-CN":
    "SOURCE SPEECH: Recognised Mandarin may carry homophone substitutions and missing word boundaries. Read for the intended phrase only where grammar and context make it clear; never guess a name or a number.",
  "zh-TW":
    "SOURCE SPEECH: Recognised Taiwan Mandarin may carry homophone substitutions and mixed Simplified/Traditional characters. Treat script noise as noise; never guess a name or a number.",
  "vi-VN":
    "SOURCE SPEECH: Recognised Vietnamese may lose tone marks and short function words. Repair only the obvious; never guess a name or a number.",
  "th-TH":
    "SOURCE SPEECH: Recognised Thai may arrive without reliable word boundaries. Re-segment for sense; never alter a name or a number.",
  "ar-SA":
    "SOURCE SPEECH: Dialectal Arabic may be rendered in standard spelling. Interpret the intended utterance only when clearly supported; mark the rest low.",
  "ja-JP":
    "SOURCE SPEECH: Recognised Japanese may pick the wrong kanji for a homophone. Read for sense; never guess a name.",
};

const GENERIC_ASR =
  "SOURCE SPEECH: Recognition for this language is less reliable. Treat odd tokens as possible recogniser errors, repair only where grammar and context make the reading clear, and never guess a name or a number.";

/** Languages whose recognisers are thin enough that the model should be told so. */
const LOWER_RESOURCE_SOURCES = new Set(["mn-MN", "uz-UZ", "ne-NP", "km-KH", "my-MM", "ug-CN", "bn-BD", "ur-PK"]);

/**
 * One line telling the live model how the target language is written. Null
 * for English, which is the language the contract is already written in and
 * needs no reminder — this keeps the Korean → English prompt byte-identical to
 * the one measured in production.
 */
export function targetWritingGuidance(targetLang: string): string | null {
  const key = keyFor(targetLang);
  if (key === "en-US") return null;
  const known = LIVE_TARGET_WRITING[key];
  if (known) return known;
  const language = resolveLanguage(targetLang);
  if (!language) return null;
  return `TARGET WRITING: ${languageDisplayName(key)}, natural spoken register in its standard script.`;
}

/** One line on what the source recogniser tends to get wrong, or null when nothing is worth saying. */
export function sourceSpeechGuidance(sourceLang: string): string | null {
  const key = keyFor(sourceLang);
  const known = LIVE_SOURCE_SPEECH[key];
  if (known) return known;
  return LOWER_RESOURCE_SOURCES.has(key) ? GENERIC_ASR : null;
}
