"use client";

/**
 * Demo mode annotation.
 *
 * Names the interpretation problem each scripted beat is exercising, so a demo
 * is legible to someone who does not read Korean.
 *
 * It is a row in the console grid rather than an overlay, because an overlay
 * would sit on top of the English — and the one thing this app must never do
 * is put something in front of the line the interpreter is reading.
 */
import type { DemoBeat } from "@/demo/types";

export function DemoRibbon({ beat }: { beat: DemoBeat }) {
  return (
    <div
      className="flex h-7 shrink-0 items-center gap-2 overflow-hidden border-b border-[var(--line)] bg-[var(--bg-overlay)] px-3 sm:px-4"
      aria-hidden
    >
      <span className="type-label shrink-0 text-[var(--info)]">demo · showing</span>
      <span className="truncate text-[0.75rem] text-[var(--fg-muted)]">{beat.demonstrates}</span>
    </div>
  );
}
