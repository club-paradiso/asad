/**
 * Translation Memory: remembered renderings of whole units.
 *
 * A sermon repeats its refrain; a clinic repeats its instructions; a
 * reception desk says "please sign here" forty times a day. Every one of
 * those is a model call the engine can skip — and, more importantly, an
 * opportunity for the rendering to *drift*, which is what an interpreter
 * notices and hates. A memory hit is stable by construction.
 *
 * The lookup is a ladder, most conservative rung first:
 *
 *   1. exact validated  — same key, a person or the prep sheet behind it;
 *   2. normalised exact — same key, any provenance with confidence ≥ 0.7;
 *   3. entity-aware     — same key once known entities are slotted out, with
 *                          the entity's own target substituted in the answer;
 *   4. safe fuzzy       — near-identical tokens AND identical numbers, dates,
 *                          times, codes AND the same negation count.
 *
 * Rung 4 is the only one that can be wrong in a way an interpreter would
 * not forgive, so it demands every structured value match. "300명" and
 * "200명" share 90% of their tokens; they will never share a memory.
 *
 * Provenance precedence is absolute: a lower-trust rendering never overwrites
 * a higher-trust one for the same source. Supersession is recorded, never
 * deleted, so the history can be shown.
 */
import type { LanguagePair } from "@/types";
import { languageBase, resolveLanguage } from "@/languages/registry";
import { extractStructuredValues, negationCount, normalisationKey } from "@/languages/normalise";
import { tokenOverlap } from "@/interpreter/repair/similarity";
import { confidenceFor, entityKey } from "./entity-memory";
import {
  PROVENANCE_RANK,
  type CanonicalEntity,
  type MemoryProvenance,
  type TranslationMemoryEntry,
  type TranslationMemoryHit,
} from "./types";

export interface TranslationMemoryState {
  entries: TranslationMemoryEntry[];
}

export const emptyTranslationMemory = (): TranslationMemoryState => ({ entries: [] });

export interface TranslationMemoryStats {
  entries: number;
  hits: number;
  misses: number;
}

export const MAX_ENTRIES = 500;
/** Units longer than this are one-offs; units shorter than two words are glossary, not memory. */
export const MAX_SOURCE_CHARS = 300;
export const MIN_SOURCE_UNITS = 2;

/** Confidence floors per ladder rung. */
export const NORMALISED_MIN_CONFIDENCE = 0.7;
export const FUZZY_MIN_CONFIDENCE = 0.8;
export const FUZZY_MIN_OVERLAP = 0.9;

let counter = 0;
const nextId = () => `tm-${++counter}`;
/** Test seam: deterministic ids across test files. */
export function __resetMemoryIds(): void {
  counter = 0;
}

const languageId = (tag: string) => resolveLanguage(tag)?.id ?? tag.trim().toLowerCase();

/** Two pairs are the same when both sides resolve to the same registry language. */
export function samePair(a: LanguagePair, b: LanguagePair): boolean {
  return languageId(a.source) === languageId(b.source) && languageId(a.target) === languageId(b.target);
}

/** How many units the language counts a phrase in: words for spaced scripts, characters otherwise. */
function unitCount(text: string, language: string): number {
  const spaceless = resolveLanguage(language)?.spacing === "none";
  if (spaceless) return [...text.replace(/[\s\p{P}]/gu, "")].length / 2;
  return text.split(/\s+/).filter(Boolean).length;
}

function live(entry: TranslationMemoryEntry): boolean {
  return !entry.invalidated && !entry.supersededBy;
}

function trimEntries(entries: TranslationMemoryEntry[]): TranslationMemoryEntry[] {
  if (entries.length <= MAX_ENTRIES) return entries;
  const ranked = [...entries].sort(
    (a, b) =>
      Number(live(a)) - Number(live(b)) ||
      PROVENANCE_RANK[a.provenance] - PROVENANCE_RANK[b.provenance] ||
      a.count - b.count ||
      a.updatedAt - b.updatedAt,
  );
  const evicted = new Set(ranked.slice(0, entries.length - MAX_ENTRIES).map((e) => e.id));
  return entries.filter((e) => !evicted.has(e.id));
}

/**
 * Remember a rendering.
 *
 * Same key and pair: the same target merges (count up, confidence per the
 * bounded rule, provenance upgraded if the newcomer is better trusted); a
 * different target supersedes only when it is at least as trusted, and is
 * silently dropped otherwise — a model must not out-vote the interpreter.
 */
export function remember(
  state: TranslationMemoryState,
  input: {
    source: string;
    target: string;
    pair: LanguagePair;
    domain?: string;
    provenance: MemoryProvenance;
    now: number;
  },
): TranslationMemoryState {
  const source = input.source.trim();
  const target = input.target.trim();
  if (!source || !target) return state;
  if (source.length > MAX_SOURCE_CHARS) return state;
  if (unitCount(source, input.pair.source) < MIN_SOURCE_UNITS) return state;

  const sourceNorm = normalisationKey(source, input.pair.source);
  if (!sourceNorm) return state;
  const targetKey = target.toLowerCase();
  const rank = PROVENANCE_RANK[input.provenance];

  const at = state.entries.findIndex((e) => live(e) && e.sourceNorm === sourceNorm && samePair(e.pair, input.pair));
  if (at === -1) {
    const entry: TranslationMemoryEntry = {
      id: nextId(),
      source,
      sourceNorm,
      target,
      pair: { ...input.pair },
      domain: input.domain,
      provenance: input.provenance,
      count: 1,
      confidence: confidenceFor(input.provenance, 1),
      createdAt: input.now,
      updatedAt: input.now,
    };
    return { entries: trimEntries([...state.entries, entry]) };
  }

  const existing = state.entries[at];
  const entries = [...state.entries];

  if (existing.target.toLowerCase() === targetKey) {
    const provenance = rank > PROVENANCE_RANK[existing.provenance] ? input.provenance : existing.provenance;
    const count = existing.count + 1;
    entries[at] = {
      ...existing,
      provenance,
      count,
      confidence: Math.max(existing.confidence, confidenceFor(provenance, count)),
      domain: existing.domain ?? input.domain,
      updatedAt: Math.max(existing.updatedAt, input.now),
    };
    return { entries };
  }

  if (rank < PROVENANCE_RANK[existing.provenance]) return state;

  const replacement: TranslationMemoryEntry = {
    id: nextId(),
    source,
    sourceNorm,
    target,
    pair: { ...input.pair },
    domain: input.domain ?? existing.domain,
    provenance: input.provenance,
    count: 1,
    confidence: confidenceFor(input.provenance, 1),
    createdAt: input.now,
    updatedAt: input.now,
  };
  entries[at] = { ...existing, supersededBy: replacement.id };
  return { entries: trimEntries([...entries, replacement]) };
}

/** Mark an entry rejected by the interpreter. It is never served again. */
export function invalidate(state: TranslationMemoryState, id: string): TranslationMemoryState {
  const at = state.entries.findIndex((e) => e.id === id);
  if (at === -1) return state;
  const entries = [...state.entries];
  entries[at] = { ...entries[at], invalidated: true };
  return { entries };
}

const byTrust = (a: TranslationMemoryEntry, b: TranslationMemoryEntry) =>
  PROVENANCE_RANK[b.provenance] - PROVENANCE_RANK[a.provenance] ||
  b.confidence - a.confidence ||
  b.count - a.count ||
  b.updatedAt - a.updatedAt;

interface Slotted {
  text: string;
  /** Entities in slot order: slot `{{e1}}` is `entities[0]`. */
  entities: CanonicalEntity[];
}

/**
 * Replace every known entity form in a text with a numbered slot, longest
 * form first so 박성훈 목사 is one slot rather than 박성훈 plus a stray 목사.
 * Slots are numbered by first appearance so two units that mention different
 * entities in the same position produce the same slotted text.
 */
function slotEntities(text: string, entities: CanonicalEntity[]): Slotted {
  const forms: Array<{ form: string; entity: CanonicalEntity }> = [];
  for (const entity of entities) {
    for (const form of new Set([entity.canonical, ...entity.surfaces])) {
      if (form.trim()) forms.push({ form: form.trim(), entity });
    }
  }
  forms.sort((a, b) => b.form.length - a.form.length);

  const order: CanonicalEntity[] = [];
  let out = text;
  for (const { form, entity } of forms) {
    if (!out.includes(form)) continue;
    let slot = order.indexOf(entity);
    if (slot === -1) {
      order.push(entity);
      slot = order.length - 1;
    }
    out = out.split(form).join(`{{e${slot + 1}}}`);
  }
  return { text: out, entities: order };
}

function structuredSignature(text: string, language: string): string {
  const values = extractStructuredValues(text, language);
  const norm = (list: string[]) => [...list].map((v) => v.replace(/[\s,]/g, "").toLowerCase()).sort().join("|");
  return [norm(values.numbers), norm(values.dates), norm(values.times), norm(values.codes)].join("#");
}

/**
 * Look a unit up, most conservative rung first. `validatedOnly` stops after
 * rung 1 — the fast path uses it to skip the model entirely, and nothing less
 * than a person's confirmation should do that.
 */
export function lookup(
  state: TranslationMemoryState,
  input: {
    source: string;
    pair: LanguagePair;
    language: string;
    entities?: CanonicalEntity[];
    validatedOnly?: boolean;
  },
): TranslationMemoryHit | null {
  const source = input.source.trim();
  if (!source) return null;
  const candidates = state.entries.filter((e) => live(e) && samePair(e.pair, input.pair)).sort(byTrust);
  if (candidates.length === 0) return null;
  const key = normalisationKey(source, input.language);

  // 1. Exact, validated by a person or the prep sheet.
  const validated = candidates.find(
    (e) => e.sourceNorm === key && (e.provenance === "user" || e.provenance === "prep"),
  );
  if (validated) return { entry: validated, kind: "exact", target: validated.target, score: 1 };
  if (input.validatedOnly) return null;

  // 2. Same key, any provenance that has earned enough confidence.
  const normalised = candidates.find((e) => e.sourceNorm === key && e.confidence >= NORMALISED_MIN_CONFIDENCE);
  if (normalised) return { entry: normalised, kind: "normalised", target: normalised.target, score: normalised.confidence };

  // 3. Same key once known entities are replaced by slots.
  const entities = (input.entities ?? []).filter((e) => e.target.trim());
  if (entities.length > 0) {
    const unit = slotEntities(source, entities);
    if (unit.entities.length > 0) {
      const unitKey = normalisationKey(unit.text, input.language);
      for (const entry of candidates) {
        if (entry.confidence < NORMALISED_MIN_CONFIDENCE) continue;
        const remembered = slotEntities(entry.source, entities);
        if (remembered.entities.length !== unit.entities.length) continue;
        if (normalisationKey(remembered.text, input.language) !== unitKey) continue;
        let target = entry.target;
        let substituted = true;
        remembered.entities.forEach((was, slot) => {
          const now = unit.entities[slot];
          if (entityKey(was.target) === entityKey(now.target)) return;
          if (!target.includes(was.target)) {
            substituted = false;
            return;
          }
          target = target.split(was.target).join(now.target);
        });
        if (!substituted) continue;
        return { entry, kind: "entity-aware", target, score: Math.min(0.95, entry.confidence) };
      }
    }
  }

  // 4. Safe fuzzy: near-identical tokens, identical structured values, same negation.
  const signature = structuredSignature(source, input.language);
  const negation = negationCount(source, input.language);
  let best: { entry: TranslationMemoryEntry; overlap: number } | null = null;
  for (const entry of candidates) {
    if (PROVENANCE_RANK[entry.provenance] < PROVENANCE_RANK.inferred) continue;
    if (entry.confidence < FUZZY_MIN_CONFIDENCE) continue;
    const overlap = tokenOverlap(source, entry.source, input.language);
    if (overlap < FUZZY_MIN_OVERLAP) continue;
    if (structuredSignature(entry.source, input.language) !== signature) continue;
    if (negationCount(entry.source, input.language) !== negation) continue;
    if (!best || overlap > best.overlap) best = { entry, overlap };
  }
  if (best) {
    return { entry: best.entry, kind: "fuzzy", target: best.entry.target, score: best.overlap * best.entry.confidence };
  }
  return null;
}

/**
 * Remembered renderings relevant to a unit — the unit contains a remembered
 * source or is contained by one — for the prompt's memory hints. Best trust
 * first, capped, because the prompt budget is small and a hint the model
 * ignores is cheaper than one it misapplies.
 */
export function hintsFor(
  state: TranslationMemoryState,
  input: { source: string; pair: LanguagePair; language: string; limit?: number },
): Array<{ source: string; target: string }> {
  const key = normalisationKey(input.source, input.language);
  if (!key) return [];
  const limit = input.limit ?? 6;
  return state.entries
    .filter((e) => live(e) && samePair(e.pair, input.pair))
    .filter((e) => e.sourceNorm.length > 0 && (key.includes(e.sourceNorm) || e.sourceNorm.includes(key)))
    .sort(byTrust)
    .slice(0, limit)
    .map((e) => ({ source: e.source, target: e.target }));
}

/** Whether the source and target sides of a pair are different languages. */
export const crossesLanguages = (pair: LanguagePair): boolean =>
  languageBase(pair.source) !== languageBase(pair.target);
