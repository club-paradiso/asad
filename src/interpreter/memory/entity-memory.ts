/**
 * Entity Memory: one canonical named thing, every way it has been heard.
 *
 * A recogniser hears 뉴송교회 as 뉴송 처치, 뉴 송 처치 and 뉴스송 처치 in the
 * same ten minutes. The session memory in `context/memory.ts` keys entities
 * by their exact Korean and so sees three strangers. This module sees one
 * entity with three surfaces, and can tell the repair layer "that span is
 * probably the church" with a score it can defend.
 *
 * Trust is explicit. A binding the interpreter typed is 1.0 and never gets
 * overwritten by a model guess; a model guess starts at 0.4 and has to recur
 * to climb, and can never climb past 0.75 on its own. Everything downstream
 * that binds a surface to an entity asks for confidence ≥ 0.6 or a person
 * behind it, so a single model answer never rewrites the transcript.
 *
 * Nothing here is specific to any name, church or pair: every binding comes
 * in through `establishEntity` from prep, corrections, glossary or the model.
 */
import type { EntityResolution } from "@/types";
import { normaliseTranscript } from "@/languages/normalise";
import { findSimilarSpans } from "@/interpreter/repair/similarity";
import { PROVENANCE_RANK, type CanonicalEntity, type MemoryProvenance } from "./types";

export interface EntityMemoryState {
  entities: CanonicalEntity[];
}

export const emptyEntityMemory = (): EntityMemoryState => ({ entities: [] });

/** Surfaces per entity and entities per session are bounded so memory never grows with session length. */
export const MAX_SURFACES = 12;
export const MAX_ENTITIES = 200;

/** Threshold below which a fuzzy surface is not reported at all. */
export const SURFACE_MATCH_THRESHOLD = 0.72;
/** Entities below this confidence never bind a surface unless a person is behind them. */
export const SURFACE_BIND_CONFIDENCE = 0.6;

let counter = 0;
const nextId = () => `ent-${++counter}`;
/** Test seam: deterministic ids across test files. */
export function __resetEntityIds(): void {
  counter = 0;
}

/**
 * Confidence after the n-th establishment under a provenance. People and
 * prep are trusted outright; inferences and model answers earn trust slowly
 * and are capped so recurrence alone never equals a person's word.
 */
export function confidenceFor(provenance: MemoryProvenance, count: number): number {
  switch (provenance) {
    case "user":
      return 1;
    case "prep":
      return 0.95;
    case "glossary":
      return 0.9;
    case "inferred":
      return Math.min(0.9, 0.55 + 0.15 * Math.max(0, count - 1));
    case "model":
      return Math.min(0.75, 0.4 + 0.1 * Math.max(0, count - 1));
  }
}

/** Identity key for a canonical form: case, whitespace and punctuation insensitive, script-agnostic. */
export function entityKey(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

const stripSpace = (s: string) => s.replace(/\s+/g, "");

function cleanSurface(surface: string, language: string): string {
  return normaliseTranscript(surface, language).text;
}

function addSurface(surfaces: string[], surface: string): string[] {
  const clean = surface.trim();
  if (!clean) return surfaces;
  const key = entityKey(clean);
  if (surfaces.some((s) => entityKey(s) === key)) return surfaces;
  const next = [...surfaces, clean];
  // The canonical form is always surfaces[0]; evict the oldest variant after it.
  while (next.length > MAX_SURFACES) next.splice(1, 1);
  return next;
}

function trimEntities(entities: CanonicalEntity[]): CanonicalEntity[] {
  if (entities.length <= MAX_ENTITIES) return entities;
  const ranked = [...entities].sort(
    (a, b) =>
      PROVENANCE_RANK[a.provenance] - PROVENANCE_RANK[b.provenance] ||
      a.confidence - b.confidence ||
      a.count - b.count ||
      a.updatedAt - b.updatedAt,
  );
  const evicted = new Set(ranked.slice(0, entities.length - MAX_ENTITIES).map((e) => e.id));
  return entities.filter((e) => !evicted.has(e.id));
}

/**
 * Record an established binding.
 *
 * Same canonical → merge: count goes up, the surface is added, confidence
 * follows the bounded rule for the *effective* provenance and never goes
 * down. The target rendering and provenance only change when the incoming
 * provenance is at least as trusted as the existing one — a model answer can
 * add a surface to a user-confirmed entity but cannot rename it.
 */
export function establishEntity(
  state: EntityMemoryState,
  input: {
    canonical: string;
    target: string;
    kind?: CanonicalEntity["kind"];
    surface?: string;
    provenance: MemoryProvenance;
    now: number;
    language: string;
  },
): EntityMemoryState {
  const canonical = cleanSurface(input.canonical, input.language);
  const target = input.target.trim();
  if (!canonical || !target) return state;
  const key = entityKey(canonical);
  const surface = input.surface ? cleanSurface(input.surface, input.language) : "";

  const at = state.entities.findIndex((e) => entityKey(e.canonical) === key);
  if (at === -1) {
    let surfaces = [canonical];
    if (surface) surfaces = addSurface(surfaces, surface);
    const entity: CanonicalEntity = {
      id: nextId(),
      canonical,
      target,
      kind: input.kind ?? "other",
      surfaces,
      provenance: input.provenance,
      count: 1,
      confidence: confidenceFor(input.provenance, 1),
      updatedAt: input.now,
    };
    return { entities: trimEntities([...state.entities, entity]) };
  }

  const existing = state.entities[at];
  const outranked = PROVENANCE_RANK[input.provenance] >= PROVENANCE_RANK[existing.provenance];
  const provenance = outranked ? input.provenance : existing.provenance;
  const count = existing.count + 1;
  const merged: CanonicalEntity = {
    ...existing,
    target: outranked ? target : existing.target,
    kind: outranked && input.kind ? input.kind : existing.kind,
    surfaces: surface ? addSurface(existing.surfaces, surface) : existing.surfaces,
    provenance,
    count,
    confidence: Math.max(existing.confidence, confidenceFor(provenance, count)),
    updatedAt: Math.max(existing.updatedAt, input.now),
  };
  const entities = [...state.entities];
  entities[at] = merged;
  return { entities };
}

/** Seed from prep-sheet / session entities. Language is not carried by EntityResolution; surfaces are cleaned script-agnostically. */
export function seedEntities(
  state: EntityMemoryState,
  entities: EntityResolution[],
  provenance: MemoryProvenance,
  now: number,
): EntityMemoryState {
  let next = state;
  for (const entity of entities) {
    next = establishEntity(next, {
      canonical: entity.korean,
      target: entity.english,
      kind: entity.kind,
      provenance: entity.note === "user" && PROVENANCE_RANK.user > PROVENANCE_RANK[provenance] ? "user" : provenance,
      now,
      language: "ko-KR",
    });
  }
  return next;
}

export interface SurfaceResolution {
  entity: CanonicalEntity;
  /** The exact span in the text that matched. */
  surface: string;
  /** 0–1 surface similarity to the closest known form. */
  score: number;
  /** Offset of the span in the text. */
  index: number;
}

function bindable(entity: CanonicalEntity): boolean {
  return (
    entity.provenance === "user" ||
    entity.provenance === "prep" ||
    entity.confidence >= SURFACE_BIND_CONFIDENCE
  );
}

/**
 * Find spans that plausibly are known entities written differently.
 *
 * Every known form (canonical and surfaces) is searched for with
 * `findSimilarSpans`, which already enforces the length floors and Korean
 * word boundaries. A span that already *is* the canonical form is not a
 * resolution — there is nothing to repair — but a known corrupt surface found
 * verbatim is (score 1), because that is exactly the case a correction was
 * recorded for. Overlapping matches keep the best score.
 */
export function resolveSurfaces(state: EntityMemoryState, text: string, language: string): SurfaceResolution[] {
  const found: Array<SurfaceResolution & { end: number }> = [];
  for (const entity of state.entities) {
    if (!bindable(entity)) continue;
    const canonicalKey = entityKey(entity.canonical);
    const forms = new Map<string, string>();
    for (const form of [entity.canonical, ...entity.surfaces]) forms.set(entityKey(form), form);
    for (const form of forms.values()) {
      for (const match of findSimilarSpans(text, form, language, { threshold: SURFACE_MATCH_THRESHOLD })) {
        if (entityKey(match.text) === canonicalKey) continue;
        found.push({ entity, surface: match.text, score: match.score, index: match.index, end: match.index + match.text.length });
      }
    }
  }

  found.sort(
    (a, b) =>
      b.score - a.score ||
      PROVENANCE_RANK[b.entity.provenance] - PROVENANCE_RANK[a.entity.provenance] ||
      b.entity.confidence - a.entity.confidence ||
      a.index - b.index,
  );
  const chosen: Array<SurfaceResolution & { end: number }> = [];
  for (const candidate of found) {
    if (chosen.some((c) => candidate.index < c.end && candidate.end > c.index)) continue;
    chosen.push(candidate);
  }
  return chosen
    .sort((a, b) => a.index - b.index)
    .map(({ entity, surface, score, index }) => ({ entity, surface, score, index }));
}

/**
 * Replace resolved spans by their canonical form, right to left so earlier
 * offsets stay valid. Spans under `minScore` are left alone; overlapping
 * spans (should not happen after `resolveSurfaces`) keep the first.
 */
export function applyCanonicalForms(
  text: string,
  resolutions: SurfaceResolution[],
  minScore: number,
): { text: string; applied: SurfaceResolution[] } {
  const eligible = resolutions
    .filter((r) => r.score >= minScore && stripSpace(r.surface) !== stripSpace(r.entity.canonical))
    .sort((a, b) => a.index - b.index);
  const applied: SurfaceResolution[] = [];
  let cursor = -1;
  for (const resolution of eligible) {
    if (resolution.index < cursor) continue;
    if (text.slice(resolution.index, resolution.index + resolution.surface.length) !== resolution.surface) continue;
    applied.push(resolution);
    cursor = resolution.index + resolution.surface.length;
  }
  let out = text;
  for (const resolution of [...applied].reverse()) {
    out = out.slice(0, resolution.index) + resolution.entity.canonical + out.slice(resolution.index + resolution.surface.length);
  }
  return { text: out, applied };
}

/** Entities in the shape the prompt and the rail expect, most trusted first. */
export function entitiesForContext(state: EntityMemoryState, limit = 40): EntityResolution[] {
  return [...state.entities]
    .sort(
      (a, b) =>
        PROVENANCE_RANK[b.provenance] - PROVENANCE_RANK[a.provenance] ||
        b.confidence - a.confidence ||
        b.count - a.count ||
        b.updatedAt - a.updatedAt,
    )
    .slice(0, limit)
    .map((entity) => ({
      korean: entity.canonical,
      english: entity.target,
      kind: entity.kind,
      // `note: "user"` is what the session memory treats as "do not overwrite".
      ...(entity.provenance === "user" ? { note: "user" } : {}),
    }));
}
