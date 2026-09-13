/**
 * Live glossary matching.
 *
 * The live console shows a *small* glossary — the terms relevant to what is
 * being said right now, not an encyclopedia. This module scores candidate
 * terms and returns the handful worth screen space.
 *
 * Matching is longest-first so 하나님 나라 wins over 하나님, and 택하신 족속
 * wins over 족속.
 *
 * LANGUAGES. The built-in lexicons are Korean, and Korean only: the Korean
 * whole-word matcher knows Korean particles and nothing about Thai or
 * Mandarin. For any other source language only the `extra` entries — the prep
 * sheet's and the session's own — are matched, with a boundary rule that
 * suits the script, and the Korean lexicon is never consulted.
 */
import type { GlossaryItem, InterpretationMode } from "@/types";
import { isSpacelessLanguage, languageBase } from "@/languages/registry";
import { COMMUNITY_SERMON_GLOSSARY } from "./community-glossary";
import { lexiconFor } from "./lexicon";
import { findWholeWordOccurrences } from "./match-korean";

export interface GlossaryMatch extends GlossaryItem {
  /** Character offset of the last occurrence, used for recency ordering. */
  index: number;
}

/** Maximum entries shown on the live console at once. */
export const LIVE_GLOSSARY_LIMIT = 6;

/** The source language every matcher assumes when none is given. */
export const DEFAULT_GLOSSARY_LANGUAGE = "ko-KR";

const byLengthDesc = (a: GlossaryItem, b: GlossaryItem) =>
  b.korean.length - a.korean.length;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every occurrence of `term` in `text`, with the boundary rule the language
 * needs: Korean particles for Korean, plain substring for scripts that do not
 * space words, Unicode word boundaries (case-insensitive) for the rest.
 */
export function findOccurrences(text: string, term: string, language: string): number[] {
  if (!term) return [];
  if (languageBase(language) === "ko") return findWholeWordOccurrences(text, term);

  const out: number[] = [];
  if (isSpacelessLanguage(language)) {
    const haystack = text.toLowerCase();
    const needle = term.toLowerCase();
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) out.push(at);
    return out;
  }

  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, "giu");
  for (let match = re.exec(text); match !== null; match = re.exec(text)) {
    out.push(match.index);
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return out;
}

/**
 * Find glossary terms present in a piece of source text.
 *
 * `extra` carries prep-sheet and model-supplied entries, which outrank the
 * built-in lexicon when both match the same source string.
 *
 * In the sermon layer the volunteer-maintained community glossary extends
 * coverage after the hand-curated lexicon. This ordering is intentional: broad
 * coverage must never silently replace a context-aware decision such as
 * 대속 → atonement.
 */
export function matchGlossary(
  text: string,
  mode: InterpretationMode,
  extra: GlossaryItem[] = [],
  language: string = DEFAULT_GLOSSARY_LANGUAGE,
): GlossaryMatch[] {
  if (!text.trim()) return [];

  const korean = languageBase(language) === "ko";
  const community = korean && mode === "sermon" ? COMMUNITY_SERMON_GLOSSARY : [];
  const entries = dedupeByKorean([
    ...extra,
    ...(korean ? lexiconFor(mode) : []),
    ...community,
  ]).sort(byLengthDesc);

  // Track which characters are already claimed so a longer match suppresses
  // the shorter terms nested inside it.
  const claimed = new Array<boolean>(text.length).fill(false);
  const matches: GlossaryMatch[] = [];

  for (const entry of entries) {
    // Whole-word only. Korean agglutinates, so substring search would report
    // 감사 ("thanksgiving") inside 감사합니다 ("thank you").
    for (const index of findOccurrences(text, entry.korean, language)) {
      const end = index + entry.korean.length;
      let overlaps = false;
      for (let i = index; i < end; i += 1) {
        if (claimed[i]) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      for (let i = index; i < end; i += 1) claimed[i] = true;
      matches.push({ ...entry, index });
    }
  }

  // Most recent first — the interpreter cares about what was just said.
  return matches.sort((a, b) => b.index - a.index);
}

/** Maximum entries sent to the model — the cap `interpretRequestSchema` allows. */
export const PROMPT_GLOSSARY_LIMIT = 8;

/**
 * The terms worth showing on the live console: recent matches first, capped,
 * with prep-sheet entries preferred.
 *
 * Discourse markers are dropped HERE and only here — an interpreter does not
 * need to be told that 여러분 means "everyone". See `promptGlossary` for the
 * model's copy, which keeps them.
 */
export function liveGlossary(
  recentText: string,
  mode: InterpretationMode,
  extra: GlossaryItem[] = [],
  limit = LIVE_GLOSSARY_LIMIT,
  language: string = DEFAULT_GLOSSARY_LANGUAGE,
): GlossaryItem[] {
  return (
    matchGlossary(recentText, mode, extra, language)
      .filter((item) => !item.register)
      .slice(0, limit)
      .map(({ index: _index, ...item }) => item)
  );
}

/**
 * The terms sent to the interpretation model.
 *
 * Same matcher, one deliberate difference: discourse markers stay in. The rail
 * filter used to run on the model's copy too, so 결론적으로, 예를 들어,
 * 한편으로는 and 무엇보다 were stripped before the model ever saw them — the
 * exact words that say which rhetorical move is starting, and therefore which
 * English frame can be committed to before the Korean predicate lands. They
 * were being discarded as "noise on the rail", which they are; the rail is not
 * the only reader.
 */
export function promptGlossary(
  recentText: string,
  mode: InterpretationMode,
  extra: GlossaryItem[] = [],
  limit = PROMPT_GLOSSARY_LIMIT,
  language: string = DEFAULT_GLOSSARY_LANGUAGE,
): GlossaryItem[] {
  return matchGlossary(recentText, mode, extra, language)
    .slice(0, limit)
    .map(({ index: _index, ...item }) => item);
}

/** Collapse duplicates, keeping the first (highest-priority) occurrence. */
export function dedupeByKorean(items: GlossaryItem[]): GlossaryItem[] {
  const seen = new Map<string, GlossaryItem>();
  for (const item of items) {
    const key = item.korean.trim();
    if (!key || seen.has(key)) continue;
    seen.set(key, item);
  }
  return [...seen.values()];
}

/**
 * Merge newly discovered terms into the session glossary without losing
 * earlier entries or letting the model overwrite a prep-sheet decision.
 */
export function mergeGlossary(
  existing: GlossaryItem[],
  incoming: GlossaryItem[],
): GlossaryItem[] {
  const out = [...existing];
  const index = new Map(out.map((item, i) => [item.korean.trim(), i]));
  for (const item of incoming) {
    const key = item.korean.trim();
    if (!key) continue;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, out.length);
      out.push(item);
      continue;
    }
    // Prep decisions win; otherwise fill in any missing note/alternatives.
    if (out[at].source === "prep") continue;
    out[at] = { ...out[at], ...item, source: out[at].source ?? item.source };
  }
  return out;
}
