"use client";

/**
 * The source channel — what the speaker actually said.
 *
 * Secondary by design. The interpreter is already hearing this — what they
 * need from the screen is a way to *check* a word they half-caught, not a
 * second thing to read.
 *
 * Partial and stable text are differentiated by colour and weight only. No
 * animation, no shimmer: a line that flickers in peripheral vision pulls a
 * fixation away from the target text, which is the one cost this console
 * cannot pay.
 *
 * `lang` and `dir` come from the registry rather than being assumed Korean, so
 * an Arabic or Urdu source reads right-to-left and a browser picks the right
 * font stack for the script.
 */
import { useEffect, useRef } from "react";
import type { PartialTranscript, TranscriptSegment } from "@/types";
import { cn } from "@/lib/cn";
import { findLanguage } from "@/lib/languages";

/** Shown before the first word arrives, in the language of the console chrome. */
const LISTENING = "듣는 중…";

export function SourceStream({
  segments,
  partial,
  frozen,
  language = "ko-KR",
  compact = false,
  onSelectText,
}: {
  segments: TranscriptSegment[];
  partial: PartialTranscript | null;
  frozen: boolean;
  /** BCP-47 tag of the spoken language. */
  language?: string;
  compact?: boolean;
  /** Selecting recognised source text opens the correction box. */
  onSelectText?: (text: string) => void;
}) {
  const definition = findLanguage(language);
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
      lang={definition?.id ?? language}
      dir={definition?.direction === "rtl" ? "rtl" : undefined}
      className={cn(
        "scroll-y fade-top type-korean h-full overflow-x-hidden px-4 pt-2 pb-3 sm:px-8 lg:px-12",
        definition?.base === "ko" && "font-korean",
        compact && "py-1",
      )}
      aria-label="Source transcript"
    >
      {recent.length === 0 && !partial ? (
        <p className="korean-partial">{LISTENING}</p>
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
