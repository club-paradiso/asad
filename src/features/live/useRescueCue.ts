"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Confidence, InterpretationMode, PrepSheet } from "@/types";
import type { EngineSnapshot } from "@/interpreter/engine/session";
import { buildRescueRequest, requestRescue } from "./rescue-client";

export type RescueCuePhase = "idle" | "loading" | "showing" | "unavailable";

export interface RescueCueState {
  phase: RescueCuePhase;
  chunks: string[];
  confidence?: Confidence;
  provider?: string;
  model?: string;
  reason?: string;
}

export interface UseRescueCueOptions {
  enabled?: boolean;
  snapshot: EngineSnapshot;
  mode: InterpretationMode;
  prep: PrepSheet;
  /** Epoch milliseconds captured when the live session started. */
  startedAt: number | null;
  /** How long a successful recovery cue remains visible. */
  visibleMs?: number;
}

const IDLE: RescueCueState = { phase: "idle", chunks: [] };
const DEFAULT_VISIBLE_MS = 7_000;
const UNAVAILABLE_VISIBLE_MS = 2_500;

/**
 * Transient Rescue state for the live booth.
 *
 * The normal interpretation engine remains read-only from here. Repeated Rescue
 * taps cancel only the previous Rescue request, stale responses are ignored,
 * and every cue clears itself so an emergency bridge cannot become old advice
 * sitting beside newer interpretation output.
 */
export function useRescueCue(options: UseRescueCueOptions) {
  const [state, setState] = useState<RescueCueState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = null;
  }, []);

  const clear = useCallback(() => {
    clearTimer();
    setState(IDLE);
  }, [clearTimer]);

  const scheduleClear = useCallback(
    (delayMs: number) => {
      clearTimer();
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null;
        setState(IDLE);
      }, delayMs);
    },
    [clearTimer],
  );

  const trigger = useCallback(async (): Promise<boolean> => {
    if (options.enabled === false || options.startedAt === null) return false;

    const elapsedMs = Math.max(0, Date.now() - options.startedAt);
    const request = buildRescueRequest({
      snapshot: options.snapshot,
      mode: options.mode,
      prep: options.prep,
      elapsedMs,
    });

    if (!request) {
      abortRef.current?.abort();
      abortRef.current = null;
      generationRef.current += 1;
      setState({
        phase: "unavailable",
        chunks: [],
        reason: "No recent stable Korean is available to rescue.",
      });
      scheduleClear(UNAVAILABLE_VISIBLE_MS);
      return false;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    clearTimer();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setState({ phase: "loading", chunks: [] });

    try {
      const result = await requestRescue(request, controller.signal);
      if (controller.signal.aborted || generation !== generationRef.current) return false;

      const chunks = result.output.safeChunks
        .map((chunk) => chunk.text.trim())
        .filter(Boolean)
        .slice(0, 2);

      if (chunks.length === 0) {
        setState({
          phase: "unavailable",
          chunks: [],
          provider: result.provider,
          model: result.model,
          reason: result.reason || "Rescue found no safe bridge into the current idea.",
        });
        scheduleClear(UNAVAILABLE_VISIBLE_MS);
        return false;
      }

      setState({
        phase: "showing",
        chunks,
        confidence: result.output.confidence,
        provider: result.provider,
        model: result.model,
        reason: result.reason,
      });
      scheduleClear(Math.max(2_000, options.visibleMs ?? DEFAULT_VISIBLE_MS));
      return true;
    } catch (error) {
      if (controller.signal.aborted || generation !== generationRef.current) return false;
      setState({
        phase: "unavailable",
        chunks: [],
        reason: error instanceof Error ? error.message : "Rescue is unavailable.",
      });
      scheduleClear(UNAVAILABLE_VISIBLE_MS);
      return false;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [clearTimer, options, scheduleClear]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    },
    [],
  );

  return { state, trigger, clear };
}
