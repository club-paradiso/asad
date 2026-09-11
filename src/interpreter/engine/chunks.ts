/**
 * Chunk store — temporal locking.
 *
 * The single hardest constraint in simultaneous interpretation tooling: once
 * the interpreter has probably *said* a line out loud, that line must stop
 * moving. Streaming systems that continuously rewrite earlier text are
 * unusable, because the interpreter's mouth is already three seconds past it.
 *
 * So chunks move one way only:
 *
 *     anticipated ──▶ current ──▶ committed
 *                                    │
 *                                    └─▶ (never edited; a serious fix is
 *                                         appended as a discreet correction)
 */
import type { Confidence, InterpretationChunk } from "@/types";

export type ChunkDraft = Omit<InterpretationChunk, "id" | "state" | "at">;

let counter = 0;
/** Monotonic id. Stable across a session; not intended to be global. */
export const nextChunkId = (prefix = "c"): string => {
  counter += 1;
  return `${prefix}${counter.toString(36)}`;
};

/** Reset ids — test seam only. */
export const __resetChunkIds = () => {
  counter = 0;
};

const normalise = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9가-힣]+/g, " ").trim();

/** How far back to look when suppressing a repeated line. */
const DUPLICATE_WINDOW = 6;

export interface AddSafeResult {
  chunks: InterpretationChunk[];
  added: InterpretationChunk[];
}

/**
 * Append newly confirmed English.
 *
 * Anticipated chunks are cleared first — a prediction is either superseded by
 * the real thing or it was wrong; either way it must not linger next to
 * confirmed text.
 *
 * Duplicate suppression is deliberately one-directional: it compares against
 * what was ALREADY on screen before this turn, never against lines this same
 * turn is adding. The two cases are not the same thing.
 *
 *   across turns — the model re-emitting a line it already delivered, because
 *     overlapping context asked it to continue. Noise. Dropped.
 *   within a turn — the model repeating a line because the preacher did. A
 *     three-fold build is the rhetoric, and `CORE_CONTRACT` tells the model to
 *     preserve it; suppressing it here deleted the refrain from the English
 *     stream and left the interpreter delivering one line where the room heard
 *     three.
 */
export function addSafeChunks(
  chunks: InterpretationChunk[],
  drafts: ChunkDraft[],
  now: number,
): AddSafeResult {
  const base = chunks.filter((c) => c.state !== "anticipated");
  const alreadyDelivered = base.slice(-DUPLICATE_WINDOW).map((c) => normalise(c.text));
  const added: InterpretationChunk[] = [];

  for (const draft of drafts) {
    const text = draft.text.trim();
    if (!text) continue;
    const key = normalise(text);
    if (!key || alreadyDelivered.includes(key)) continue;

    const chunk: InterpretationChunk = {
      ...draft,
      text,
      id: nextChunkId(),
      state: "current",
      at: now,
    };
    added.push(chunk);
  }

  return { chunks: [...base, ...added], added };
}

/**
 * Replace the anticipated tail. Anticipated chunks are ephemeral by design:
 * there is at most one generation of them on screen at a time.
 */
export function setAnticipatedChunks(
  chunks: InterpretationChunk[],
  drafts: ChunkDraft[],
  now: number,
): InterpretationChunk[] {
  const base = chunks.filter((c) => c.state !== "anticipated");
  const spoken = base.slice(-DUPLICATE_WINDOW).map((c) => normalise(c.text));

  const predicted = drafts
    .map((d) => ({ ...d, text: d.text.trim() }))
    .filter((d) => d.text && !spoken.includes(normalise(d.text)))
    .map<InterpretationChunk>((d) => ({
      ...d,
      id: nextChunkId("a"),
      state: "anticipated",
      at: now,
    }));

  return [...base, ...predicted];
}

/** Drop the anticipated tail without touching anything confirmed. */
export const clearAnticipated = (chunks: InterpretationChunk[]): InterpretationChunk[] =>
  chunks.filter((c) => c.state !== "anticipated");

/**
 * Lock any `current` chunk that has been on screen longer than the lag
 * profile's dwell time. After this the chunk is immutable.
 */
export function commitDueChunks(
  chunks: InterpretationChunk[],
  now: number,
  dwellMs: number,
): InterpretationChunk[] {
  let changed = false;
  const next = chunks.map((chunk) => {
    if (chunk.state !== "current" || now - chunk.at < dwellMs) return chunk;
    changed = true;
    return { ...chunk, state: "committed" as const };
  });
  return changed ? next : chunks;
}

/**
 * Lock everything currently editable. Used when a new interpretation lands:
 * whatever came before it has been superseded and is no longer a candidate for
 * revision.
 */
export function commitAll(chunks: InterpretationChunk[]): InterpretationChunk[] {
  let changed = false;
  const next = chunks.map((chunk) => {
    if (chunk.state !== "current") return chunk;
    changed = true;
    return { ...chunk, state: "committed" as const };
  });
  return changed ? next : chunks;
}

/**
 * Append a discreet correction to an already-locked chunk.
 *
 * The original is left exactly as it was — the interpreter said it, and the
 * screen must keep matching their memory of what they said.
 */
export function appendCorrection(
  chunks: InterpretationChunk[],
  targetId: string,
  text: string,
  now: number,
  confidence: Confidence = "high",
): InterpretationChunk[] {
  const target = chunks.find((c) => c.id === targetId);
  if (!target) return chunks;
  const base = clearAnticipated(chunks);
  return [
    ...base,
    {
      id: nextChunkId("x"),
      text: text.trim(),
      state: "current",
      at: now,
      confidence,
      correctsChunkId: targetId,
      note: "correction",
    },
  ];
}

/** The chunk the interpreter is most likely saying right now. */
export function activeChunk(chunks: InterpretationChunk[]): InterpretationChunk | undefined {
  const current = [...chunks].reverse().find((c) => c.state === "current");
  if (current) return current;
  return [...chunks].reverse().find((c) => c.state === "committed");
}

/** Everything confirmed, in order — what the teleprompter reads from. */
export const spokenChunks = (chunks: InterpretationChunk[]): InterpretationChunk[] =>
  chunks.filter((c) => c.state !== "anticipated");

export const anticipatedChunks = (chunks: InterpretationChunk[]): InterpretationChunk[] =>
  chunks.filter((c) => c.state === "anticipated");

/** Cap session length in memory so a 70-minute session stays responsive. */
export const MAX_CHUNKS_IN_VIEW = 400;

export function trimChunks(chunks: InterpretationChunk[]): InterpretationChunk[] {
  return chunks.length <= MAX_CHUNKS_IN_VIEW
    ? chunks
    : chunks.slice(chunks.length - MAX_CHUNKS_IN_VIEW);
}

/* --------------------------------------------------------------------------
 * Two-lane support: logical turns, provisional chunks, legal refinement.
 *
 * None of this adds a temporal state. A provisional chunk is a `current` chunk
 * with two pieces of metadata — which turn it answers and that it came from the
 * fast lane — and commits on exactly the same dwell clock as any other chunk.
 * The only new question these helpers answer is: "may contextual English for
 * turn N still replace what the fast lane rendered for turn N?"
 * ------------------------------------------------------------------------ */

/** Provisional chunks belonging to any of `turnIds`, in stream order. */
export const provisionalChunksFor = (
  chunks: InterpretationChunk[],
  turnIds: readonly number[],
): InterpretationChunk[] =>
  chunks.filter(
    (c) => c.provisional === true && c.turnId !== undefined && turnIds.includes(c.turnId),
  );

/**
 * - `refine`: every provisional chunk of those turns is still editable.
 * - `locked`: at least one has committed. The interpreter may have said it, so
 *   a stylistic replacement is discarded rather than appended.
 * - `fresh`: no provisional chunk exists for those turns (the fast lane was
 *   off, failed, or is still running); the result is appended as new English.
 */
export type RefinementLegality = "refine" | "locked" | "fresh";

export function refinementLegality(
  chunks: InterpretationChunk[],
  turnIds: readonly number[],
): RefinementLegality {
  const provisional = provisionalChunksFor(chunks, turnIds);
  if (provisional.length === 0) return "fresh";
  return provisional.every((c) => c.state === "current") ? "refine" : "locked";
}

export interface RefineResult {
  chunks: InterpretationChunk[];
  /** False when the contextual English matched the provisional line for line. */
  changed: boolean;
  added: InterpretationChunk[];
}

/**
 * Replace the still-editable provisional chunks of `turnIds` with contextual
 * drafts, in the position the provisional text occupied.
 *
 * Caller must have checked `refinementLegality === "refine"`. The replacement
 * keeps the earliest provisional `at`: the dwell clock measures how long the
 * interpreter has had that line, and a refinement is a better rendering of the
 * same line, not a new one. Committed chunks are never touched — they keep
 * their object identity.
 */
export function refineProvisionalChunks(
  chunks: InterpretationChunk[],
  turnIds: readonly number[],
  drafts: ChunkDraft[],
  now: number,
): RefineResult {
  const targets = provisionalChunksFor(chunks, turnIds);
  if (targets.length === 0 || targets.some((c) => c.state !== "current")) {
    return { chunks, changed: false, added: [] };
  }
  const targetIds = new Set(targets.map((c) => c.id));
  const first = chunks.findIndex((c) => targetIds.has(c.id));
  const before = chunks.slice(0, first).filter((c) => !targetIds.has(c.id));
  const after = chunks.slice(first).filter((c) => !targetIds.has(c.id) && c.state !== "anticipated");
  const at = Math.min(now, ...targets.map((c) => c.at));

  const alreadyDelivered = before
    .filter((c) => c.state !== "anticipated")
    .slice(-DUPLICATE_WINDOW)
    .map((c) => normalise(c.text));
  const incoming = drafts
    .map((d) => ({ ...d, text: d.text.trim() }))
    .filter((d) => d.text && normalise(d.text) && !alreadyDelivered.includes(normalise(d.text)));

  // Nothing usable: the provisional line stands. Never blank the screen.
  if (incoming.length === 0) return { chunks, changed: false, added: [] };

  const identical =
    incoming.length === targets.length &&
    incoming.every((d, i) => normalise(d.text) === normalise(targets[i].text));
  if (identical) {
    // Same words: keep the text the interpreter is already reading, drop the
    // provisional flag so a later result cannot touch it again.
    const settled = chunks.map((c) => (targetIds.has(c.id) ? { ...c, provisional: false } : c));
    return { chunks: settled.filter((c) => c.state !== "anticipated"), changed: false, added: [] };
  }

  const turnId = Math.max(...turnIds);
  const added = incoming.map<InterpretationChunk>((d) => ({
    ...d,
    id: nextChunkId(),
    state: "current",
    at,
    turnId,
    provisional: false,
  }));
  return { chunks: [...before, ...added, ...after], changed: true, added };
}

/**
 * Append English for `turnIds` in stream order.
 *
 * Normally that is the tail. When an older turn's English arrives after a
 * newer turn has already rendered (fast lane ahead of a slow cloud), it goes
 * in front of the newer turn's chunks — but only while those are still
 * editable. Anything committed keeps its place, so a late result can never
 * reorder what the interpreter has already read; it is appended after it.
 *
 * Everything positioned before the insertion point is locked, as
 * `applyOutput` always did: new English means the interpreter has moved past
 * whatever was editable before it.
 */
export function insertTurnChunks(
  chunks: InterpretationChunk[],
  drafts: ChunkDraft[],
  turnIds: readonly number[],
  now: number,
  options: { provisional?: boolean } = {},
): AddSafeResult {
  const base = clearAnticipated(chunks);
  const turnId = Math.max(...turnIds);

  let position = base.length;
  for (let i = base.length - 1; i >= 0; i -= 1) {
    const chunk = base[i];
    if (chunk.state === "current" && chunk.turnId !== undefined && chunk.turnId > turnId) {
      position = i;
    } else {
      break;
    }
  }

  const before = commitAll(base.slice(0, position));
  const after = base.slice(position);
  const alreadyDelivered = before.slice(-DUPLICATE_WINDOW).map((c) => normalise(c.text));
  const added: InterpretationChunk[] = [];

  for (const draft of drafts) {
    const text = draft.text.trim();
    if (!text) continue;
    const key = normalise(text);
    if (!key || alreadyDelivered.includes(key)) continue;
    added.push({
      ...draft,
      text,
      id: nextChunkId(),
      state: "current",
      at: now,
      turnId,
      ...(options.provisional ? { provisional: true } : {}),
    });
  }

  return { chunks: [...before, ...added, ...after], added };
}
