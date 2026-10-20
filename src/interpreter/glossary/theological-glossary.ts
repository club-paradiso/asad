/**
 * Church-interpreter theological glossary pack.
 *
 * Source of truth: `data/theological-glossary.json` — Korean theological
 * headwords with standard English AND Chinese renderings, curated for the
 * Korean-church interpreter volunteers ASAD serves. The Chinese column exists
 * because church interpretation in Korea increasingly involves Chinese-speaking
 * congregants (international students, migrant workers, tourists); the pack is
 * the standard for both target languages.
 *
 * PRIORITY: the pack is consulted BEFORE the hand-curated theological lexicon
 * (`lexicon.ts`) and the volunteer community glossary (`community-glossary.ts`).
 * Prep-sheet and session decisions still outrank everything — an interpreter's
 * explicit choice for the day is never silently replaced by a lookup table.
 *
 * The pack is only active in a worship context, like the theological lexicon.
 * Overlaps with the lexicon keep the pack's standard rendering but inherit the
 * lexicon's hand-written notes and alternatives where the pack is silent, so
 * guidance like 은혜's greeting reading is not lost to the upgrade.
 */
import { z } from "zod";
import type { GlossaryItem, ResolvedContext } from "@/types";
import { isWorshipContext } from "../context/context-mode";
import rawPack from "../../../data/theological-glossary.json";

const packEntrySchema = z.object({
  ko: z.string().min(1),
  en: z.string().min(1),
  zh: z.string().min(1),
  category: z.string().min(1),
  note: z.string().max(240),
});

const packSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
  description: z.string().optional(),
  entries: z.array(packEntrySchema),
});

export interface TheologicalGlossaryEntry {
  ko: string;
  en: string;
  zh: string;
  category: string;
  note: string;
}

/** The pack must stay a useful standard — below this it is not worth loading. */
export const GLOSSARY_PACK_MIN_ENTRIES = 60;

/**
 * Validated pack entries. A malformed data file fails loudly at import time:
 * a glossary that silently loads half its rows is worse than one that refuses.
 */
export const THEOLOGICAL_GLOSSARY: TheologicalGlossaryEntry[] = (() => {
  const parsed = packSchema.parse(rawPack);
  if (parsed.entries.length < GLOSSARY_PACK_MIN_ENTRIES) {
    throw new Error(
      `theological-glossary.json carries ${parsed.entries.length} entries, below the minimum of ${GLOSSARY_PACK_MIN_ENTRIES}`,
    );
  }
  const seen = new Set<string>();
  for (const entry of parsed.entries) {
    if (seen.has(entry.ko)) {
      throw new Error(`theological-glossary.json has a duplicate headword: ${entry.ko}`);
    }
    seen.add(entry.ko);
  }
  return parsed.entries;
})();

/** Categories the pack ships, in the order the data file introduces them. */
export const GLOSSARY_PACK_CATEGORIES: string[] = [
  ...new Set(THEOLOGICAL_GLOSSARY.map((entry) => entry.category)),
];

/** The pack as engine glossary items — the standard rendering, first in line. */
export function packGlossaryItems(): GlossaryItem[] {
  return THEOLOGICAL_GLOSSARY.map((entry) => ({
    korean: entry.ko,
    english: entry.en,
    note: entry.note || undefined,
    source: "glossary-pack" as const,
  }));
}

/**
 * Put the pack's entries ahead of the lexicon entries they overlap with.
 *
 * For a headword the pack covers, the pack's English/Chinese standard wins;
 * the lexicon donates its note and alternatives only where the pack is silent.
 * Headwords the pack does not cover pass through untouched, in order.
 */
export function applyGlossaryPack(
  items: GlossaryItem[],
  context: ResolvedContext,
): GlossaryItem[] {
  if (!isWorshipContext(context)) return items;
  const pack = new Map(packGlossaryItems().map((item) => [item.korean.trim(), item]));
  const out: GlossaryItem[] = [];
  const consumed = new Set<string>();
  for (const item of items) {
    const key = item.korean.trim();
    const standard = pack.get(key);
    if (!standard) {
      out.push(item);
      continue;
    }
    consumed.add(key);
    out.push({
      ...item,
      korean: standard.korean,
      english: standard.english,
      note: standard.note ?? item.note,
      source: standard.source,
    });
  }
  // Pack entries the lexicon never had — new coverage, appended in pack order.
  for (const [key, standard] of pack) {
    if (!consumed.has(key)) out.push(standard);
  }
  return out;
}
