/**
 * Script-level code-switch analysis.
 *
 * A real speaker does not stay inside one language for forty minutes:
 *
 *   "오늘 우리가 살펴볼 개념은 social capital입니다."
 *   "여기서 社会资本이라는 개념이 중요합니다."
 *   "러시아어로는 социальный капитал이라고 합니다."
 *   "몽골어로는 нийгмийн капитал이라고 합니다."
 *   "힌디어에서는 सामाजिक पूंजी라는 표현을 씁니다."
 *   "베트남어로 vốn xã hội라고 합니다."
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
 * whole point: recognition good enough to protect a foreign noun inside a
 * Korean sentence does not need a classifier, and paying for one on every
 * transcript fragment would be a latency bug wearing a machine-learning costume.
 *
 * WHAT THIS MODULE IS NOT
 *
 * It is NOT language identification, and the distinction is load-bearing rather
 * than pedantic:
 *
 *   Latin    is English, Vietnamese, Indonesian, Spanish, French, German,
 *            Portuguese, Turkish and Tagalog.
 *   Cyrillic is Russian, Ukrainian AND Mongolian.
 *   Arabic   is Arabic, Urdu and Uyghur.
 *   Han      is Simplified Chinese, Traditional Chinese, and half of Japanese.
 *
 * So `analyseCodeSwitch` reports `dominant: "unknown"` for any pair whose two
 * languages are written in the same detectable block, and every consumer must
 * treat that as "no opinion" rather than as evidence. A Cyrillic span is not
 * Russian because it is Cyrillic; a Latin span is not English because it is
 * Latin. Fabricating that identity is the failure this module exists to refuse.
 *
 * THE PAIR IS THE UNIT OF ANALYSIS
 *
 * Nothing here asks "what language is this?" in the abstract. It asks "given
 * that this session is interpreting A into B, which of A, B or neither is this
 * run written in?" — a much smaller question, and one a character block can
 * genuinely answer whenever A and B are written differently.
 */
import { findLanguage } from "./languages";

/**
 * Latin, by Unicode property rather than by a hand-written range.
 *
 * The previous range was `[A-Za-zÀ-ɏ]`, which silently excluded
 * Latin Extended Additional (U+1EA0–U+1EFF) — that is, most of written
 * Vietnamese. `vốn` and `xã` matched; `hội`, `ế`, `ộ` and `ữ` did not, so a
 * Vietnamese guest span was half-recognised and half-invisible.
 */
const LATIN = /\p{Script=Latin}/u;

/**
 * Anything that can settle the question of which script a unit is written in.
 *
 * Letters only. Digits, punctuation and spacing are deliberately excluded: a
 * status code or a percentage belongs to whichever language surrounds it, and
 * counting them would make "KPI가 3% 올랐습니다" read as two-fifths English.
 *
 * Combining marks are excluded for the same reason and with a second benefit:
 * a Devanagari matra or an Arabic vowel mark is part of the grapheme its base
 * letter starts, so counting it separately would weight one written syllable
 * twice. Runs, below, keep marks attached to their base.
 */
const DECIDABLE = /\p{L}/u;

/** Letters, marks and digits: everything that may sit inside one run. */
const RUN_CHAR = /[\p{L}\p{M}\p{N}]/u;

/**
 * Characters allowed to bridge two halves of the same run.
 *
 * `E-7`, `GPT-4o`, `U.S.`, `don't`, `HTTP 403`, `social capital`,
 * `رأس المال الاجتماعي` and `сообщество и капитал` are each ONE thing worth
 * preserving. A comma or a full stop followed by a different script is not.
 */
const RUN_BRIDGE = /[\s\-'’.·]/u;

/** How many guest runs one analysis reports. Bounded so a caller cannot be flooded. */
export const MAX_GUEST_TERMS = 12;

/** Longest single run reported. A whole paragraph is not a term. */
export const MAX_GUEST_TERM_CHARS = 80;

/**
 * Cut a term to length without breaking a written syllable.
 *
 * `String.slice` counts UTF-16 units, which is not a unit of writing in most of
 * the world. Cutting at a fixed index can strand a Devanagari matra or an
 * Arabic vowel mark from the letter it belongs to, and the result is not an
 * abbreviation of the word — की truncated to क is a different syllable, and a
 * recogniser handed it will bias towards something nobody said.
 *
 * So: walk code points rather than units, and if the cut lands between a base
 * letter and its own marks, drop the base too. Losing one whole letter is
 * always better than keeping a broken one.
 */
export function truncateTerm(value: string, max = MAX_GUEST_TERM_CHARS): string {
  const points = [...value];
  if (points.length <= max) return value;
  let end = max;
  while (end > 0 && /\p{M}/u.test(points[end])) end -= 1;
  return points.slice(0, end).join("");
}

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

/**
 * What one run of same-script text is, relative to THIS session's pair.
 *
 * Deliberately not an ISO 15924 code. The honest answer to "which script is
 * 社会资本 written in" is "Han, which Simplified Chinese, Traditional Chinese
 * and Japanese all use", and stamping `Hans` on it would be exactly the false
 * precision the rest of this module refuses.
 */
export type ScriptRole =
  /** The language the speaker is expected to be speaking. */
  | "source"
  /** The language the interpreter is producing — the expected guest. */
  | "target"
  /**
   * Latin, in a session where Latin is neither side. Acronyms, product names
   * and identifiers arrive this way in every language on earth, so they are
   * always a legitimate guest.
   */
  | "latin"
  /** A script belonging to neither side of the pair and not Latin. */
  | "other";

export interface ScriptRun {
  text: string;
  role: ScriptRole;
}

export interface CodeSwitchAnalysis {
  /** Share of decidable characters written in the source language's script. */
  sourceRatio: number;
  /** Share written in the target language's script. */
  targetRatio: number;
  /**
   * Which language the unit reads as. `unknown` means the two languages are
   * written in the same block, so this module has no opinion and the caller
   * must not invent one.
   */
  dominant: CodeSwitchDominance;
  /** True when both scripts are present in more than trace amounts. */
  mixed: boolean;
  /** Runs worth preserving verbatim — names, acronyms, foreign-language spans. */
  guestTerms: string[];
  /** Every run, with what it is relative to this pair. */
  runs: ScriptRun[];
  /** Whether the pair is one this module can say anything about at all. */
  decidable: boolean;
  /**
   * Set when a run is written in a script belonging to NEITHER side of the pair
   * and is not a Latin identifier — a third language the session did not expect.
   * Preserved, never classified.
   */
  unexpectedScript: boolean;
}

const EMPTY: CodeSwitchAnalysis = {
  sourceRatio: 0,
  targetRatio: 0,
  dominant: "unknown",
  mixed: false,
  guestTerms: [],
  runs: [],
  decidable: false,
  unexpectedScript: false,
};

/**
 * The pattern that recognises a language's characters.
 *
 * The registry carries one for every non-Latin language precisely so the
 * recogniser's alternative ranking can use it; a language without one is Latin,
 * which is the default the registry leaves implicit. Crucially the registry
 * SHARES these pattern objects — `zh-CN` and `zh-TW` hold the same Han pattern,
 * `ru`, `uk` and `mn` the same Cyrillic one, `ar` and `ur` the same Arabic one
 * — so reference equality is a free, exact test for "written in the same
 * block", with no second table to drift.
 */
function scriptPatternFor(tag: string | undefined): RegExp {
  return findLanguage(tag ?? "")?.scriptPattern ?? LATIN;
}

/**
 * Whether the two languages of a pair are written differently enough for
 * character evidence to tell them apart.
 *
 * False for every pair that shares a block, which is the honest answer for
 * English↔Vietnamese, English↔Indonesian, Russian↔Mongolian, Russian↔Ukrainian,
 * Arabic↔Urdu and Simplified↔Traditional Chinese alike.
 */
export function pairIsScriptDecidable(source: string, target: string): boolean {
  const from = findLanguage(source);
  const to = findLanguage(target);
  if (!from || !to) return false;
  // Same base language is never a code switch — zh-CN → zh-TW is
  // transliteration, not interpretation.
  if (from.base === to.base) return false;
  return scriptPatternFor(source) !== scriptPatternFor(target);
}

/** A token that reads as an identifier rather than as ordinary prose. */
const isIdentifierToken = (token: string): boolean => {
  // A letter is required, so a bare `403` is never a term on its own — it joins
  // the label in front of it or it is dropped. But the SIZE test counts digits
  // too: `E-7` is one letter and one digit, and a letters-only floor of two
  // rejected exactly the kind of label this test exists to catch.
  if (!/\p{L}/u.test(token)) return false;
  if (token.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return false;
  // `GPT-4`, `E-7`, `F-2-7`, `K-ETA`: a word carrying a digit is a label.
  if (/\p{N}/u.test(token)) return true;
  // `API`, `RAG`, `HTTP`, `QR`: all upper case is a label too. Ordinary prose
  // is not, which is what keeps "We called" out of the list.
  return /^[\p{Lu}\p{N}\-.]+$/u.test(token);
};

/** A bare number, which joins the identifier before it rather than standing alone. */
const isBareNumber = (token: string): boolean => /^\p{N}+$/u.test(token);

/**
 * Identifiers, extracted without any script evidence at all.
 *
 * This is the only honest extraction left for a pair whose two languages share
 * a writing system. In an English↔Vietnamese session "social capital" proves
 * nothing — but `GPT-4` and `HTTP 403` are still worth preserving, and saying
 * so claims nothing about which language anything is in.
 *
 * Adjacent numbers join the label in front of them, so a status code travels
 * with its protocol.
 */
function identifiersIn(text: string, limit: number): string[] {
  const tokens = text.split(/[^\p{L}\p{M}\p{N}\-'’.]+/u).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < tokens.length && out.length < limit; i += 1) {
    const token = trimRun(tokens[i]);
    if (!isIdentifierToken(token)) continue;
    let term = token;
    // Trailing punctuation is part of the sentence, not of the number.
    while (i + 1 < tokens.length && isBareNumber(trimRun(tokens[i + 1]))) {
      term = `${term} ${trimRun(tokens[i + 1])}`;
      i += 1;
    }
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(truncateTerm(term));
  }
  return out;
}

/**
 * What a classifier says about one character.
 *
 * The three answers are genuinely different and conflating two of them was a
 * bug: a digit has no script of its own and belongs to whatever run is open,
 * while a Hangul syllable seen by a Latin-only scan belongs to no run at all
 * and must CLOSE the one in progress. Treating the second as the first let
 * `A 라 마` come back as one Latin "term".
 */
type CharVerdict =
  | ScriptRole
  /** Digits and combining marks: part of the open run, never the start of one. */
  | "neutral"
  /** Nothing this classifier recognises. Ends the run in progress. */
  | null;

/** Trailing bridge characters are punctuation, not part of the term. */
const trimRun = (value: string): string => {
  let end = value.length;
  while (end > 0 && (RUN_BRIDGE.test(value[end - 1]) || /\s/u.test(value[end - 1]))) end -= 1;
  return value.slice(0, end).trim();
};

/**
 * Split text into runs of same-role characters.
 *
 * One pass, no allocation per character, and grapheme-safe by construction:
 * marks travel with the base letter they modify rather than being classified
 * on their own, so a Devanagari matra or an Arabic vowel mark can never be cut
 * off the syllable it belongs to.
 */
function scriptRuns(
  text: string,
  roleOf: (char: string) => CharVerdict,
): ScriptRun[] {
  const runs: ScriptRun[] = [];
  let role: ScriptRole | null = null;
  let buffer = "";
  /** Bridging characters held back until we know the run continues. */
  let bridge = "";

  const close = () => {
    const trimmed = trimRun(buffer);
    if (trimmed && role !== null) {
      runs.push({ text: truncateTerm(trimmed), role });
    }
    buffer = "";
    bridge = "";
    role = null;
  };

  for (const char of text) {
    if (RUN_CHAR.test(char)) {
      const next = roleOf(char);
      if (next === null) {
        // A script this classifier does not recognise. Whatever run was open
        // has ended; this character starts nothing.
        close();
        continue;
      }
      if (next === "neutral") {
        // A digit or a combining mark: part of the open run, never the start
        // of one. `HTTP 403` keeps its number; a bare `2026` is not a term.
        if (role !== null) {
          buffer += bridge + char;
          bridge = "";
        }
        continue;
      }
      if (role !== null && next !== role) close();
      role = next;
      buffer += bridge + char;
      bridge = "";
      continue;
    }
    if (role !== null && RUN_BRIDGE.test(char)) {
      bridge += char;
      continue;
    }
    close();
  }
  close();
  return runs;
}

/**
 * How this pair classifies a single character, and whether it can classify at
 * all.
 *
 * Built once per analysis and shared by run extraction and ratio counting, so
 * the two can never disagree about what a character is.
 */
function roleClassifier(languages: { source: string; target: string }) {
  const decidable = pairIsScriptDecidable(languages.source, languages.target);
  const sourceScript = scriptPatternFor(languages.source);
  const targetScript = scriptPatternFor(languages.target);

  const roleOf = (char: string): CharVerdict => {
    // A digit or a combining mark. Neither settles a script, and the mark
    // belongs to the grapheme its base letter already opened.
    if (!DECIDABLE.test(char)) return "neutral";
    if (!decidable) return "source";
    const isSource = sourceScript.test(char);
    const isTarget = targetScript.test(char);
    // A character both patterns claim proves nothing. Japanese and Chinese
    // share the Han block, so a kanji in a ja↔zh session is evidence for
    // neither and must not be counted as if it were.
    if (isSource && isTarget) return "neutral";
    if (isSource) return "source";
    if (isTarget) return "target";
    return LATIN.test(char) ? "latin" : "other";
  };

  return { decidable, roleOf };
}

/** Pick the runs worth carrying downstream out of an already-classified list. */
function termsFromRuns(runs: readonly ScriptRun[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    if (run.role === "source") continue;
    // A single letter is a bullet, an initial or noise, never a term.
    if (run.text.replace(/[^\p{L}\p{N}]/gu, "").length < 2) continue;
    const key = run.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(run.text);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Terms worth adding to a recogniser's vocabulary, pulled out of PROSE.
 *
 * A different question from `guestTermsIn`, and it needs a different answer. A
 * live unit is one stabilised utterance, so a foreign run inside it is a code
 * switch worth preserving whole. A prep sheet is paragraphs, and the useful
 * thing in a paragraph is not the paragraph — it is the handful of tokens a
 * recogniser will otherwise get wrong: proper nouns, product names, acronyms
 * and identifiers.
 *
 * Deliberately script-independent: 퍼트넘, Vercel, RAG, GPT-4 and E-7 are all
 * worth biasing for, and none of that judgement needs a language.
 */
export function notableTermsIn(text: string, limit = MAX_GUEST_TERMS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const sentence of text.split(/[.!?\n\r]+/u)) {
    const tokens = sentence.split(/[^\p{L}\p{M}\p{N}\-'’.]+/u).filter(Boolean);
    for (let i = 0; i < tokens.length && out.length < limit; i += 1) {
      const token = trimRun(tokens[i]);
      const letters = token.replace(/[^\p{L}]/gu, "");
      // A capital at the start of a sentence says nothing about the word.
      const properNoun = i > 0 && letters.length >= 3 && /^\p{Lu}/u.test(token);
      if (!properNoun && !isIdentifierToken(token)) continue;
      let term = token;
      while (i + 1 < tokens.length && isBareNumber(trimRun(tokens[i + 1]))) {
        term = `${term} ${trimRun(tokens[i + 1])}`;
        i += 1;
      }
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(truncateTerm(term));
    }
  }
  return out;
}

/**
 * The runs of this unit that are worth carrying downstream untouched.
 *
 * With a script-decidable pair these are every run that is not the source
 * language: the target language the speaker dropped into, a Latin product name,
 * a third script entirely. Runs are PHRASES rather than words — `social
 * capital`, `رأس المال الاجتماعي`, `нийгмийн капитал`, `HTTP 403` — because
 * every consumer wants the whole thing: the prompt asks the model to preserve
 * it, and a recogniser keyterm list is more useful with the phrase than with
 * its halves.
 *
 * With an UNDECIDABLE pair there is no script evidence to have, so the only
 * honest extraction left is the script-independent one: tokens that read as
 * identifiers — `GPT-4`, `E-7`, `HTTP 403`, `API`. "social capital" inside an
 * English↔Vietnamese session is not evidence of anything, and reporting it as a
 * foreign span would be the fabricated language identity this module refuses.
 *
 * Called with no pair at all, it falls back to Latin runs — which is what
 * scanning a prep sheet for product names wants when no session exists yet.
 */
export function guestTermsIn(
  text: string,
  languages?: { source: string; target: string },
  limit = MAX_GUEST_TERMS,
): string[] {
  if (!languages) {
    const runs = scriptRuns(text, (char) => {
      if (!DECIDABLE.test(char)) return "neutral";
      return LATIN.test(char) ? "latin" : null;
    });
    return termsFromRuns(runs, limit);
  }
  const { decidable, roleOf } = roleClassifier(languages);
  if (!decidable) return identifiersIn(text, limit);
  return termsFromRuns(scriptRuns(text, roleOf), limit);
}

/**
 * Which side of the pair this unit reads as.
 *
 * The ratios are shares of ALL decidable characters, so they do not sum to one
 * when some characters are claimed by both patterns. That is why "one side has
 * no evidence at all" is its own rule rather than a ratio threshold: in a
 * Japanese↔Chinese session `地域社会と観光政策` is 89% kanji, which proves nothing,
 * and one kana, which proves Japanese. Reading it as "mixed" because neither
 * ratio cleared 0.9 would report a code switch that did not happen.
 */
function decideDominance(
  source: number,
  target: number,
  sourceRatio: number,
  targetRatio: number,
): CodeSwitchDominance {
  if (source === 0 && target === 0) return "unknown";
  if (target === 0) return "source";
  if (source === 0) return "target";
  if (targetRatio >= DOMINANT_RATIO) return "target";
  if (sourceRatio >= DOMINANT_RATIO) return "source";
  return "mixed";
}

/**
 * Analyse one already-stabilised unit against the session's language pair.
 *
 * Cheap by construction: one pass to build runs and one to count characters.
 * Live units are tens of characters, and this runs once per stabilised unit
 * rather than per token.
 */
export function analyseCodeSwitch(
  text: string,
  languages: { source: string; target: string },
): CodeSwitchAnalysis {
  const clean = text.trim();
  if (!clean) return EMPTY;

  const { decidable, roleOf } = roleClassifier(languages);
  const runs = scriptRuns(clean, roleOf);
  const guestTerms = decidable
    ? termsFromRuns(runs, MAX_GUEST_TERMS)
    : identifiersIn(clean, MAX_GUEST_TERMS);

  if (!decidable) return { ...EMPTY, runs, guestTerms };

  let total = 0;
  let source = 0;
  let target = 0;
  for (const char of clean) {
    if (!DECIDABLE.test(char)) continue;
    total += 1;
    const role = roleOf(char);
    if (role === "source") source += 1;
    else if (role === "target") target += 1;
  }

  if (total === 0) return { ...EMPTY, decidable: true, runs, guestTerms };

  const sourceRatio = source / total;
  const targetRatio = target / total;
  const mixed =
    Math.min(sourceRatio, targetRatio) >= MIXED_MIN_RATIO && source > 0 && target > 0;

  const dominant: CodeSwitchDominance = decideDominance(source, target, sourceRatio, targetRatio);

  return {
    sourceRatio,
    targetRatio,
    dominant,
    mixed,
    guestTerms,
    runs,
    decidable: true,
    unexpectedScript: runs.some((run) => run.role === "other"),
  };
}

/**
 * Whether a unit is already written in the target language.
 *
 * The one question the fast lane has to answer before handing source speech to
 * a translator: if the speaker just said a whole sentence in the language we
 * are producing, translating it again produces a worse sentence, slower.
 *
 * Deliberately strict, and deliberately refused outright for a pair the scripts
 * cannot separate. Passing source speech through untranslated is a far worse
 * failure than translating a quotation twice, and in an English↔Vietnamese or
 * Russian↔Mongolian session there is no evidence that would justify the risk.
 */
/**
 * Shortest unit that can be a whole thought, by writing system.
 *
 * A character-count floor is not script-neutral, and the first version of it
 * was quietly tuned for Hangul and Latin. 我认为这不是重点所在。 is a complete
 * sentence in eleven characters; the same thought needs thirty in English. A
 * flat floor of twelve therefore refused passthrough for most well-formed
 * Chinese and Japanese, which is precisely the case it was meant to serve.
 */
const minPassthroughChars = (target: string): number =>
  findLanguage(target)?.spaced === false ? 6 : 12;

export function isAlreadyTargetLanguage(
  text: string,
  languages: { source: string; target: string },
  analysis?: CodeSwitchAnalysis,
): boolean {
  const clean = text.trim();
  if (clean.length < minPassthroughChars(languages.target)) return false;
  const result = analysis ?? analyseCodeSwitch(clean, languages);
  return result.decidable && result.dominant === "target";
}
