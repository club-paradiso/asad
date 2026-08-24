"use client";

/**
 * The live console's entire view of the AI layer: one word.
 *
 * LIVE / DEGRADED / LOCAL is all an interpreter can absorb mid-sentence, and
 * all they can act on. Provider names, latency percentiles and quota pressure
 * belong on /diagnostics, where someone has time to read them.
 */
import { cn } from "@/lib/cn";

export type AiState = "live" | "degraded" | "local" | "connecting";

const LABEL: Record<AiState, string> = {
  live: "LIVE",
  degraded: "DEGRADED",
  local: "LOCAL",
  connecting: "…",
};

const COLOUR: Record<AiState, string> = {
  live: "text-[var(--ok)]",
  degraded: "text-[var(--warn)]",
  local: "text-[var(--fg-muted)]",
  connecting: "text-[var(--fg-dim)]",
};

export function AiStatus({ state, title }: { state: AiState; title?: string }) {
  return (
    <span
      className="flex items-center gap-1"
      title={title ?? `AI: ${LABEL[state]}`}
      aria-label={`AI status: ${LABEL[state]}`}
    >
      <span className="text-[var(--fg-dim)]">AI</span>
      <span className={cn("font-semibold tracking-wide", COLOUR[state])}>{LABEL[state]}</span>
    </span>
  );
}

/** Derive the pill state from what the last interpretation turn reported. */
export function aiStateFrom(input: {
  llmHealth: "ok" | "degraded" | "down";
  lastProvider?: string;
  started: boolean;
}): AiState {
  if (!input.started) return "connecting";
  if (input.lastProvider === "local") return "local";
  if (input.llmHealth !== "ok") return "degraded";
  return "live";
}
