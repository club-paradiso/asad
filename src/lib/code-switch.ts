/**
 * Script-level code-switch analysis.
 *
 * A real speaker does not stay inside one language for forty minutes:
 *
 *   "오늘 우리가 살펴볼 개념은 social capital입니다."
 *   "이번 quarter의 conversion rate가 생각보다 낮습니다."
 *   "그래서 제가 말했어요. \"I don't think this is going to work.\""
 *
 * Every layer below the recogniser used to assume the opposite — that a session
 * whose tag is `ko-KR` contains only Hangul — and that assumption is what turned
 * *retrieval augmented generation* into 리트리벌 어그멘티드 제너레이션 on screen.
 *
 * WHAT THIS MODULE IS
 *
 * A deterministic reading of which SCRIPTS a piece of text is written in, and
 * nothing more. It is pure, synchronous, allocation-light and runs on already
 * stabilised units, so it costs no model call and no round trip. That is the
 * whole point: language identification good enough to protect an English noun
 * inside a Korean sentence does not need a classifier, and paying for one on
 * every transcript fragment would be a latency bug wearing a machine-learning
 * costume.
 *
 * WHAT THIS MODULE IS NOT
 *
 * It is NOT language identification. Scripts are not languages: Spanish,
 * English and Vietnamese are all Latin, and no amount of regex separates them.
 * So `analyseCodeSwitch` reports `dominant: "unknown"` for a pair whose two
 * languages share a script, and every consumer must treat that as "no opinion"
 * rather than as evidence. The failure this prevents is the one the brief names
 * — a regex pretending to be universal NLP — and the honest boundary is stated
 * here once rather than rediscovered per caller.
 *
 * It follows that the feature is genuinely useful for exactly the pairs the
 * product is strongest at (Korean/Japanese/Chinese/Cyrillic/Arabic/Thai ↔
 * Latin) and silently inert elsewhere, which is the correct degradation.
 */
import { findLanguage } from "./languages";

/** Latin letters, including the accented ranges a loanword can carry. */
const LATIN = /[A-Za-zÀ-ɏ]/u;

/**
 * Anything that can settle the question of which script a unit is written in.
 *
 * Letters only. Digits, punctuation and spacing are deliberately excluded: a
 * status code or a percentage belongs to whichever language surrounds it, and
 * counting them would make "KPI가 3% 올랐습니다" read as two-fifths English.
 */
const DECIDABLE = /\p{L}/u;

/**
 * A run of Latin script worth protecting downstream.
 *
 * Deliberately permissive about what may sit INSIDE a run — `E-7`, `F-2`,
 * `HTTP 403`, `GPT-4o`, `don't`, `U.S.` — and strict about what may start one,
 * so Korean punctuation never opens a term.
 */
const GUEST_TERM = /[A-Za-z][A-Za-z0-9]*(?:[-'’.][A-Za-z0-9]+)*/gu;

/** How many guest terms one analysis reports. Bounded so a caller cannot be flooded. */
export const MAX_GUEST_TERMS = 12;

/**
 * Minimum share of decidable characters a minority script needs before the unit
 * is called mixed.
 *
 * Below this it is a stray character — a recogniser artefact, a stray `A`, a
 * unit label — and reacting to it would make the console twitch.
 */
export const MIXED_MIN_RATIO = 0.08;

/** Above this share of one script, the unit is simply written in that script. */
export const DOMINANT_RATIO = 0.9;

export type CodeSwitchDominance = "source" | "target" | "mixed" | "unknown";

export interface CodeSwitchAnalysis {
  /** Share of decidable characters written in the source language's script. */
  sourceRatio: number;
  /** Share written in the target language's script. */
  targetRatio: number;
  /**
   * Which language the unit reads as. `unknown` means the two languages share a
   * script, so this module has no opinion and the caller must not invent one.
   */
  dominant: CodeSwitchDominance;
  /** True when both scripts are present in more than trace amounts. */
  mixed: boolean;
  /** Latin runs worth preserving verbatim — names, acronyms, technical terms. */
  guestTerms: string[];
  /** Whether the pair is one this module can say anything about at all. */
  decidable: boolean;
}

const EMPTY: CodeSwitchAnalysis = {
  sourceRatio: 0,
  targetRatio: 0,
  dominant: "unknown",
  mixed: false,
  guestTerms: [],
  decidable: false,
};

/**
 * The pattern that identifies a language's script.
 *
 * The registry carries one for every non-Latin language precisely so the
 * recogniser's alternative ranking can use it; a language without one is Latin,
 * which is the default the registry leaves implicit.
 */
function scriptPatternFor(tag: string | undefined): RegExp {
  return findLanguage(tag ?? "")?.scriptPattern ?? LATIN;
}

/** Two languages are distinguishable here only when their scripts differ. */
export function pairIsScriptDecidable(source: string, target: string): boolean {
  const from = findLanguage(source);
  const to = findLanguage(target);
  if (!from || !to) return false;
  if (from.script === to.script) return false;
  // zh-CN and zh-TW differ by script code but share the Han block, so the
  // character-level test below cannot separate them either.
  return from.base !== to.base;
}

/**
 * Pull out the Latin runs a downstream consumer should protect.
 *
 * Exported because the recogniser's alternative picker wants them without
 * paying for the ratio arithmetic.
 */
export function guestTermsIn(text: string, limit = MAX_GUEST_TERMS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(GUEST_TERM)) {
    const term = match[0];
    // A single letter is a bullet, an initial or noise, never a term.
    if (term.length < 2) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Analyse one already-stabilised unit against the session's language pair.
 *
 * Cheap by construction: one pass over the characters plus one regex sweep for
 * guest terms. Live units are tens of characters, and this runs once per
 * stabilised unit rather than per token.
 */
export function analyseCodeSwitch(
  text: string,
  languages: { source: string; target: string },
): CodeSwitchAnalysis {
  const clean = text.trim();
  if (!clean) return EMPTY;
  if (!pairIsScriptDecidable(languages.source, languages.target)) {
    // Still worth reporting the guest terms: a Latin acronym inside a Latin
    // sentence is not a code switch, but it IS a token worth preserving.
    return { ...EMPTY, guestTerms: guestTermsIn(clean) };
  }

  const sourceScript = scriptPatternFor(languages.source);
  const targetScript = scriptPatternFor(languages.target);

  let decidable = 0;
  let source = 0;
  let target = 0;
  for (const char of clean) {
    // Digits, punctuation and spacing settle nothing: "KPI가 3% 올랐습니다"
    // is Korean with an English acronym, not 40% English.
    if (!DECIDABLE.test(char)) continue;
    decidable += 1;
    if (sourceScript.test(char)) source += 1;
    else if (targetScript.test(char)) target += 1;
  }

  if (decidable === 0) return { ...EMPTY, decidable: true };

  const sourceRatio = source / decidable;
  const targetRatio = target / decidable;
  const mixed =
    Math.min(sourceRatio, targetRatio) >= MIXED_MIN_RATIO && source > 0 && target > 0;

  const dominant: CodeSwitchDominance =
    targetRatio >= DOMINANT_RATIO
      ? "target"
      : sourceRatio >= DOMINANT_RATIO
        ? "source"
        : source > 0 || target > 0
          ? "mixed"
          : "unknown";

  return {
    sourceRatio,
    targetRatio,
    dominant,
    mixed,
    guestTerms: guestTermsIn(clean),
    decidable: true,
  };
}

/**
 * Whether a unit is already written in the target language.
 *
 * The one question the fast lane has to answer before handing Korean to an
 * on-device ko→en translator: if the speaker just said a whole English
 * sentence, translating it again produces a worse English sentence, slower.
 *
 * Deliberately strict. A unit has to be overwhelmingly target-script AND long
 * enough to be a thought rather than a stray token, because passing Korean
 * through untranslated is a far worse failure than translating English twice.
 */
export function isAlreadyTargetLanguage(
  text: string,
  languages: { source: string; target: string },
  analysis?: CodeSwitchAnalysis,
): boolean {
  const clean = text.trim();
  if (clean.length < 12) return false;
  const result = analysis ?? analyseCodeSwitch(clean, languages);
  return result.decidable && result.dominant === "target";
}
