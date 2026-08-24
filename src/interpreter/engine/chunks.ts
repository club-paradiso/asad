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
 */
export function addSafeChunks(
  chunks: InterpretationChunk[],
  drafts: ChunkDraft[],
  now: number,
): AddSafeResult {
  const base = chunks.filter((c) => c.state !== "anticipated");
  const recent = base.slice(-DUPLICATE_WINDOW).map((c) => normalise(c.text));
  const added: InterpretationChunk[] = [];

  for (const draft of drafts) {
    const text = draft.text.trim();
    if (!text) continue;
    const key = normalise(text);
    if (!key || recent.includes(key)) continue;
    recent.push(key);

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
