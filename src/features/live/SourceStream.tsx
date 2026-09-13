"use client";

/**
 * The source-language channel.
 *
 * Secondary by design. The interpreter is already hearing the speaker — what
 * they need from the screen is a way to *check* a word they half-caught, not a
 * second thing to read.
 *
 * Partial and stable text are differentiated by colour and weight only. No
 * animation, no shimmer: a line that flickers in peripheral vision pulls a
 * fixation away from the translation, which is the one cost this console
 * cannot pay.
 *
 * Typography follows the language: Hangul gets the Korean stack and
 * `keep-all`; everything else gets the bilingual sans stack with `lang` and
 * `dir` set from the registry so the browser picks the right fonts, the right
 * line-breaking rules and the right direction. Spaceless scripts additionally
 * get `overflow-wrap: anywhere`, because a 40-character Thai clause with no
 * break opportunity is otherwise a horizontal scrollbar.
 *
 * A long press (≥450ms) or a double-click on a segment hands it to the
 * correction box.
 */
import { useEffect, useRef } from "react";
import type { PartialTranscript, TranscriptSegment } from "@/types";
import { resolveLanguage } from "@/languages/registry";
import { cn } from "@/lib/cn";

/** How long a finger has to stay down before it means "correct this". */
export const LONG_PRESS_MS = 450;
/** Movement beyond this cancels the press — the interpreter was scrolling. */
const LONG_PRESS_SLOP_PX = 12;

export function SourceStream({
  segments,
  partial,
  frozen,
  language,
  compact = false,
  onSelectText,
}: {
  segments: TranscriptSegment[];
  partial: PartialTranscript | null;
  frozen: boolean;
  /** Canonical registry id of the language being recognised. */
  language: string;
  compact?: boolean;
  /** Long-pressing or double-clicking recognised text opens the correction box. */
  onSelectText?: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const recent = compact ? segments.slice(-1) : segments.slice(-4);
  const definition = resolveLanguage(language);
  const korean = (definition?.base ?? "ko") === "ko";
  const spaceless = definition?.spacing === "none";

  useEffect(() => {
    if (frozen) return;
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [segments, partial, frozen]);

  const press = useLongPress(onSelectText);

  return (
    <div
      ref={ref}
      lang={definition?.id ?? language}
      dir={definition?.direction ?? "ltr"}
      className={cn(
        "scroll-y fade-top type-korean h-full overflow-x-hidden px-4 pt-2 pb-3 sm:px-8 lg:px-12",
        korean ? "font-korean" : "font-sans",
        spaceless && "source-text-spaceless",
        compact && "py-1",
      )}
      aria-label="Source transcript"
    >
      {recent.length === 0 && !partial ? (
        <p className="korean-partial">{korean ? "듣는 중…" : "Listening…"}</p>
      ) : (
        <div className="space-y-1">
          {recent.map((segment) => (
            <p
              key={segment.id}
              data-segment-id={segment.id}
              className={cn("korean-stable source-text", onSelectText && "cursor-text select-none")}
              onDoubleClick={() => onSelectText?.(segment.text)}
              {...(onSelectText ? press(segment.text) : {})}
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
          {partial && <p className="korean-partial source-text">{partial.text}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Pointer handlers for a long press. Returns a factory so each segment gets
 * its own text without a closure per render for every handler.
 */
function useLongPress(onFire?: (text: string) => void) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };

  useEffect(() => cancel, []);

  return (text: string) => ({
    onPointerDown: (event: React.PointerEvent) => {
      if (!onFire || event.button !== 0) return;
      cancel();
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        origin.current = null;
        onFire(text);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: React.PointerEvent) => {
      const start = origin.current;
      if (!start) return;
      if (
        Math.abs(event.clientX - start.x) > LONG_PRESS_SLOP_PX ||
        Math.abs(event.clientY - start.y) > LONG_PRESS_SLOP_PX
      ) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: React.MouseEvent) => {
      // A long press on iOS also raises the context menu; the correction box
      // is what the press means here.
      if (timer.current !== null || origin.current !== null) event.preventDefault();
    },
  });
}
