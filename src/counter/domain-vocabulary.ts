/**
 * The words an immigration desk actually uses.
 *
 * Two problems share one source of truth here.
 *
 * The first is recognition. A general-purpose recogniser hears "E seven" as a
 * letter and a number, "HiKorea" as "hi Korea", and "alien registration" as
 * almost anything. Every streaming vendor in the stack accepts vocabulary
 * hints, and Counter Mode was not sending any — the hint channel existed and
 * went unused, so the desk paid full generic-model error rates on exactly the
 * twenty terms it repeats all day.
 *
 * The second is consistency. If one turn says "extension of stay" and the next
 * says "prolongation of sojourn", a visitor cannot tell whether those are the
 * same procedure. Within one conversation an administrative concept has to keep
 * one name.
 *
 * The Korean/English pairs below are the terms Korean immigration publishes in
 * English. They are not invented here and are not a style preference.
 */
import type { CounterProfileId } from "./profiles";
import { ADMIN_CONCEPTS, registryLanguage } from "./admin/registry";

export interface GlossaryEntry {
  ko: string;
  en: string;
}

/**
 * Every residence-status code in the Korean system.
 *
 * Kept as data rather than a regex because three separate things need the same
 * list: recogniser hints, transcript normalisation, and the integrity check
 * that notices when E-7 came out of a translation as F-7.
 */
export const RESIDENCE_STATUS_CODES: readonly string[] = [
  "A-1", "A-2", "A-3",
  "B-1", "B-2",
  "C-1", "C-2", "C-3", "C-4",
  "D-1", "D-2", "D-3", "D-4", "D-5", "D-6", "D-7", "D-8", "D-9", "D-10",
  "E-1", "E-2", "E-3", "E-4", "E-5", "E-6", "E-7", "E-8", "E-9", "E-10",
  "F-1", "F-2", "F-3", "F-4", "F-5", "F-6",
  "G-1",
  "H-1", "H-2",
];

const STATUS_CODE_SET = new Set(RESIDENCE_STATUS_CODES);

/** Whether `letter`+`number` is a real residence status, e.g. E + 7. */
export function isResidenceStatusCode(letter: string, digits: string): boolean {
  return STATUS_CODE_SET.has(`${letter.toUpperCase()}-${digits}`);
}

/**
 * Administrative terms whose translation must not drift mid-conversation.
 *
 * A Korean/English view of the concept registry (`./admin/registry.ts`), which
 * is now the single source of truth for every language. Kept as an export for
 * callers that only need the pairs.
 *
 * Correction carried by the registry: the old list called 근무처 변경·추가 a
 * "report". Under 출입국관리법 제21조 it is in principle a prior PERMISSION,
 * and only some professionals file a report afterwards — so the pairing is now
 * "change or addition of workplace", which does not decide that for anyone.
 */
export const IMMIGRATION_GLOSSARY: readonly GlossaryEntry[] = [
  ...ADMIN_CONCEPTS.filter((concept) => concept.terms.ko && concept.terms.en).map((concept) => ({
    ko: concept.terms.ko!.term,
    en: concept.terms.en!.term,
  })),
  { ko: "여권", en: "passport" },
  { ko: "하이코리아", en: "HiKorea" },
  { ko: "출입국·외국인청", en: "immigration office" },
  { ko: "통합신청서", en: "integrated application form" },
];

/**
 * Terms that carry no reliable published translation in a given language.
 *
 * Uyghur is the case this exists for. A model asked for an Uyghur rendering of
 * "체류자격 변경허가" will produce something fluent every time, and there is no
 * way from inside this repository to verify it is the term an Uyghur speaker
 * would recognise — or that it will be the same term on the next turn. Rather
 * than freezing an unverified invention into a glossary and treating it as
 * canonical, the prompt is told to keep the Latin code or acronym visible and
 * stay self-consistent within the conversation.
 */
export const UNVERIFIED_GLOSSARY_LANGUAGES: readonly string[] = ["ug"];

export const hasVerifiedGlossary = (language: string | undefined): boolean =>
  !UNVERIFIED_GLOSSARY_LANGUAGES.includes((language ?? "").split("-")[0].toLowerCase());

/**
 * The statuses actually spoken at the desk.
 *
 * All forty-one codes as keyterms would crowd out the Korean vocabulary and
 * bloat the Deepgram socket URL for no gain — a hint list works because it is
 * short. The full list stays available for validation, where completeness
 * genuinely matters.
 */
const COMMON_STATUS_CODES: readonly string[] = [
  "D-2", "D-4", "D-8", "D-10",
  "E-7", "E-9",
  "F-2", "F-4", "F-5", "F-6",
  "H-2",
];

/** Latin tokens that must survive recognition and translation unchanged. */
const UNIVERSAL_KEYTERMS: readonly string[] = [
  "HiKorea",
  "ARC",
  "1345",
  ...COMMON_STATUS_CODES,
];

const KOREAN_KEYTERMS: readonly string[] = [
  "체류기간",
  "체류자격",
  "체류기간 연장",
  "체류자격 변경",
  "근무처 변경",
  "외국인등록증",
  "외국인등록",
  "체류지 변경",
  "출입국사무소",
  "하이코리아",
  "예약",
  "만료일",
  "신고기한",
  "여권",
  "사증",
  "재입국",
  "통합신청서",
];

const ENGLISH_KEYTERMS: readonly string[] = [
  "alien registration",
  "foreigner registration",
  "residence card",
  "extension of stay",
  "change of status",
  "change of workplace",
  "period of stay",
  "residence status",
  "expiration date",
  "reporting deadline",
  "immigration office",
  "appointment",
  "passport",
  "visa",
  "re-entry permit",
];

/** Concepts a visitor is most likely to name in their own language. */
const HINT_CONCEPTS = [
  "residence-card",
  "stay-extension",
  "status-change",
  "workplace-change",
  "residence-change",
  "reentry-permit",
  "foreigner-registration",
  "appointment",
];

/**
 * Hints for a visitor language from the registry: the term and the commonest
 * colloquial wording for each high-frequency concept.
 *
 * These are PROVISIONAL terms. As recogniser hints that is acceptable — a hint
 * only biases recognition toward words that were actually said — but they are
 * not presented anywhere as official vocabulary.
 */
function registryKeyterms(language: string | undefined): string[] {
  const lang = registryLanguage(language);
  if (!lang || lang === "ko" || lang === "en") return [];
  const terms: string[] = [];
  for (const id of HINT_CONCEPTS) {
    const concept = ADMIN_CONCEPTS.find((candidate) => candidate.id === id);
    if (!concept) continue;
    const term = concept.terms[lang];
    if (term && term.matchTerm !== false) terms.push(term.term);
    const colloquial = concept.variants.find((variant) => variant.lang === lang && variant.kind === "colloquial");
    if (colloquial) terms.push(colloquial.text);
  }
  return terms;
}

/** Keyterms are only worth their query-string cost for the desks that use them. */
const VOCABULARY_PROFILES = new Set<CounterProfileId>(["immigration", "public-office", "refugee"]);

/**
 * Recogniser hints for one Counter turn.
 *
 * Bounded deliberately. Deepgram carries these in the socket URL, and a long
 * list buys diminishing accuracy while making the connection more fragile —
 * which would trade the first-word problem for a worse one.
 */
export function sttKeyterms(
  language: string | undefined,
  profileId: CounterProfileId | undefined,
  limit = 28,
): string[] {
  if (!VOCABULARY_PROFILES.has(profileId ?? "general")) return [];
  const base = (language ?? "").split("-")[0].toLowerCase();
  const spoken =
    base === "ko" ? KOREAN_KEYTERMS : base === "en" ? ENGLISH_KEYTERMS : registryKeyterms(language);
  // Latin codes are said in Latin whatever the surrounding language is: a
  // Vietnamese speaker still says "E seven", not a translation of it.
  const terms = [...spoken, ...UNIVERSAL_KEYTERMS];
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))].slice(0, limit);
}

/** The glossary block for the translation prompt, or null when it adds nothing. */
export function glossaryFor(
  sourceLang: string,
  targetLang: string,
  profileId: CounterProfileId | undefined,
): readonly GlossaryEntry[] | null {
  if (profileId !== "immigration") return null;
  const pair = [sourceLang, targetLang].map((tag) => tag.split("-")[0].toLowerCase());
  // The published pairs are Korean↔English. They are still the right anchor for
  // a Korean↔other turn — the concept is fixed even where the wording is not —
  // but there is no point sending them for a pair that touches neither.
  if (!pair.includes("ko") && !pair.includes("en")) return null;
  return IMMIGRATION_GLOSSARY;
}
