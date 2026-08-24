"use client";

/**
 * The control bar.
 *
 * FREEZE dominates, because it is the only control an interpreter reaches for
 * mid-sentence — when they need the screen to stop moving so they can finish
 * the thought they are already speaking. It is a large target, reachable
 * one-handed at the bottom of an iPhone in landscape, and it is the only
 * button here that changes colour.
 *
 * Everything else is a small toggle. "Follow live" only exists when it has
 * something to do.
 */
import type { ConsoleView } from "@/types";
import { Button } from "@/components/ui/primitives";

export function ControlBar({
  frozen,
  onToggleFreeze,
  atLive,
  onReturnToLive,
  view,
  onToggleView,
  showKorean,
  onToggleKorean,
  showGlossary,
  onToggleGlossary,
  onFontScale,
}: {
  frozen: boolean;
  onToggleFreeze: () => void;
  atLive: boolean;
  onReturnToLive: () => void;
  view: ConsoleView;
  onToggleView: () => void;
  showKorean: boolean;
  onToggleKorean: () => void;
  showGlossary: boolean;
  onToggleGlossary: () => void;
  onFontScale: (delta: number) => void;
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
        className="h-12 min-h-0 flex-1 max-w-[22rem] font-semibold tracking-wide tall:h-14"
        title="Freeze the display — processing continues (Space)"
      >
        {frozen ? "FROZEN — TAP TO RESUME" : "FREEZE"}
      </Button>

      {!atLive && !frozen && (
        <Button
          onClick={onReturnToLive}
          size="lg"
          tone="neutral"
          className="h-12 min-h-0 tall:h-14"
          title="Jump back to live (F)"
        >
          ↓ Live
        </Button>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        <Button
          size="md"
          tone="quiet"
          className="min-w-11 px-2"
          active={view === "teleprompter"}
          onClick={onToggleView}
          title="Teleprompter view (T)"
          ariaLabel="Toggle teleprompter view"
        >
          T
        </Button>
        <Button
          size="md"
          tone="quiet"
          className="min-w-11 px-2"
          active={showKorean}
          onClick={onToggleKorean}
          title="Show or hide Korean (K)"
          ariaLabel="Toggle Korean transcript"
        >
          <span className="font-korean">한</span>
        </Button>
        <Button
          size="md"
          tone="quiet"
          className="min-w-11 px-2"
          active={showGlossary}
          onClick={onToggleGlossary}
          title="Show or hide the glossary (G)"
          ariaLabel="Toggle glossary"
        >
          G
        </Button>
        <div className="ml-1 flex items-center rounded-md border border-[var(--line-strong)]">
          <Button
            size="md"
            tone="quiet"
            className="min-w-11 px-2"
            onClick={() => onFontScale(-0.1)}
            ariaLabel="Smaller text"
          >
            <span className="text-xs">A−</span>
          </Button>
          <Button
            size="md"
            tone="quiet"
            className="min-w-11 px-2"
            onClick={() => onFontScale(0.1)}
            ariaLabel="Larger text"
          >
            <span className="text-base">A+</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
