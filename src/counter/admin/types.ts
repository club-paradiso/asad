/**
 * Administrative Meaning Layer — shared types.
 *
 * The layer is an ASSISTANCE component that sits beside the translation, never
 * inside it. Its outputs are separate structured fields on a Counter message:
 *
 *   - faithful translation           → `CounterMessage.translatedText` (unchanged)
 *   - terminology annotations        → `AdministrativeAnalysis.terms`
 *   - ambiguity findings             → `AdministrativeAnalysis.ambiguities`
 *   - suggested clarification        → `AdministrativeAnalysis.clarifications`
 *   - staff-confirmed interpretation → `CounterMessage.staffReview`
 *
 * Nothing here rewrites what anyone said, and nothing here decides an
 * administrative outcome.
 */

/** Base language subtags covered by the registry. Other languages fall back to Korean/English anchors. */
export type RegistryLanguage =
  | "ko"
  | "en"
  | "zh-Hans"
  | "zh-Hant"
  | "vi"
  | "id"
  | "ru"
  | "th"
  | "mn"
  | "uz";

/**
 * How much a translation can be trusted as THE term.
 *
 * - `verified`    — checked against a cited official source by a named reviewer.
 *                   No entry in this repository is `verified` today; the type
 *                   exists so a reviewer can promote one without a schema change.
 * - `curated`     — the repository's long-standing Korean/English pairing,
 *                   consistent with how Korean immigration labels procedures in
 *                   English, but not yet re-checked against a dated source.
 * - `provisional` — written for this registry to support detection and
 *                   consistency. Never to be presented as official.
 */
export type TermVerification = "verified" | "curated" | "provisional";

export interface LocalizedTerm {
  /** The rendering to use for consistency within a conversation. */
  term: string;
  status: TermVerification;
  /**
   * Extra surface forms that count as this term when matching (inflections,
   * spacing variants). Not shown to users.
   */
  forms?: readonly string[];
  /** Set false when `term` is too generic to match on its own (e.g. bare "허가"). */
  matchTerm?: boolean;
}

export type VariantKind =
  /** Another acceptable official-register wording. */
  | "alternative"
  /** How people actually say it at the desk; may be imprecise or ambiguous. */
  | "colloquial"
  /** A known speech-recognition mishearing. */
  | "asr-error"
  /** A known machine-translation mistranslation. */
  | "mt-error";

export interface TermVariant {
  lang: RegistryLanguage;
  text: string;
  kind: VariantKind;
  /** Why this variant is risky, for staff. Korean, short. */
  note?: string;
}

export interface SourceReference {
  authority: string;
  url: string;
  /**
   * What the reference is for. A URL here means "check against this", never
   * "this term was confirmed on this page" unless `revisedOn` and a reviewer
   * are set.
   */
  note: string;
  /** Date the term was last checked against the source. Null = never checked. */
  revisedOn: string | null;
}

export interface HumanReview {
  state: "not-reviewed" | "reviewed";
  reviewer?: string;
  reviewedOn?: string;
}

export type ConceptCategory =
  | "registration"
  | "permission"
  | "report"
  | "procedure-stage"
  | "deadline"
  | "enforcement"
  | "protection"
  | "service"
  | "document";

export interface AdminConcept {
  /** Stable identifier. Never renamed; referenced by tests, benchmarks and stored analyses. */
  id: string;
  category: ConceptCategory;
  /** Canonical Korean administrative term (display). */
  ko: string;
  terms: Partial<Record<RegistryLanguage, LocalizedTerm>>;
  variants: readonly TermVariant[];
  /** Usage restrictions, Korean, for staff and for the prompt. */
  restrictions?: readonly string[];
  /** Concepts this one is routinely confused with. Drives semantic checks. */
  confusableWith?: readonly string[];
  /** Data class that should apply when this concept is discussed. */
  dataClass: "general" | "refugee" | "judicial";
  /**
   * Statutory basis of the KOREAN canonical term, where one exists. This
   * grounds the Korean wording only — it says nothing about any translation.
   */
  koBasis?: { law: string; article: string; checkedOn: string };
  reference: SourceReference;
  review: HumanReview;
}

/* -------------------------------------------------------------------------- */
/* Analysis output                                                            */
/* -------------------------------------------------------------------------- */

export type MatchKind = "term" | VariantKind;

export interface TermMatch {
  conceptId: string;
  /** Exact substring of the analysed text. */
  text: string;
  kind: MatchKind;
  start: number;
  end: number;
}

export interface TermAnnotation {
  conceptId: string;
  /** What the speaker said. */
  heard: string;
  kind: MatchKind;
  /** Canonical Korean term (staff-facing). */
  ko: string;
  /** Consistent English rendering. */
  en: string;
  enStatus: TermVerification;
  /** Rendering in the other party's language, when the registry has one. */
  target?: { lang: string; term: string; status: TermVerification };
  note?: string;
}

export type AmbiguityKind = "procedural" | "terminology";

export interface AmbiguityFinding {
  ruleId: string;
  kind: AmbiguityKind;
  /** Exact source spans that triggered the finding. */
  evidence: string[];
  /** Candidate concepts. Never pre-selected. */
  candidates: Array<{ conceptId: string; ko: string; en: string }>;
  /** Korean explanation for staff. */
  explanation: string;
}

export interface ClarificationSuggestion {
  ruleId: string;
  /** A neutral question the STAFF may choose to send as their own utterance. */
  ko: string;
  en: string;
}

export type UncertaintyLevel = "none-detected" | "present" | "unmeasured" | "not-applicable";

/**
 * Four separate uncertainty dimensions. Deliberately not collapsed into one
 * percentage: a confident translation of a misheard word is not "90% right".
 */
export interface UncertaintyBreakdown {
  /** Did the recogniser hear it right? The server has no acoustic score, so voice turns are `unmeasured`. */
  acoustic: { level: UncertaintyLevel; reason: string };
  /** Colloquial, misheard or provisional terminology involved. */
  terminology: { level: UncertaintyLevel; reason: string };
  /** More than one administrative procedure fits what was said. */
  procedural: { level: UncertaintyLevel; reason: string };
  /** Model-reported confidence plus automatic checks. */
  translation: { level: UncertaintyLevel; reason: string };
}

export interface AdministrativeAnalysis {
  version: 1;
  terms: TermAnnotation[];
  ambiguities: AmbiguityFinding[];
  clarifications: ClarificationSuggestion[];
  uncertainty: UncertaintyBreakdown;
}
