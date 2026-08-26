"use client";

/**
 * The Korean channel.
 *
 * Secondary by design. The interpreter is already hearing the Korean — what
 * they need from the screen is a way to *check* a word they half-caught, not a
 * second thing to read.
 *
 * Partial and stable text are differentiated by colour and weight only. No
 * animation, no shimmer: a line that flickers in peripheral vision pulls a
 * fixation away from the English, which is the one cost this console cannot
 * pay.
 */
import { useEffect, useRef } from "react";
import type { PartialTranscript, TranscriptSegment } from "@/types";
import { cn } from "@/lib/cn";

export function KoreanStream({
  segments,
  partial,
  frozen,
  compact = false,
  onSelectText,
}: {
  segments: TranscriptSegment[];
  partial: PartialTranscript | null;
  frozen: boolean;
  compact?: boolean;
  /** Selecting recognised Korean opens the correction box. */
  onSelectText?: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const recent = compact ? segments.slice(-1) : segments.slice(-4);

  useEffect(() => {
    if (frozen) return;
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [segments, partial, frozen]);

  return (
    <div
      ref={ref}
      className={cn(
        "scroll-y fade-top font-korean type-korean h-full overflow-x-hidden px-4 pt-2 pb-3 sm:px-8 lg:px-12",
        compact && "py-1",
      )}
      aria-label="Korean transcript"
    >
      {recent.length === 0 && !partial ? (
        <p className="korean-partial">듣는 중…</p>
      ) : (
        <div className="space-y-1">
          {recent.map((segment) => (
            <p
              key={segment.id}
              className={cn("korean-stable", onSelectText && "cursor-text")}
              onDoubleClick={() => onSelectText?.(segment.text)}
              title={segment.corrected ? `Corrected from: ${segment.originalText}` : undefined}
            >
              {segment.corrected && (
                <span className="mr-1.5 text-[0.7em] text-[var(--warn)]" title="You corrected this">
                  ✎
                </span>
              )}
              {segment.text}
            </p>
          ))}
          {partial && <p className="korean-partial">{partial.text}</p>}
        </div>
      )}
    </div>
  );
}
