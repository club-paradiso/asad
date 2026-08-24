/**
 * Session memory.
 *
 * Within a session tong-yuck remembers the things an interpreter would
 * remember and would be annoyed to have to re-decide: who is speaking, how a
 * name is romanised, which English rendering was chosen for a term, and every
 * correction the user made.
 *
 * A user correction is absolute. Once the interpreter says 유정길 is actually
 * 류정길, the recogniser does not get to overrule that for the rest of the
 * session.
 */
import type {
  CorrectionRecord,
  EntityResolution,
  GlossaryItem,
  PrepSheet,
} from "@/types";
import { romaniseName } from "@/lib/romanise";
import { dedupeByKorean, mergeGlossary } from "../glossary/matcher";

export interface SessionMemory {
  entities: EntityResolution[];
  glossary: GlossaryItem[];
  corrections: CorrectionRecord[];
  /** Scripture references already seen, in display form. */
  scripture: string[];
  topic?: string;
}

export const emptyMemory = (): SessionMemory => ({
  entities: [],
  glossary: [],
  corrections: [],
  scripture: [],
});

/** Seed memory from whatever the interpreter chose to prepare. */
export function memoryFromPrep(prep: PrepSheet): SessionMemory {
  const memory = emptyMemory();
  memory.glossary = dedupeByKorean(prep.glossary.map((g) => ({ ...g, source: "prep" as const })));
  memory.entities = [...prep.entities];

  if (prep.speaker?.trim()) {
    memory.entities = upsertEntity(memory.entities, {
      korean: prep.speaker.trim(),
      english: romaniseName(prep.speaker.trim()),
      kind: "person",
      note: "Speaker",
    });
  }
  if (prep.organisation?.trim()) {
    memory.entities = upsertEntity(memory.entities, {
      korean: prep.organisation.trim(),
      english: prep.organisation.trim(),
      kind: "organisation",
    });
  }
  if (prep.title?.trim()) memory.topic = prep.title.trim();
  return memory;
}

/** Add or update an entity, preserving an existing user-chosen English form. */
export function upsertEntity(
  entities: EntityResolution[],
  incoming: EntityResolution,
): EntityResolution[] {
  const key = incoming.korean.trim();
  if (!key) return entities;
  const at = entities.findIndex((e) => e.korean.trim() === key);
  if (at === -1) return [...entities, { ...incoming, korean: key }];
  const next = [...entities];
  next[at] = {
    ...next[at],
    ...incoming,
    // A romanisation the user typed outranks anything generated later.
    english: next[at].note === "user" ? next[at].english : incoming.english || next[at].english,
  };
  return next;
}

/**
 * Record a user correction.
 *
 * The correction also becomes an entity binding, so later mentions of the
 * corrected name carry the interpreter's preferred romanisation.
 */
export function applyCorrection(
  memory: SessionMemory,
  correction: CorrectionRecord,
): SessionMemory {
  const from = correction.from.trim();
  const to = correction.to.trim();
  if (!from || !to) return memory;

  const english = correction.english?.trim() || romaniseName(to);
  const corrections = [
    ...memory.corrections.filter((c) => c.from !== from),
    { ...correction, from, to, english },
  ];

  return {
    ...memory,
    corrections,
    entities: upsertEntity(memory.entities, {
      korean: to,
      english,
      kind: "person",
      note: "user",
    }),
  };
}

/**
 * Rewrite recognised Korean using every correction the user has made so far.
 * Applied to freshly stabilised text before anything downstream sees it.
 */
export function applyCorrectionsToText(text: string, corrections: CorrectionRecord[]): string {
  let out = text;
  for (const { from, to } of corrections) {
    if (!from || from === to) continue;
    out = out.split(from).join(to);
  }
  return out;
}

/** Merge model- and detector-supplied knowledge into memory. */
export function rememberKnowledge(
  memory: SessionMemory,
  update: {
    glossary?: GlossaryItem[];
    entities?: EntityResolution[];
    scripture?: string[];
    topic?: string;
  },
): SessionMemory {
  let entities = memory.entities;
  for (const entity of update.entities ?? []) entities = upsertEntity(entities, entity);

  const scripture = [...memory.scripture];
  for (const ref of update.scripture ?? []) {
    if (ref && !scripture.includes(ref)) scripture.push(ref);
  }

  return {
    ...memory,
    entities,
    scripture,
    glossary: mergeGlossary(memory.glossary, update.glossary ?? []),
    topic: update.topic?.trim() || memory.topic,
  };
}

/**
 * Terms that keep recurring — the ones worth suggesting for next time's prep
 * sheet.
 */
export function recurringTerms(segments: string[], glossary: GlossaryItem[]): GlossaryItem[] {
  const joined = segments.join(" ");
  return glossary
    .map((item) => ({ item, count: countOccurrences(joined, item.korean) }))
    .filter(({ count }) => count >= 3)
    .sort((a, b) => b.count - a.count)
    .map(({ item }) => item);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}
