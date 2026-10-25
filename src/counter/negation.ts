/**
 * Did the negation survive?
 *
 * At a service counter this is the failure that costs the most and shows the
 * least. Every numeric check in `integrity.ts` passes identically for "I did
 * not change my workplace" and "I changed my workplace": same verb, same
 * absence of numbers, opposite meaning, and one of the two puts a person in
 * breach of a reporting duty they have not breached.
 *
 * So this asks one narrow question — does the source carry negation, and does
 * the translation — and refuses to answer it for languages where it cannot be
 * asked honestly.
 *
 * ## Why some languages are deliberately absent
 *
 * Negation is a standalone word in some languages and a suffix in others.
 * Uzbek "o'zgartirmadim" and Nepali "गरेको छैन" negate without any token this
 * kind of matcher can see, so a table for them would report "the negation was
 * dropped" on almost every correctly translated turn. A warning that fires on
 * every turn is not a warning; people stop reading it, and then it fails to
 * fire for Korean and English too, where it works.
 *
 * A language with no table produces no verdict at all. That is a known gap,
 * recorded honestly, rather than a guess dressed up as a check.
 */

/**
 * Markers per base language tag.
 *
 * Space-delimited languages use word boundaries; scripts that do not separate
 * words use substring matching, which is what their negation morphology
 * actually looks like.
 */
interface NegationRules {
  /** Matched with word boundaries. Latin/Cyrillic-style orthographies. */
  words?: readonly string[];
  /** Matched anywhere in the text. For scripts without word spacing. */
  substrings?: readonly string[];
  /** Escape hatch for morphology a word list cannot express. */
  patterns?: readonly RegExp[];
  /**
   * Removed from the text before any marker is looked for. These are the
   * places a negation marker appears without negating anything: question
   * particles, politeness formulae, numbering abbreviations.
   */
  exclusions?: readonly RegExp[];
}

const RULES: Record<string, NegationRules> = {
  en: {
    words: [
      "not", "no", "never", "none", "neither", "nor", "cannot", "without",
      "unable", "nothing", "nobody", "unless",
    ],
    patterns: [/\b\w+n['’]t\b/i, /\bnon-/i],
    // "Counter No. 2" is a number, not a refusal.
    exclusions: [/\bno\.\s*\d/gi],
  },
  ko: {
    substrings: ["않", "없", "못", "아니", "아닙", "말고", "불가", "금지", "미납", "안돼", "안 돼", "안 되"],
    // Standalone 안 before a verb. Bare substring matching would fire on
    // 안내 (information), which an immigration desk says constantly.
    patterns: [/(?:^|[\s(])안\s/u],
  },
  zh: {
    substrings: ["不", "没", "無", "无", "未", "别", "非", "勿", "禁止"],
    // A-not-A questions ask, they do not negate: 是不是 / 有没有 / 可不可以.
    // And 不好意思, 不客气, 没关系 are courtesy, which the Korean or English
    // side renders without any negation at all.
    exclusions: [
      /是不是|有没有|有沒有|可不可以|能不能|好不好|对不对|對不對|行不行|要不要|会不会|會不會|用不用|需不需要|去不去|来不来|來不來|想不想|是否/g,
      /不好意思|不客气|不客氣|不用谢|不用謝|没关系|沒關係|没问题|沒問題|不错|不錯/g,
    ],
  },
  ja: {
    // 不 and 無 alone fired on 無料 (free of charge) and 不便, both of which a
    // reception desk says all day; ぬ as a bare syllable fired on 死ぬ and
    // ぬるい. The surviving markers are the ones that actually negate a verb.
    substrings: ["ない", "ません", "いいえ", "だめ", "ダメ", "できません", "不可", "禁止", "なし", "無し", "未提出", "未納"],
    exclusions: [/ませんか|のではないですか|んじゃないですか|じゃないですか/g],
  },
  vi: {
    words: ["không", "chẳng", "đừng", "chớ", "khỏi"],
    // không / chưa close a yes-no question ("Bạn có hẹn không?") as often as
    // they negate one. Only a sentence-final particle is excused; a mid-
    // sentence không is still a negation.
    exclusions: [/\b(?:không|chưa)(?=\s*(?:[?？!]|$))/giu, /\b(?:phải|đúng|được|hay)\s+không\b/giu],
    patterns: [/(?<![\p{L}])chưa(?![\p{L}])(?!\s*[?？])/iu],
  },
  th: { substrings: ["ไม่", "ห้าม", "ยังไม่"] },
  id: { words: ["tidak", "bukan", "belum", "jangan", "tanpa", "tak"] },
  ru: { words: ["не", "нет", "ни", "без", "нельзя", "никогда", "никакой"] },
  es: {
    words: ["no", "nunca", "nada", "ningún", "ninguna", "ninguno", "sin", "tampoco", "jamás"],
  },
  fr: {
    words: ["ne", "n'", "pas", "jamais", "aucun", "aucune", "sans", "non", "rien", "ni"],
  },
  de: {
    words: ["nicht", "kein", "keine", "keinen", "keinem", "keiner", "nie", "niemals", "ohne", "nein", "nichts"],
  },
  pt: {
    words: ["não", "nao", "nunca", "nenhum", "nenhuma", "sem", "nada", "jamais"],
  },
  ar: { substrings: ["لا ", "لم ", "لن ", "ليس", "غير", "بدون", "ممنوع", "ما لم"] },
  ur: { substrings: ["نہیں", "نہ ", "بغیر", "ممنوع", "کبھی نہیں"] },
  hi: { substrings: ["नहीं", "ना ", "बिना", "मत ", "कभी नहीं"] },
  bn: { substrings: ["না", "নেই", "নয়", "ছাড়া", "কখনো না"] },
  tl: { words: ["hindi", "wala", "walang", "huwag", "di", "ayaw"] },
  mn: {
    // -гүй is Mongolian's negative suffix and is reliable as a substring.
    substrings: ["гүй", "биш", "үгүй", "бүү"],
  },
  tr: {
    words: ["değil", "yok", "hayır", "asla", "hiç", "hiçbir", "olmaz", "yoktur"],
    // Turkish negates mostly by suffix, so the common verbal families are
    // matched explicitly rather than pretending the word list is enough.
    // No trailing boundary after the tense marker: person endings follow it
    // ("değiştirmedim" is -me-di-m), and requiring a word break there missed
    // every first-person statement — which is most of what a visitor says.
    // A leading letter is required so "mezar" and "meze" are not negations.
    patterns: [
      /\p{L}+m[ae](?:d[ıiuü]|[ıiuü]yor|y[ae]c[ae][kğ]|[mM]?[ıiuü]ş|z(?![\p{L}]))/iu,
    ],
  },
};

/** Languages this check knowingly does not cover. Exported so it is testable. */
export const NEGATION_UNCOVERED_LANGUAGES: readonly string[] = [
  "uz", "ne", "km", "my", "ug",
];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const baseTag = (language: string | undefined) =>
  (language ?? "").trim().toLowerCase().split("-")[0];

export const negationCheckAvailable = (language: string | undefined): boolean =>
  Object.hasOwn(RULES, baseTag(language));

/**
 * Whether the text negates something.
 *
 * `null` means "this language has no table" — a different answer from `false`,
 * and the reason callers must not treat a missing table as "no negation".
 */
export function hasNegation(text: string, language: string | undefined): boolean | null {
  const rules = RULES[baseTag(language)];
  if (!rules) return null;
  let value = text.normalize("NFC");
  if (!value.trim()) return false;
  for (const exclusion of rules.exclusions ?? []) {
    exclusion.lastIndex = 0;
    value = value.replace(exclusion, " ");
  }

  for (const substring of rules.substrings ?? []) {
    if (value.includes(substring)) return true;
  }
  for (const word of rules.words ?? []) {
    // `\b` is unreliable next to apostrophes and non-ASCII letters, so the
    // boundary is expressed as "not adjacent to another letter".
    const boundary = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`,
      "iu",
    );
    if (boundary.test(value)) return true;
  }
  for (const pattern of rules.patterns ?? []) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) return true;
  }
  return false;
}

export type NegationVerdict = "preserved" | "dropped" | "added" | "unknown";

/**
 * Compare negation across a translation.
 *
 * `unknown` whenever either side is uncheckable. Silence is the correct output
 * for a language without a table: a guess here would be indistinguishable from
 * a finding, and this warning is only worth anything while people still trust
 * it.
 */
export function compareNegation(
  sourceText: string,
  targetText: string,
  sourceLanguage: string | undefined,
  targetLanguage: string | undefined,
): NegationVerdict {
  const source = hasNegation(sourceText, sourceLanguage);
  const target = hasNegation(targetText, targetLanguage);
  if (source === null || target === null) return "unknown";
  if (source === target) return "preserved";
  return source ? "dropped" : "added";
}
