/**
 * Live glossary matching.
 *
 * The live console shows a *small* glossary — the terms relevant to what is
 * being said right now, not an encyclopedia. This module scores candidate
 * terms and returns the handful worth screen space.
 *
 * Matching is longest-first so 하나님 나라 wins over 하나님, and 택하신 족속
 * wins over 족속.
 */
import type { GlossaryItem, InterpretationMode } from "@/types";
import { lexiconFor } from "./lexicon";
import { findWholeWordOccurrences } from "./match-korean";

export interface GlossaryMatch extends GlossaryItem {
  /** Character offset of the last occurrence, used for recency ordering. */
  index: number;
}

/** Maximum entries shown on the live console at once. */
export const LIVE_GLOSSARY_LIMIT = 6;

const byLengthDesc = (a: GlossaryItem, b: GlossaryItem) =>
  b.korean.length - a.korean.length;

/**
 * Find glossary terms present in a piece of Korean text.
 *
 * `extra` carries prep-sheet and model-supplied entries, which outrank the
 * built-in lexicon when both match the same Korean string.
 */
export function matchGlossary(
  text: string,
  mode: InterpretationMode,
  extra: GlossaryItem[] = [],
): GlossaryMatch[] {
  if (!text.trim()) return [];

  const entries = dedupeByKorean([...extra, ...lexiconFor(mode)]).sort(byLengthDesc);

  // Track which characters are already claimed so a longer match suppresses
  // the shorter terms nested inside it.
  const claimed = new Array<boolean>(text.length).fill(false);
  const matches: GlossaryMatch[] = [];

  for (const entry of entries) {
    // Whole-word only. Korean agglutinates, so substring search would report
    // 감사 ("thanksgiving") inside 감사합니다 ("thank you").
    for (const index of findWholeWordOccurrences(text, entry.korean)) {
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

/**
 * The terms worth showing on the live console: recent matches first, capped,
 * with prep-sheet entries preferred.
 */
export function liveGlossary(
  recentText: string,
  mode: InterpretationMode,
  extra: GlossaryItem[] = [],
  limit = LIVE_GLOSSARY_LIMIT,
): GlossaryItem[] {
  return (
    matchGlossary(recentText, mode, extra)
      // Discourse markers (여러분, 사실은, 그러니까) are useful to the model as
      // register context but they are noise on the rail — an interpreter does
      // not need to be told that 여러분 means "everyone".
      .filter((item) => !item.register)
      .slice(0, limit)
      .map(({ index: _index, ...item }) => item)
  );
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
