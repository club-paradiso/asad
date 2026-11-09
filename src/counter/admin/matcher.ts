/**
 * Deterministic concept matching.
 *
 * Finds which administrative concepts an utterance mentions, and HOW it
 * mentions them (official term, colloquial, misheard, mistranslated). No model
 * is involved: the same text always yields the same matches, which is what
 * lets the prompt, the semantic checks and the benchmark agree.
 *
 * Boundary rules follow the script:
 *  - Hangul, CJK and Thai have no reliable word spaces → substring match.
 *  - English, Vietnamese, Indonesian → whole-word match.
 *  - Russian, Mongolian, Uzbek inflect heavily → left boundary only, so a
 *    stem matches its case endings.
 */
import { ADMIN_CONCEPTS, REGISTRY_LANGUAGES, registryLanguage } from "./registry";
import type { MatchKind, RegistryLanguage, TermMatch } from "./types";

interface CompiledForm {
  conceptId: string;
  kind: MatchKind;
  pattern: RegExp;
}

const WORD = "[\\p{L}\\p{N}]";
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Uzbek is written with four different apostrophes for oʻ/gʻ. */
const normaliseApostrophes = (value: string) => value.replace(/[‘’'`ʼ]/g, "ʻ");

function boundaryFor(lang: RegistryLanguage): { left: boolean; right: boolean } {
  switch (lang) {
    case "en":
    case "vi":
    case "id":
      return { left: true, right: true };
    case "ru":
    case "mn":
    case "uz":
      return { left: true, right: false };
    default:
      return { left: false, right: false };
  }
}

function compile(lang: RegistryLanguage, text: string): RegExp {
  const { left, right } = boundaryFor(lang);
  // Spaces in a form match any run of whitespace; "·" matches the ways people type it.
  const body = escape(normaliseApostrophes(text.normalize("NFKC")))
    .replace(/\s+/g, "\\s*")
    .replace(/·/g, "[·ㆍ・.,\\s]?");
  return new RegExp(
    `${left ? `(?<!${WORD})` : ""}${body}${right ? `(?!${WORD})` : ""}`,
    "giu",
  );
}

const cache = new Map<RegistryLanguage, CompiledForm[]>();

function formsFor(lang: RegistryLanguage): CompiledForm[] {
  const cached = cache.get(lang);
  if (cached) return cached;
  const forms: CompiledForm[] = [];
  for (const concept of ADMIN_CONCEPTS) {
    const term = concept.terms[lang];
    if (term) {
      const texts = [...(term.matchTerm === false ? [] : [term.term]), ...(term.forms ?? [])];
      for (const text of texts) {
        forms.push({ conceptId: concept.id, kind: "term", pattern: compile(lang, text) });
      }
    }
    for (const variant of concept.variants) {
      if (variant.lang !== lang) continue;
      forms.push({ conceptId: concept.id, kind: variant.kind, pattern: compile(lang, variant.text) });
    }
  }
  cache.set(lang, forms);
  return forms;
}

/** Languages whose forms are searched for an utterance in `language`. */
export function searchLanguages(language: string | undefined): RegistryLanguage[] {
  const primary = registryLanguage(language);
  const out: RegistryLanguage[] = [];
  if (primary) out.push(primary);
  // Code-switching: Latin English administrative words turn up inside every
  // language at a Korean desk ("ARC", "visa extension"), and Korean terms
  // turn up in visitors' speech ("외국인등록증").
  if (!out.includes("en")) out.push("en");
  if (!out.includes("ko")) out.push("ko");
  return out;
}

/** Prefer the official term over a variant when two matches tie. */
const KIND_RANK: Record<MatchKind, number> = {
  term: 0,
  alternative: 1,
  colloquial: 2,
  "asr-error": 3,
  "mt-error": 4,
};

/**
 * All concept mentions in `text`, non-overlapping, in reading order.
 *
 * Overlaps resolve to the LONGEST match: "visa extension" is one colloquial
 * mention of stay-extension, not a mention of "visa" plus noise.
 */
export function matchConcepts(text: string, language: string | undefined): TermMatch[] {
  const source = normaliseApostrophes(text.normalize("NFKC"));
  const candidates: TermMatch[] = [];
  for (const lang of searchLanguages(language)) {
    for (const form of formsFor(lang)) {
      form.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = form.pattern.exec(source)) !== null) {
        if (match[0].length === 0) {
          form.pattern.lastIndex += 1;
          continue;
        }
        candidates.push({
          conceptId: form.conceptId,
          text: match[0],
          kind: form.kind,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }
  }

  candidates.sort(
    (a, b) =>
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind],
  );
  const kept: TermMatch[] = [];
  for (const candidate of candidates) {
    if (kept.some((other) => candidate.start < other.end && other.start < candidate.end)) continue;
    kept.push(candidate);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** Whether any surface form of `conceptId` occurs in `text`, ignoring overlap with longer matches. */
export function conceptMentionedAnywhere(
  text: string,
  language: string | undefined,
  conceptId: string,
): boolean {
  const source = normaliseApostrophes(text.normalize("NFKC"));
  return searchLanguages(language).some((lang) =>
    formsFor(lang).some((form) => {
      if (form.conceptId !== conceptId) return false;
      form.pattern.lastIndex = 0;
      return form.pattern.test(source);
    }),
  );
}

/** The distinct concept ids mentioned in `text`. */
export function conceptIdsIn(text: string, language: string | undefined): Set<string> {
  return new Set(matchConcepts(text, language).map((match) => match.conceptId));
}

/**
 * Sensitive concepts mentioned in `text`, searched in EVERY registry language.
 *
 * Profile detection runs before the session knows which language a turn is in
 * for certain, and a refugee or enforcement turn must never be missed because
 * it was said in Thai instead of Korean. Restricted to sensitive concepts so
 * the all-language scan stays small.
 */
export function sensitiveDataClassIn(text: string): "refugee" | "judicial" | null {
  const source = normaliseApostrophes(text.normalize("NFKC"));
  let judicial = false;
  for (const lang of REGISTRY_LANGUAGES) {
    for (const form of formsFor(lang)) {
      const dataClass = SENSITIVE.get(form.conceptId);
      if (!dataClass) continue;
      form.pattern.lastIndex = 0;
      if (!form.pattern.test(source)) continue;
      // Refugee outranks judicial: it is the narrower, stricter class.
      if (dataClass === "refugee") return "refugee";
      judicial = true;
    }
  }
  return judicial ? "judicial" : null;
}

const SENSITIVE = new Map(
  ADMIN_CONCEPTS.filter((concept) => concept.dataClass !== "general").map(
    (concept) => [concept.id, concept.dataClass as "refugee" | "judicial"],
  ),
);

/** Test seam. */
export const __resetMatcherCache = () => cache.clear();
