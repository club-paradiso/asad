"use client";

/**
 * The control bar.
 *
 * Two buttons, and only because both answer "the screen is doing the wrong
 * thing and I am in the middle of a sentence":
 *
 *   FREEZE       stop the display moving so a thought can be finished.
 *   ↓ Live       get back to the live position after scrolling away.
 *
 * Everything that used to sit here — teleprompter, Korean, glossary, A−/A+ —
 * is decided before a service or not at all, and each one was ALSO in the
 * settings sheet, so the console carried two ways to do the same thing. On an
 * iPhone in portrait those five buttons squeezed FREEZE, the one control that
 * matters, down to about a third of the width. They now live in settings only;
 * the keyboard shortcuts (T / K / G / + / −) are unchanged, because a shortcut
 * costs no screen and a button costs it on every glance.
 *
 * "↓ Live" only exists when it has something to do.
 */
import { Button } from "@/components/ui/primitives";

export function ControlBar({
  frozen,
  onToggleFreeze,
  atLive,
  onReturnToLive,
}: {
  frozen: boolean;
  onToggleFreeze: () => void;
  atLive: boolean;
  onReturnToLive: () => void;
}) {
  return (
    <div
      className="rail-row flex shrink-0 items-center gap-2 border-t border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1.5 sm:px-4 tall:py-2"
      style={{ paddingBottom: "calc(0.375rem + var(--safe-bottom))" }}
    >
      {/* `size="md"`, not `lg`, and the height comes from `h-*`.
          These buttons used to ask for `lg` and then try to shrink with
          `min-h-0`, which never took: `cn` is a plain join, so the two
          min-height utilities both landed and Tailwind's own order decided —
          `min-h-14` won. The button was 56px tall on every screen however it
          was styled, which on a 390px-tall phone in landscape is twelve pixels
          of the English spent on a button nobody needed to be bigger. */}
      <Button
        onClick={onToggleFreeze}
        size="md"
        tone={frozen ? "primary" : "neutral"}
        className="h-11 flex-1 max-w-[26rem] tracking-wide sm:h-12 tall:h-14"
        title="Freeze the display — processing continues (Space)"
      >
        <span className="text-base font-semibold">
          {frozen ? "FROZEN — TAP TO RESUME" : "FREEZE"}
        </span>
      </Button>

      {!atLive && !frozen && (
        <Button
          onClick={onReturnToLive}
          size="md"
          tone="neutral"
          className="h-11 shrink-0 sm:h-12 tall:h-14"
          title="Jump back to live (F)"
        >
          <span className="text-base">↓ Live</span>
        </Button>
      )}
    </div>
  );
}
