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
      className="flex shrink-0 items-center gap-2 border-t border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1.5 sm:px-4 tall:py-2"
      style={{ paddingBottom: "calc(0.375rem + var(--safe-bottom))" }}
    >
      <Button
        onClick={onToggleFreeze}
        size="lg"
        tone={frozen ? "primary" : "neutral"}
        // Shorter on a phone in landscape, where every pixel of height is
        // competing with the English.
        className="h-12 min-h-0 flex-1 max-w-[26rem] font-semibold tracking-wide tall:h-14"
        title="Freeze the display — processing continues (Space)"
      >
        {frozen ? "FROZEN — TAP TO RESUME" : "FREEZE"}
      </Button>

      {!atLive && !frozen && (
        <Button
          onClick={onReturnToLive}
          size="lg"
          tone="neutral"
          className="h-12 min-h-0 shrink-0 tall:h-14"
          title="Jump back to live (F)"
        >
          ↓ Live
        </Button>
      )}
    </div>
  );
}
