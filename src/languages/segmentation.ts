/**
 * Language-aware segmentation: where a stabilised transcript may be cut.
 *
 * The stabiliser used to know one thing — Korean sentence-final endings — and
 * that was correct for the only language the Live console spoke. With a source
 * language chosen per session, "is this a finished thought?" has to be
 * answered per script: Chinese and Japanese speech is punctuated by the
 * recogniser (。！？) or not at all, Thai has no sentence punctuation, Arabic
 * and Hindi have their own marks. Getting this wrong in either direction costs
 * a live interpreter: cutting early hands the model a subject without its
 * verb; never cutting starves the pipeline until the hold ceiling fires.
 *
 * Nothing here decides *what* is said. It only decides where a boundary is.
 */
import { languageBase, languageScript } from "./registry";

/**
 * Korean sentence-final endings, plus ordinary terminal punctuation.
 *
 * The single-syllable endings must be ATTACHED to a stem — `[가-힣]` before
 * them — because a sentence-final ending is a suffix, never a word of its own.
 * Matching them bare cut mid-phrase on the adverb 다 ("all").
 */
const KOREAN_SENTENCE_END =
  /(?:습니다|십시오|세요|군요)\s*[.?!。？！]?\s*$|[가-힣](?:다|요|까|죠|네)\s*[.?!。？！]?\s*$|[.?!。？！]\s*$/;
const KOREAN_CLAUSE_END = /(?:고|며|면서|지만|는데|어서|아서|니까|으니|든지|거나)\s*,?\s*$/;

/** Japanese polite/plain finals, or CJK terminal punctuation. */
const JAPANESE_SENTENCE_END = /(?:です|ます|でした|ました|ません|ない|だ|た|よ|ね|か)\s*[。？！.?!]?\s*$|[。？！.?!]\s*$/;
const JAPANESE_CLAUSE_END = /(?:が|けど|けれど|ので|から|し|て|で)\s*[、,]?\s*$|[、,]\s*$/;

/** Chinese relies on recogniser punctuation; a trailing particle is a weak signal. */
const CHINESE_SENTENCE_END = /[。？！.?!]\s*$|(?:了|吧|呢|吗|嗎|啊|呀)\s*$/;
const CHINESE_CLAUSE_END = /[，,、；;：:]\s*$/;

const ARABIC_SENTENCE_END = /[.!?؟۔]\s*$/;
const ARABIC_CLAUSE_END = /[،,;؛]\s*$/;

const INDIC_SENTENCE_END = /[।॥.!?]\s*$/;
const INDIC_CLAUSE_END = /[,;]\s*$/;

const BURMESE_SENTENCE_END = /[။.!?]\s*$/;
const KHMER_SENTENCE_END = /[។.!?]\s*$/;

const LATIN_SENTENCE_END = /[.!?…]\s*$/;
/** Words that end a clause but promise more. Never a boundary. */
const LATIN_OPEN_CONJUNCTION = /\b(?:and|but|or|so|because|that|which|if|when|while|although|y|pero|et|mais|und|aber|dan|tetapi|và|nhưng|и|но)\s*,?\s*$/i;
const LATIN_CLAUSE_END = /[,;:]\s*$/;

/** Text with no letter or digit in any script is punctuation, not transcript. */
export const HAS_CONTENT = /[\p{L}\p{N}]/u;

export interface BoundaryRules {
  sentence: RegExp;
  clause: RegExp | null;
  /**
   * When the recogniser rarely punctuates (Thai, spaceless Chinese from some
   * browsers), a silence window is the main boundary and the clause rule is
   * not worth much. `punctuationReliable: false` tells the stabiliser to lean
   * on quiet windows rather than wait for a mark that may never come.
   */
  punctuationReliable: boolean;
  /** Something that looks like a boundary but must not be treated as one. */
  openEnd?: RegExp;
}

const KOREAN_RULES: BoundaryRules = {
  sentence: KOREAN_SENTENCE_END,
  clause: KOREAN_CLAUSE_END,
  punctuationReliable: true,
};

const LATIN_RULES: BoundaryRules = {
  sentence: LATIN_SENTENCE_END,
  clause: LATIN_CLAUSE_END,
  punctuationReliable: true,
  openEnd: LATIN_OPEN_CONJUNCTION,
};

/** Boundary rules for a source language. Unknown languages get the Latin rules. */
export function boundaryRulesFor(language: string | undefined | null): BoundaryRules {
  const base = languageBase(language);
  const script = languageScript(language);
  switch (base) {
    case "ko":
      return KOREAN_RULES;
    case "ja":
      return { sentence: JAPANESE_SENTENCE_END, clause: JAPANESE_CLAUSE_END, punctuationReliable: true };
    case "zh":
      return { sentence: CHINESE_SENTENCE_END, clause: CHINESE_CLAUSE_END, punctuationReliable: false };
    case "th":
      // Thai speech recognition emits neither spaces nor sentence marks.
      return { sentence: /[.!?]\s*$/, clause: null, punctuationReliable: false };
    case "km":
      return { sentence: KHMER_SENTENCE_END, clause: null, punctuationReliable: false };
    case "my":
      return { sentence: BURMESE_SENTENCE_END, clause: null, punctuationReliable: false };
    default:
      break;
  }
  switch (script) {
    case "Arab":
      return { sentence: ARABIC_SENTENCE_END, clause: ARABIC_CLAUSE_END, punctuationReliable: true };
    case "Deva":
    case "Beng":
      return { sentence: INDIC_SENTENCE_END, clause: INDIC_CLAUSE_END, punctuationReliable: true };
    default:
      return LATIN_RULES;
  }
}

/** True when the text ends on a sentence boundary for its language. */
export function endsSentence(text: string, language: string | undefined | null): boolean {
  const rules = boundaryRulesFor(language);
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (rules.openEnd?.test(trimmed)) return false;
  return rules.sentence.test(trimmed);
}

/** True when the text ends on a clause boundary — a weaker, still usable cut. */
export function endsClause(text: string, language: string | undefined | null): boolean {
  const rules = boundaryRulesFor(language);
  const trimmed = text.trim();
  if (!trimmed || !rules.clause) return false;
  if (rules.openEnd?.test(trimmed)) return false;
  return rules.clause.test(trimmed);
}

/**
 * Length of a transcript in the units its language counts in.
 *
 * Trigger thresholds in the lag profiles were tuned in Korean syllables. A
 * spaceless script carries about the same information per character; a Latin
 * script carries less, so a raw character count would fire the trigger on a
 * two-word English fragment. Latin characters are scaled to keep the
 * thresholds comparable across languages.
 */
export function transcriptLength(text: string, language: string | undefined | null): number {
  const script = languageScript(language);
  const clean = text.trim();
  if (!clean) return 0;
  if (script === "Latn" || script === "Cyrl") return Math.ceil(clean.length / 2.2);
  return clean.length;
}

/**
 * Split a stabilised unit into interpretation-sized pieces along its language's
 * clause structure. Used for very long units that must not travel as one line.
 */
export function splitThoughtUnits(
  text: string,
  language: string | undefined | null,
  maxChars = 60,
): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const base = languageBase(language);
  const splitter =
    base === "ko"
      ? /(?<=(?:고|며|면서|지만|는데|어서|아서|니까|은|는))\s+|(?<=[,、])\s*/
      : base === "ja"
        ? /(?<=[、。])\s*|(?<=(?:が|けど|ので|から|て))\s*/
        : base === "zh"
          ? /(?<=[，,、。；])\s*/
          : /(?<=[,;:.])\s+/;

  const pieces = clean.split(splitter).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let buffer = "";
  for (const piece of pieces) {
    const candidate = buffer ? `${buffer} ${piece}` : piece;
    if (candidate.length > maxChars && buffer) {
      out.push(buffer);
      buffer = piece;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) out.push(buffer);
  return out;
}

/**
 * Join two pieces of transcript for a language: a space for spaced scripts,
 * nothing for spaceless ones, and never a space before punctuation.
 */
export function joinTranscript(left: string, right: string, language: string | undefined | null): string {
  const a = left.trim();
  const b = right.trim();
  if (!a) return b;
  if (!b) return a;
  const script = languageScript(language);
  const spaceless = script === "Hans" || script === "Hant" || script === "Jpan" || script === "Thai" || script === "Khmr" || script === "Mymr";
  if (/^[,.!?;:，。！？；：、]/.test(b)) return `${a}${b}`;
  if (spaceless && !(/[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b))) return `${a}${b}`;
  return `${a} ${b}`;
}
