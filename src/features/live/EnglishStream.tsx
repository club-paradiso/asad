"use client";

/**
 * The English stream — the dominant element on the console.
 *
 * Everything about this component is subordinated to one question: can the
 * interpreter absorb the current line in a single glance while listening to
 * Korean and speaking English?
 *
 * So: no bubbles, no timestamps in the reading path, no per-chunk chrome. Just
 * large text, a marker in the margin for the line that is live, and a visually
 * unmistakable treatment for anything predicted rather than confirmed.
 */
import { forwardRef } from "react";
import type { InterpretationChunk } from "@/types";
import { cn } from "@/lib/cn";

interface ChunkLineProps {
  chunk: InterpretationChunk;
  isActive: boolean;
}

const ChunkLine = forwardRef<HTMLDivElement, ChunkLineProps>(function ChunkLine(
  { chunk, isActive },
  ref,
) {
  const anticipated = chunk.state === "anticipated";
  const correction = !!chunk.correctsChunkId;

  return (
    <div
      ref={ref}
      data-chunk-state={chunk.state}
      className={cn(
        "relative pl-4 py-1.5 chunk-enter",
        anticipated
          ? "chunk-anticipated"
          : isActive
            ? "chunk-current"
            : "chunk-committed",
      )}
    >
      {(isActive || anticipated || correction) && (
        <span
          aria-hidden
          className={cn(
            "chunk-rule",
            correction
              ? "chunk-rule-correction"
              : anticipated
                ? "chunk-rule-anticipated"
                : "chunk-rule-current",
          )}
        />
      )}

      <p className="type-english">
        {anticipated && (
          <span
            className="mr-2 align-middle text-[0.55em] text-[var(--fg-dim)]"
            title="Predicted — not yet said"
          >
            ◦
          </span>
        )}
        {correction && (
          <span
            className="mr-2 align-middle text-[0.5em] text-[var(--warn)]"
            title="Correction to an earlier line"
          >
            ↺
          </span>
        )}
        {chunk.text}
        {chunk.confidence === "low" && !anticipated && (
          <span
            className="ml-2 align-super text-[0.42em] text-[var(--warn)]"
            title="Low confidence — verify before committing to it"
          >
            ?
          </span>
        )}
      </p>

      {/* An adapted line is not a translation of the words. The interpreter has
          to be able to see that instantly, so it is marked in the margin of the
          reading path rather than buried in a side panel. */}
      {(chunk.adapted || chunk.note) && (
        <p className="mt-1 flex items-center gap-1.5 text-[0.72rem] leading-tight text-[var(--fg-dim)]">
          {chunk.adapted && (
            <span
              className="rounded-sm border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] px-1 py-px text-[0.6rem] font-semibold uppercase tracking-wider text-[var(--accent)]"
              title="Adapted, not literal"
            >
              adapted
            </span>
          )}
          {chunk.note && <span>{chunk.note}</span>}
        </p>
      )}
    </div>
  );
});

export function EnglishStream({
  chunks,
  activeId,
  containerRef,
  activeRef,
  emptyMessage,
}: {
  chunks: InterpretationChunk[];
  activeId?: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  activeRef: React.MutableRefObject<HTMLElement | null>;
  emptyMessage?: string;
}) {
  return (
    <div
      ref={containerRef}
      className="scroll-y h-full px-4 sm:px-8 lg:px-12"
      // `container-type: size` (not Tailwind's inline-size `@container`, which
      // only exposes cqw) so the tail spacer below can be a fraction of THIS
      // region — what is left after the Korean panel and context rail have
      // taken their share — rather than of the whole viewport.
      style={{ containerType: "size" }}
      aria-live="polite"
      aria-atomic="false"
      aria-label="Interpreter-ready English"
    >
      {chunks.length === 0 ? (
        <div className="flex h-full items-center justify-center px-6 text-center">
          <p className="max-w-md text-sm leading-relaxed text-[var(--fg-dim)]">
            {emptyMessage ?? "English assistance will appear here as the speaker begins."}
          </p>
        </div>
      ) : (
        // The flex column with `justify-end` parks a short stream directly on
        // top of the tail spacer, which puts the newest line at the same 45%
        // reading anchor the auto-scroll uses once the stream is long enough to
        // scroll. Without it the first few lines of a session sit at the top of
        // the screen and then jump down.
        // `max-w` caps the measure. A 1,100-pixel line of 46px type is slower
        // to read than two shorter ones, and the interpreter is reading it
        // peripherally with about a second to spare.
        <div className="flex min-h-full max-w-[48rem] flex-col justify-end xl:max-w-[56rem]">
          {chunks.map((chunk) => (
            <ChunkLine
              key={chunk.id}
              chunk={chunk}
              isActive={chunk.id === activeId}
              ref={
                chunk.id === activeId
                  ? (node) => {
                      activeRef.current = node;
                    }
                  : undefined
              }
            />
          ))}
          {/* Reserves the lower portion so the active line never sits at the
              bottom edge — the interpreter needs to see what is coming next. */}
          <div aria-hidden className="h-[46cqh] shrink-0" />
        </div>
      )}
    </div>
  );
}
