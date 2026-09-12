"use client";

/**
 * Focus view.
 *
 * The console minus its history. One line the interpreter is saying, whatever
 * is predicted after it, and — if they want it — one line of Korean to check
 * against. No scrollback, no context rail, nothing to scroll.
 *
 * That is a different job from the console, not a larger font: the console is
 * for a service you can follow, this is for the passage you cannot — fast
 * delivery, dense theology, a preacher who does not pause — where looking away
 * from the current line costs you the next one.
 *
 * The CURRENT and NEXT captions are gone. Size, contrast and the ◦ marker
 * already say which line is which, and they say it without being read; a label
 * in a view whose entire purpose is having less to look at was the one thing
 * on screen that could not be spoken aloud.
 */
import type { InterpretationChunk, PartialTranscript, TranscriptSegment } from "@/types";
import { cn } from "@/lib/cn";

export function Teleprompter({
  chunks,
  segments,
  partial,
  showKorean,
}: {
  chunks: InterpretationChunk[];
  segments: TranscriptSegment[];
  partial: PartialTranscript | null;
  showKorean: boolean;
}) {
  const spoken = chunks.filter((c) => c.state !== "anticipated");
  const current = spoken[spoken.length - 1];
  const previous = spoken[spoken.length - 2];
  const upcoming = chunks.filter((c) => c.state === "anticipated");

  const lastKorean = segments[segments.length - 1]?.text;

  return (
    <div className="flex h-full flex-col justify-center gap-5 px-4 sm:px-10">
      {previous && (
        <p className="chunk-committed type-english opacity-30 line-clamp-1">{previous.text}</p>
      )}

      <div>
        <p
          className={cn(
            "type-english chunk-current",
            // The current line gets a size boost here — there is nothing else
            // on screen to balance against.
            "text-[calc(var(--english-size)*var(--font-scale)*1.18)]",
          )}
          data-provisional={current?.provisional && current.state === "current" ? "true" : undefined}
        >
          {current?.provisional && current.state === "current" && (
            <span
              aria-hidden
              className="mr-2 align-middle text-[0.4em] text-[var(--fg-dim)]"
              title="Provisional on-device English — may still be refined"
            >
              ≈
            </span>
          )}
          {current?.text ?? "…"}
          {current?.confidence === "low" && (
            <span
              className="ml-2 align-super text-[0.4em] text-[var(--warn)]"
              title="Low confidence — verify before committing to it"
            >
              ?
            </span>
          )}
        </p>
        {current?.adapted && (
          <p className="mt-1.5 text-xs text-[var(--accent)]">
            adapted{current.note ? ` — ${current.note}` : ""}
          </p>
        )}
      </div>

      {/* The row keeps its height whether or not there is a prediction, so the
          current line does not jump under the interpreter's eye when one
          arrives. Empty, it is simply empty — a placeholder dash was a thing to
          look at that meant nothing. */}
      <div className="min-h-[3.5rem]" aria-hidden={upcoming.length === 0}>
        {upcoming.length > 0 && (
          <div className="space-y-1">
            {upcoming.map((chunk) => (
              <p key={chunk.id} className="type-english chunk-anticipated opacity-55">
                <span
                  aria-hidden
                  className="mr-2 text-[0.55em] text-[var(--fg-dim)]"
                  title="Predicted — not yet said"
                >
                  ◦
                </span>
                {chunk.text}
              </p>
            ))}
          </div>
        )}
      </div>

      {showKorean && lastKorean && (
        <p className="font-korean type-korean korean-partial line-clamp-1 border-t border-[var(--line)] pt-3">
          {partial?.text ?? lastKorean}
        </p>
      )}
    </div>
  );
}
