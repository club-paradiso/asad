"use client";

/**
 * Teleprompter view.
 *
 * The most distraction-free surface in the app: one line the interpreter is
 * saying, one line of what is coming, and nothing else competing. Korean is
 * reduced to a single checkable line, or hidden entirely.
 *
 * This is the view for the hardest passages — fast delivery, dense theology,
 * a preacher who does not pause.
 */
import type { InterpretationChunk, PartialTranscript, TranscriptSegment } from "@/types";
import { cn } from "@/lib/cn";
import { Label } from "@/components/ui/primitives";

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
        <Label className="mb-1.5 block text-[var(--accent)]">current</Label>
        <p
          className={cn(
            "type-english chunk-current",
            // The current line gets a size boost here — there is nothing else
            // on screen to balance against.
            "text-[calc(var(--english-size)*var(--font-scale)*1.18)]",
          )}
        >
          {current?.text ?? "…"}
          {current?.confidence === "low" && (
            <span className="ml-2 align-super text-[0.4em] text-[var(--warn)]">?</span>
          )}
        </p>
        {current?.adapted && (
          <p className="mt-1.5 text-xs text-[var(--accent)]">
            adapted{current.note ? ` — ${current.note}` : ""}
          </p>
        )}
      </div>

      <div className="min-h-[3.5rem]">
        <Label className="mb-1.5 block">next</Label>
        {upcoming.length > 0 ? (
          <div className="space-y-1">
            {upcoming.map((chunk) => (
              <p key={chunk.id} className="type-english chunk-anticipated opacity-55">
                <span aria-hidden className="mr-2 text-[0.55em] text-[var(--fg-dim)]">
                  ◦
                </span>
                {chunk.text}
              </p>
            ))}
          </div>
        ) : (
          <p className="type-english opacity-15">—</p>
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
