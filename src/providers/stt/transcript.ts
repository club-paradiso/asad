/** Language-aware transcript cleanup shared by browser and cloud STT paths. */
import { findLanguage } from "@/lib/languages";

const SIMPLIFIED_HINT = /[这国证签办体门长话发务关续请号录处华]/u;
const TRADITIONAL_HINT = /[這國證簽辦體門長話發務關續請號錄處華]/u;

/** Latin letters and digits — the guest script almost every loanword arrives in. */
const GUEST_CHAR = /[A-Za-z0-9À-ɏ]/u;

// STT defaults to Korean elsewhere in the app (webSpeechLanguage/deepgramLanguage).
// Keep helpers consistent when a caller omits a language rather than inventing
// an accidental third default that changes spacing/alternative ranking.
const definitionFor = (language: string | undefined) => findLanguage(language ?? "ko-KR");

/** True for writing systems that do not separate words with spaces. */
const unspaced = (language: string | undefined): boolean =>
  definitionFor(language)?.spaced === false;

/**
 * Korean IS spaced, but ONE browser recognition event can split a single
 * lexical item across result slots (안녕 + 하세요). Within an event those slots
 * are concatenated verbatim; between independently stable chunks normal word
 * spacing applies. That distinction is about the recogniser, not the script,
 * so it lives here rather than in the registry.
 */
const unspacedWithinBrowserResult = (language: string | undefined): boolean =>
  unspaced(language) || definitionFor(language)?.base === "ko";

const cleanupJoined = (value: string) =>
  value.replace(/\s+([,.!?;:，。！？；：])/gu, "$1").trim();

/**
 * Nudge the alternative picker toward the script variant that was requested.
 *
 * Only meaningful for a tag whose meaning IS a script variant; the registry
 * says which those are, so this is not a Chinese special case sitting in a
 * general-purpose function.
 */
const scriptVariantBonus = (text: string, language: string | undefined): number => {
  const definition = definitionFor(language);
  if (!definition?.scriptVariant) return 0;
  const tag = definition.id.toLowerCase();
  if (tag === "zh-cn") {
    return [...text].reduce(
      (score, char) => score + (SIMPLIFIED_HINT.test(char) ? 0.08 : TRADITIONAL_HINT.test(char) ? -0.08 : 0),
      0,
    );
  }
  if (tag === "zh-tw") {
    return [...text].reduce(
      (score, char) => score + (TRADITIONAL_HINT.test(char) ? 0.08 : SIMPLIFIED_HINT.test(char) ? -0.08 : 0),
      0,
    );
  }
  return 0;
};

/** How much a hypothesis containing a term the session explicitly expects gains. */
const HINT_BONUS = 0.12;
/** Cap, so a hint-stuffed hypothesis cannot beat one in the right script. */
const MAX_HINT_BONUS = 0.36;

export interface AlternativePickOptions {
  /**
   * Terminology the session told the recogniser to expect — the prep sheet's
   * names, the glossary, today's product and technical vocabulary. A hypothesis
   * that contains one of them is more likely to be the one the speaker said.
   */
  hints?: readonly string[];
}

/**
 * Choose between the recogniser's competing hypotheses for one result slot.
 *
 * THE BUG THIS FUNCTION USED TO BE
 *
 * The score was `expectedScriptChars / allChars`, so a hypothesis was ranked by
 * how PURELY it was written in the session's script. For a Korean session that
 * is a direct instruction to prefer a Korean-phonetic invention over the real
 * thing, every single time the speaker says an English word:
 *
 *   "오늘은 retrieval augmented generation, 그러니까 RAG 구조를"   score 0.42
 *   "오늘은 리트리벌 어그멘티드 제너레이션, 그러니까 라그 구조를"   score 1.00  ← chosen
 *
 * The browser had already ranked those by its own acoustic confidence and we
 * threw that away in favour of a monolingual prejudice. It is the single
 * largest cause of ASAD mangling code-switched speech, and it is deterministic:
 * it fires on every mixed sentence, not occasionally.
 *
 * WHAT IT DOES NOW
 *
 * Guest script is legitimate as long as the session's own script is genuinely
 * present. A Korean sentence carrying English nouns is still a Korean sentence,
 * so its Latin characters count as correctly recognised rather than as errors,
 * and the browser's confidence ordering decides between hypotheses that are
 * equally plausible.
 *
 * What the old score got RIGHT is kept: a hypothesis with none of the session's
 * script at all — romanised Mandarin where Han characters were expected — still
 * loses to one that has it. That is the case the ratio was really protecting,
 * and it survives because the guest allowance is conditional on the source
 * script being there in the first place.
 */
export function pickSpeechAlternative(
  alternatives: readonly string[],
  language: string | undefined,
  options: AlternativePickOptions = {},
): string {
  const usable = alternatives.map((value) => value.trim()).filter(Boolean);
  if (usable.length <= 1) return usable[0] ?? "";

  const script = definitionFor(language)?.scriptPattern;
  const hints = normaliseHints(options.hints);
  if (!script) return hints.length ? usable.reduce(byHintsOnly(hints)) : usable[0];

  const score = (text: string) => {
    const decidable = [...text].filter((char) => /[\p{L}\p{N}]/u.test(char));
    if (!decidable.length) return -1;
    const expected = decidable.filter((char) => script.test(char)).length;
    // A hypothesis with none of the session's script is not code-switching, it
    // is the wrong writing system. Rank it by the old, strict ratio.
    if (expected === 0) return scriptVariantBonus(text, language);
    const guest = decidable.filter(
      (char) => !script.test(char) && GUEST_CHAR.test(char),
    ).length;
    return (
      (expected + guest) / decidable.length +
      scriptVariantBonus(text, language) +
      hintBonus(text, hints)
    );
  };

  return usable.reduce((best, candidate) =>
    score(candidate) > score(best) ? candidate : best,
  );
}

const normaliseHints = (hints: readonly string[] | undefined): string[] => {
  if (!hints?.length) return [];
  const out: string[] = [];
  for (const hint of hints) {
    const term = hint.trim().toLowerCase();
    // One- and two-character hints match inside unrelated words and would turn
    // the bonus into noise. Terminology worth biasing for is longer than that.
    if (term.length >= 3) out.push(term);
  }
  return out;
};

const hintBonus = (text: string, hints: readonly string[]): number => {
  if (!hints.length) return 0;
  const haystack = text.toLowerCase();
  let hit = 0;
  for (const hint of hints) {
    if (haystack.includes(hint)) hit += 1;
    if (hit * HINT_BONUS >= MAX_HINT_BONUS) break;
  }
  return Math.min(MAX_HINT_BONUS, hit * HINT_BONUS);
};

/** Ranking for a Latin-script session, where the script ratio says nothing. */
const byHintsOnly =
  (hints: readonly string[]) =>
  (best: string, candidate: string): string =>
    hintBonus(candidate, hints) > hintBonus(best, hints) ? candidate : best;

/** Join separate STT chunks. Stable Korean chunks are words/phrases, so retain spaces. */
export function joinTranscriptParts(
  parts: readonly string[],
  language: string | undefined,
): string {
  const clean = parts.map((part) => part.trim()).filter(Boolean);
  if (!clean.length) return "";
  if (!unspaced(language)) return cleanupJoined(clean.join(" "));
  return cleanupJoined(joinNoSpaceLanguageParts(clean));
}

const latinBoundary = (left: string, right: string): boolean =>
  /[A-Za-z0-9]$/u.test(left) && /^[A-Za-z0-9]/u.test(right);

/**
 * A script change across a join.
 *
 * Only consulted for a language that IS spaced and is being concatenated
 * anyway. The concatenation exists for exactly one reason — one browser
 * recognition event can split a single Korean lexical item across result slots
 * (안녕 + 하세요) — and that reason cannot apply across a script change, because
 * no lexical item is half Hangul and half Latin. Without this rule the same
 * concatenation glued an English word onto the preceding Hangul (`오늘social`),
 * which then reached the stabiliser, the glossary matcher and the model as one
 * unrecognisable token.
 *
 * Genuinely unspaced scripts are left alone: Chinese and Japanese set a Latin
 * insertion tight against the surrounding characters, and `joinTranscriptParts`
 * has always produced 我的名字是Kim deliberately.
 */
const scriptBoundary = (left: string, right: string): boolean => {
  const before = left.slice(-1);
  const after = right.slice(0, 1);
  if (!/\p{L}/u.test(before) || !/\p{L}/u.test(after)) return false;
  return GUEST_CHAR.test(before) !== GUEST_CHAR.test(after);
};

function joinNoSpaceLanguageParts(
  parts: readonly string[],
  options: { spaceAcrossScripts?: boolean } = {},
): string {
  const separate = (left: string, right: string) =>
    latinBoundary(left, right) ||
    (options.spaceAcrossScripts === true && scriptBoundary(left, right));
  return parts.reduce(
    (joined, part) => joined + (joined && separate(joined, part) ? " " : "") + part,
    "",
  );
}

/**
 * Join multiple result slots from ONE browser recognition event. WebSpeech can
 * split a single Korean lexical item across slots (안녕 + 하세요); historically
 * those slots were concatenated verbatim. Keep that behavior for Korean while
 * still using normal word spacing between independently stable STT chunks.
 */
export function joinBrowserResultParts(
  parts: readonly string[],
  language: string | undefined,
): string {
  const clean = parts.map((part) => part.trim()).filter(Boolean);
  if (!clean.length) return "";
  if (!unspacedWithinBrowserResult(language)) {
    return cleanupJoined(clean.join(" "));
  }
  // A spaced language reaching this branch is here only because of the
  // split-lexical-item hack, so a script change is a word boundary.
  return cleanupJoined(
    joinNoSpaceLanguageParts(clean, { spaceAcrossScripts: !unspaced(language) }),
  );
}
