/**
 * Proper-noun consistency.
 *
 * The prompt has always told the model "once a form is settled, reuse it
 * exactly", and the rolling context has always listed the settled forms. That
 * is a request, not a guarantee, and the failure it does not prevent is the
 * one that embarrasses an interpreter in front of a room: a speaker's name
 * spelled three ways in four minutes, each spelling confident.
 *
 * The session already KNOWS the settled form — from the prep sheet, from a
 * correction the interpreter typed, or from an entity the model itself
 * returned and the memory kept. So the last step before English reaches the
 * screen is deterministic: a near-variant of a settled form is rewritten to
 * the settled form.
 *
 * THE RULES ARE DELIBERATELY TIMID, because a wrong rewrite is worse than a
 * drifting spelling:
 *
 *  - Only forms that look like names are enforced at all. A one-word lowercase
 *    gloss is a word, not an entity, and is left alone.
 *  - Only Latin-script canonicals are fuzzy-matched. Capitalisation is the
 *    signal that a token is a name, and scripts without it do not have it;
 *    those get exact-variant enforcement from corrections only.
 *  - A candidate must have the same word count, the same first letter, a
 *    length within two characters, and a bounded edit distance.
 *  - A chunk that already contains the canonical is never touched.
 *
 * Everything here is pure, so the safety rules are tested directly rather than
 * inferred from an engine run.
 */
import type { CorrectionRecord, EntityResolution, GlossaryItem } from "@/types";

/** Word characters for the purposes of a name: letters, digits and marks. */
const WORD = /[\p{L}\p{N}\p{M}]/u;
/** Joiners that appear INSIDE a romanised name and must not split it. */
const NAME_JOINER = /[-'’.]/u;

const isLatin = (text: string): boolean => /^[\p{Script=Latin}\p{N}\s\-'’.]+$/u.test(text);

const fold = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

/** Levenshtein, bounded — it is only ever run on short name-length strings. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return previous[b.length];
}

/**
 * Whether a settled form is name-shaped enough to enforce.
 *
 * Multi-word forms and capitalised single words qualify; an ordinary lowercase
 * word does not, because rewriting "grace" to "Grace" across a transcript is a
 * change nobody asked for.
 */
export function isEnforceableForm(form: string): boolean {
  const clean = form.trim();
  if (clean.length < 3 || clean.length > 60) return false;
  if (!isLatin(clean)) return false;
  const words = clean.split(/\s+/u).filter(Boolean);
  if (words.length > 4) return false;
  // Every word must start with a capital, which is what makes it a name rather
  // than a phrase that happens to have been settled.
  return words.every((word) => /^[\p{Lu}\p{N}]/u.test(word));
}

export interface SettledForm {
  canonical: string;
  /** Folded canonical, cached because it is compared against every window. */
  key: string;
  words: number;
}

/**
 * Collect the forms worth enforcing, most specific first.
 *
 * Corrections outrank entities outrank glossary: a correction is the
 * interpreter overruling everything else, and this must not undo them.
 */
export function settledForms(input: {
  corrections?: CorrectionRecord[];
  entities?: EntityResolution[];
  glossary?: GlossaryItem[];
}): SettledForm[] {
  const seen = new Set<string>();
  const forms: SettledForm[] = [];

  const add = (value: string | undefined) => {
    const canonical = value?.trim();
    if (!canonical || !isEnforceableForm(canonical)) return;
    const key = fold(canonical);
    if (!key || seen.has(key)) return;
    seen.add(key);
    forms.push({ canonical, key, words: canonical.split(/\s+/u).filter(Boolean).length });
  };

  for (const correction of input.corrections ?? []) add(correction.english);
  for (const entity of input.entities ?? []) add(entity.english);
  for (const item of input.glossary ?? []) add(item.english);

  // Longest first, so "Grace Community Church" wins over "Grace Community".
  return forms.sort((a, b) => b.words - a.words || b.canonical.length - a.canonical.length);
}

/**
 * Below this length a settled form carries too little signal to match its
 * first letter loosely.
 *
 * 류 romanises as both "Ryu" and "Yu", so "Yu Jeong-gil" for a settled
 * "Ryu Jeong-gil" is drift worth fixing — the eleven shared characters are the
 * evidence. "Kim" and "Lim" are also one edit apart and are two different
 * surnames, and three characters is not evidence of anything. So the initial
 * may differ only when the rest of the name is long enough to carry the claim.
 */
const LOOSE_INITIAL_MIN_CHARS = 6;

/** Whether `candidate` is a misspelling of `form` rather than a different word. */
export function isVariantOf(candidate: string, form: SettledForm): boolean {
  const key = fold(candidate);
  if (!key) return false;
  // Identical once punctuation and case are folded away, but rendered
  // differently — "Ryu Jeonggil" for "Ryu Jeong-gil". That IS the drift this
  // exists to stop, and it is the safest possible case to act on.
  if (key === form.key) return candidate.trim() !== form.canonical;
  if (form.key.length < LOOSE_INITIAL_MIN_CHARS && key[0] !== form.key[0]) return false;
  if (Math.abs(key.length - form.key.length) > 2) return false;
  const budget = Math.max(1, Math.floor(form.key.length * 0.25));
  return editDistance(key, form.key) <= budget;
}

interface Token {
  text: string;
  start: number;
  end: number;
}

function tokenise(text: string): Token[] {
  const tokens: Token[] = [];
  let start = -1;
  for (let i = 0; i <= text.length; i += 1) {
    const char = text[i];
    const inWord =
      char !== undefined &&
      (WORD.test(char) ||
        // A joiner only counts while it sits BETWEEN two word characters.
        (NAME_JOINER.test(char) && i > 0 && WORD.test(text[i - 1] ?? "") && WORD.test(text[i + 1] ?? "")));
    if (inWord) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      tokens.push({ text: text.slice(start, i), start, end: i });
      start = -1;
    }
  }
  return tokens;
}

export interface TerminologyFix {
  from: string;
  to: string;
}

export interface EnforcementResult {
  text: string;
  fixes: TerminologyFix[];
}

/**
 * Rewrite near-variants of settled forms in one piece of produced text.
 *
 * Returns the original string when nothing matched, so a caller can compare by
 * identity and skip re-rendering.
 */
export function enforceTerminology(text: string, forms: SettledForm[]): EnforcementResult {
  if (!text.trim() || forms.length === 0) return { text, fixes: [] };

  let out = text;
  const fixes: TerminologyFix[] = [];

  for (const form of forms) {
    // Already spelled correctly somewhere in this chunk: the model settled on
    // the right form and a fuzzy pass would only risk undoing it.
    if (fold(out).includes(form.key) && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(form.canonical)}(?![\\p{L}\\p{N}])`, "u").test(out)) {
      continue;
    }

    const tokens = tokenise(out);
    // The canonical's own word count, and one more: a recogniser that splits
    // "Jeong-gil" into two words produces a three-token spelling of a two-word
    // name. The extra token must itself be capitalised, so this never swallows
    // the ordinary word that follows a name.
    const widths = [form.words, form.words + 1];
    let applied = false;
    for (const width of widths) {
      if (applied) break;
      for (let i = 0; i + width <= tokens.length; i += 1) {
        const window = tokens.slice(i, i + width);
        if (width !== form.words && !/^[\p{Lu}\p{N}]/u.test(window[width - 1].text)) continue;
        const slice = out.slice(window[0].start, window[width - 1].end);
        if (!isVariantOf(slice, form)) continue;
        // Only rewrite something that is itself name-shaped. A lowercase word
        // is not a misspelled name, it is a word.
        if (!/^[\p{Lu}\p{N}]/u.test(slice)) continue;

        out = out.slice(0, window[0].start) + form.canonical + out.slice(window[width - 1].end);
        fixes.push({ from: slice, to: form.canonical });
        applied = true;
        break;
      }
    }
  }

  return { text: out, fixes };
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
