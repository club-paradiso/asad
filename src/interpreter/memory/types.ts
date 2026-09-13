/**
 * Memory contracts shared by the Translation Memory, the Entity Memory and
 * the persistent correction store.
 *
 * Trust is explicit and ordered. A single uncertain inference never becomes
 * global truth; it has to be confirmed by a person, come from a curated
 * glossary, or recur with strong support before it outranks a fresh model
 * answer.
 *
 *   user       the interpreter confirmed it        (highest)
 *   prep       typed into today's prep sheet
 *   glossary   curated lexicon / community glossary
 *   inferred   repeated, strongly supported inference
 *   model      a single model answer                (lowest)
 */
export type MemoryProvenance = "user" | "prep" | "glossary" | "inferred" | "model";

export const PROVENANCE_RANK: Record<MemoryProvenance, number> = {
  user: 5,
  prep: 4,
  glossary: 3,
  inferred: 2,
  model: 1,
};

/** One canonical named thing and every way the recogniser has written it. */
export interface CanonicalEntity {
  id: string;
  /** Canonical source-language form, e.g. 박성훈 목사 / 뉴송교회. */
  canonical: string;
  /** Preferred target-language rendering, e.g. Pastor Sung-hoon Park. */
  target: string;
  kind: "person" | "place" | "organisation" | "work" | "other";
  /** Surface forms seen for this entity, canonical included. Never grows unbounded. */
  surfaces: string[];
  provenance: MemoryProvenance;
  /** How many times the entity has been established in this session. */
  count: number;
  /** 0–1 combined evidence that the binding is right. */
  confidence: number;
  updatedAt: number;
}

/** One remembered rendering of a source phrase. */
export interface TranslationMemoryEntry {
  id: string;
  source: string;
  /** Language-aware normalised source, the lookup key. */
  sourceNorm: string;
  target: string;
  pair: { source: string; target: string };
  domain?: string;
  provenance: MemoryProvenance;
  count: number;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  /** Set when a later, better-trusted entry replaced this one. */
  supersededBy?: string;
  /** Set when the interpreter rejected it; never served again. */
  invalidated?: boolean;
}

export type TranslationMemoryMatchKind = "exact" | "normalised" | "entity-aware" | "fuzzy";

export interface TranslationMemoryHit {
  entry: TranslationMemoryEntry;
  kind: TranslationMemoryMatchKind;
  /** The rendering to use — entity slots already substituted for entity-aware hits. */
  target: string;
  /** 0–1. Exact validated hits are 1. */
  score: number;
}

/** What survives a browser session. Small, explicit, user-controlled. */
export interface PersistentMemoryState {
  version: 1;
  corrections: Array<{
    from: string;
    to: string;
    english?: string;
    pair: { source: string; target: string };
    count: number;
    updatedAt: number;
  }>;
  entities: CanonicalEntity[];
  memory: TranslationMemoryEntry[];
}
