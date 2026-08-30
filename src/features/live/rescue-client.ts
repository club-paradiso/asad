import type { InterpretationMode, PrepSheet } from "@/types";
import type { EngineSnapshot } from "@/interpreter/engine/session";
import { rescueKoreanText } from "@/interpreter/engine/rescue";
import { buildRollingContext } from "@/interpreter/context/rolling";
import type { SessionMemory } from "@/interpreter/context/memory";
import { rescueRequestSchema, type RescueRequest } from "@/lib/rescue-schema";
import {
  interpreterOutputSchema,
  type ParsedInterpreterOutput,
} from "@/lib/schema";
import { guardedFetch } from "@/lib/session-client";

export interface RescueClientResult {
  output: ParsedInterpreterOutput;
  provider?: string;
  model?: string;
  degraded?: boolean;
  reason?: string;
  latencyMs?: number;
}

export interface BuildRescueRequestInput {
  snapshot: EngineSnapshot;
  mode: InterpretationMode;
  prep: PrepSheet;
  /** Milliseconds since the live session started. */
  elapsedMs: number;
}

/**
 * Convert the current read-only live snapshot into one bounded Rescue request.
 *
 * Nothing here mutates the interpretation engine. The ordinary pending queue,
 * committed chunks and STT stream remain completely independent.
 */
export function buildRescueRequest(input: BuildRescueRequestInput): RescueRequest | null {
  const recentKorean = rescueKoreanText(input.snapshot.segments, input.elapsedMs);
  if (!recentKorean) return null;

  // EngineSnapshot deliberately exposes exactly the session memory Rescue needs
  // without exposing private engine internals. Reconstructing SessionMemory here
  // lets Rescue reuse the same rolling-context policy as ordinary live turns.
  const memory: SessionMemory = {
    entities: input.snapshot.entities,
    glossary: input.snapshot.glossary,
    corrections: input.snapshot.corrections,
    scripture: input.snapshot.scripture.map((reference) => reference.display),
    topic: input.snapshot.topic,
  };

  const candidate = {
    mode: input.mode,
    recentKorean,
    context: buildRollingContext({
      segments: input.snapshot.segments,
      chunks: input.snapshot.chunks,
      memory,
      mode: input.mode,
      prep: input.prep,
    }),
  };

  const parsed = rescueRequestSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Validate a server response before a recovery cue is ever shown to a human. */
export function parseRescueResponse(value: unknown): RescueClientResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const output = interpreterOutputSchema.safeParse(record.output);
  if (!output.success) return null;

  return {
    output: output.data,
    provider: typeof record.provider === "string" ? record.provider : undefined,
    model: typeof record.model === "string" ? record.model : undefined,
    degraded: typeof record.degraded === "boolean" ? record.degraded : undefined,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    latencyMs: typeof record.latencyMs === "number" ? record.latencyMs : undefined,
  };
}

/**
 * Execute one isolated Rescue request.
 *
 * A caller supplies its own AbortSignal so the future transient UI can cancel
 * a stale cue without touching the normal live interpretation request.
 */
export async function requestRescue(
  request: RescueRequest,
  signal: AbortSignal,
): Promise<RescueClientResult> {
  const response = await guardedFetch("/api/rescue", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "Rescue is being rate limited."
        : `Rescue request failed (${response.status}).`,
    );
  }

  const parsed = parseRescueResponse(await response.json());
  if (!parsed) throw new Error("Rescue response failed validation.");
  return parsed;
}
