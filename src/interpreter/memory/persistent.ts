/**
 * Persistent memory: what survives a browser session.
 *
 * Interpreters work the same church, the same clinic, the same counter every
 * week. Re-teaching the console that 류정길 is "Ryu Jeong-gil" every Sunday is
 * the kind of friction that makes people stop using a tool. But persistence
 * is also where a single bad model guess could become a permanent, invisible
 * error, so the store is small, explicit, bounded, and only ever admits
 * learnings a person confirmed or that recurred with strong support.
 *
 * Admission rules (`persistLearnings`):
 *   - corrections: the interpreter's own, unless marked `remember: false`;
 *   - entities: user-confirmed, or inferred ≥ 3 times at confidence ≥ 0.8;
 *   - memory:    user or prep, or inferred ≥ 3 times at confidence ≥ 0.85;
 *   - never anything whose only source is a model answer.
 *
 * Storage is `localStorage`, browser-only, and every access is wrapped: a
 * private window, a full quota or a server render must never take the
 * console down. Loading returns an empty store on any failure; saving
 * returns false. Entity ids are tagged with their language pair on the way
 * in, because `CanonicalEntity` has no pair of its own and an English
 * rendering must not be seeded into a Chinese session.
 */
import type { CorrectionRecord, LanguagePair } from "@/types";
import { resolveLanguage } from "@/languages/registry";
import { entityKey, MAX_SURFACES } from "./entity-memory";
import { samePair } from "./translation-memory";
import { PROVENANCE_RANK, type CanonicalEntity, type PersistentMemoryState, type TranslationMemoryEntry } from "./types";

export const PERSISTENT_MEMORY_KEY = "asad:memory:v1";

export const PERSISTENT_CAPS = { corrections: 300, entities: 300, memory: 300 } as const;

const emptyState = (): PersistentMemoryState => ({ version: 1, corrections: [], entities: [], memory: [] });

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const store = window.localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Shape-check a parsed store; anything unexpected yields the empty store rather than a crash later. */
function coerce(value: unknown): PersistentMemoryState {
  if (!isRecord(value) || value.version !== 1) return emptyState();
  const arrayOf = <T>(list: unknown, ok: (item: unknown) => item is T): T[] =>
    Array.isArray(list) ? list.filter(ok) : [];
  return {
    version: 1,
    corrections: arrayOf(value.corrections, (c): c is PersistentMemoryState["corrections"][number] =>
      isRecord(c) && typeof c.from === "string" && typeof c.to === "string" && isRecord(c.pair),
    ),
    entities: arrayOf(value.entities, (e): e is CanonicalEntity =>
      isRecord(e) && typeof e.id === "string" && typeof e.canonical === "string" && typeof e.target === "string" && Array.isArray(e.surfaces),
    ),
    memory: arrayOf(value.memory, (m): m is TranslationMemoryEntry =>
      isRecord(m) && typeof m.id === "string" && typeof m.source === "string" && typeof m.target === "string" && isRecord(m.pair),
    ),
  };
}

/** Load the store. Empty on the server, on a blocked storage, or on corrupt data. */
export function loadPersistentMemory(): PersistentMemoryState {
  try {
    const raw = storage()?.getItem(PERSISTENT_MEMORY_KEY);
    if (!raw) return emptyState();
    return coerce(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

/** Save the store. False when storage is unavailable, full, or throwing. */
export function savePersistentMemory(state: PersistentMemoryState): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(PERSISTENT_MEMORY_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function forgetPersistentMemory(): void {
  try {
    storage()?.removeItem(PERSISTENT_MEMORY_KEY);
  } catch {
    // Nothing to forget, or nowhere to forget it from.
  }
}

const PAIR_TAG = /^p:([^>]+)>([^:]+):/;

/** Tag an entity id with its pair so `seedFromPersistent` can filter by pair. */
function tagEntityId(id: string, pair: LanguagePair): string {
  const bare = id.replace(PAIR_TAG, "");
  return `p:${pair.source}>${pair.target}:${bare}`;
}

function entityPair(entity: CanonicalEntity): LanguagePair | null {
  const m = PAIR_TAG.exec(entity.id);
  return m ? { source: m[1], target: m[2] } : null;
}

const pairKey = (pair: LanguagePair) =>
  `${resolveLanguage(pair.source)?.id ?? pair.source}>${resolveLanguage(pair.target)?.id ?? pair.target}`;

function admitsEntity(entity: CanonicalEntity): boolean {
  if (entity.provenance === "user") return true;
  return entity.provenance === "inferred" && entity.count >= 3 && entity.confidence >= 0.8;
}

function admitsMemory(entry: TranslationMemoryEntry): boolean {
  if (entry.invalidated || entry.supersededBy) return false;
  if (entry.provenance === "user" || entry.provenance === "prep") return true;
  return entry.provenance === "inferred" && entry.count >= 3 && entry.confidence >= 0.85;
}

/**
 * Merge a session's learnings into the store under the admission rules,
 * then cap each list by trust and recency. Existing rows are merged, not
 * duplicated: a correction made again counts up, an entity seen again keeps
 * its surfaces, a rendering remembered again keeps the better provenance.
 */
export function persistLearnings(
  existing: PersistentMemoryState,
  learnings: {
    corrections: CorrectionRecord[];
    entities: CanonicalEntity[];
    memory: TranslationMemoryEntry[];
    pair: LanguagePair;
    now: number;
  },
): PersistentMemoryState {
  const { pair, now } = learnings;

  const corrections = [...existing.corrections];
  for (const correction of learnings.corrections) {
    if (correction.remember === false) continue;
    const from = correction.from.trim();
    const to = correction.to.trim();
    if (!from || !to || from === to) continue;
    const at = corrections.findIndex((c) => c.from === from && c.to === to && samePair(c.pair, pair));
    if (at === -1) {
      corrections.push({ from, to, english: correction.english?.trim() || undefined, pair: { ...pair }, count: 1, updatedAt: now });
    } else {
      corrections[at] = {
        ...corrections[at],
        english: correction.english?.trim() || corrections[at].english,
        count: corrections[at].count + 1,
        updatedAt: now,
      };
    }
  }

  const entities = [...existing.entities];
  for (const entity of learnings.entities) {
    if (!admitsEntity(entity)) continue;
    const key = entityKey(entity.canonical);
    const at = entities.findIndex((e) => entityKey(e.canonical) === key && entityPair(e) !== null && samePair(entityPair(e)!, pair));
    if (at === -1) {
      entities.push({ ...entity, id: tagEntityId(entity.id, pair), surfaces: [...entity.surfaces].slice(0, MAX_SURFACES), updatedAt: now });
      continue;
    }
    const stored = entities[at];
    const incomingWins = PROVENANCE_RANK[entity.provenance] >= PROVENANCE_RANK[stored.provenance];
    const surfaces = [...stored.surfaces];
    for (const surface of entity.surfaces) {
      if (!surfaces.some((s) => entityKey(s) === entityKey(surface))) surfaces.push(surface);
    }
    entities[at] = {
      ...stored,
      target: incomingWins ? entity.target : stored.target,
      kind: incomingWins ? entity.kind : stored.kind,
      provenance: incomingWins ? entity.provenance : stored.provenance,
      surfaces: surfaces.slice(0, MAX_SURFACES),
      count: stored.count + entity.count,
      confidence: Math.max(stored.confidence, entity.confidence),
      updatedAt: now,
    };
  }

  const memory = [...existing.memory];
  for (const entry of learnings.memory) {
    if (!admitsMemory(entry)) continue;
    const at = memory.findIndex((m) => m.sourceNorm === entry.sourceNorm && samePair(m.pair, entry.pair));
    if (at === -1) {
      memory.push({ ...entry, supersededBy: undefined, invalidated: undefined, updatedAt: now });
      continue;
    }
    const stored = memory[at];
    if (stored.target.toLowerCase() === entry.target.toLowerCase()) {
      const better = PROVENANCE_RANK[entry.provenance] > PROVENANCE_RANK[stored.provenance] ? entry.provenance : stored.provenance;
      memory[at] = {
        ...stored,
        provenance: better,
        count: stored.count + entry.count,
        confidence: Math.max(stored.confidence, entry.confidence),
        updatedAt: now,
      };
    } else if (PROVENANCE_RANK[entry.provenance] >= PROVENANCE_RANK[stored.provenance]) {
      // A different rendering at equal or better trust replaces the old one.
      memory[at] = { ...entry, supersededBy: undefined, invalidated: undefined, updatedAt: now };
    }
  }

  return {
    version: 1,
    corrections: corrections
      .sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt)
      .slice(0, PERSISTENT_CAPS.corrections),
    entities: entities
      .sort((a, b) => PROVENANCE_RANK[b.provenance] - PROVENANCE_RANK[a.provenance] || b.count - a.count || b.updatedAt - a.updatedAt)
      .slice(0, PERSISTENT_CAPS.entities),
    memory: memory
      .sort((a, b) => PROVENANCE_RANK[b.provenance] - PROVENANCE_RANK[a.provenance] || b.count - a.count || b.updatedAt - a.updatedAt)
      .slice(0, PERSISTENT_CAPS.memory),
  };
}

/**
 * Seed a session from the store for one pair. Entities carry their pair in
 * their id; untagged entities (from an older store) are only seeded for the
 * default Korean → English pair they were written for.
 */
export function seedFromPersistent(
  state: PersistentMemoryState,
  pair: LanguagePair,
): { corrections: CorrectionRecord[]; entities: CanonicalEntity[]; memory: TranslationMemoryEntry[] } {
  const wanted = pairKey(pair);
  return {
    corrections: state.corrections
      .filter((c) => samePair(c.pair, pair))
      .map((c) => ({ from: c.from, to: c.to, at: c.updatedAt, english: c.english, remember: true })),
    entities: state.entities.filter((e) => {
      const tagged = entityPair(e);
      if (tagged) return pairKey(tagged) === wanted;
      return wanted === "ko-KR>en-US";
    }),
    memory: state.memory.filter((m) => samePair(m.pair, pair) && !m.invalidated && !m.supersededBy),
  };
}
