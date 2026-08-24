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
import { cn } from "@/lib/cn";

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
      className="flex shrink-0 items-center gap-2 border-t border-[var(--line)] bg-[var(--bg-raised)] px-2 py-2 sm:px-4"
      style={{ paddingBottom: "calc(0.5rem + var(--safe-bottom))" }}
    >
      <Button
        onClick={onToggleFreeze}
        size="lg"
        tone={frozen ? "primary" : "neutral"}
        className="flex-1 max-w-[22rem] font-semibold tracking-wide"
        title="Freeze the display — processing continues (Space)"
      >
        {frozen ? "FROZEN — TAP TO RESUME" : "FREEZE"}
      </Button>

      {!atLive && !frozen && (
        <Button onClick={onReturnToLive} size="lg" tone="neutral" title="Jump back to live (F)">
          ↓ Live
        </Button>
      )}

      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          tone="quiet"
          active={view === "teleprompter"}
          onClick={onToggleView}
          title="Teleprompter view (T)"
          ariaLabel="Toggle teleprompter view"
        >
          T
        </Button>
        <Button
          size="sm"
          tone="quiet"
          active={showKorean}
          onClick={onToggleKorean}
          title="Show or hide Korean (K)"
          ariaLabel="Toggle Korean transcript"
        >
          <span className="font-korean">한</span>
        </Button>
        <Button
          size="sm"
          tone="quiet"
          active={showGlossary}
          onClick={onToggleGlossary}
          title="Show or hide the glossary (G)"
          ariaLabel="Toggle glossary"
        >
          G
        </Button>
        <div className="ml-1 flex items-center gap-0.5 rounded-md border border-[var(--line-strong)]">
          <Button size="sm" tone="quiet" onClick={() => onFontScale(-0.1)} ariaLabel="Smaller text">
            <span className={cn("text-xs")}>A−</span>
          </Button>
          <Button size="sm" tone="quiet" onClick={() => onFontScale(0.1)} ariaLabel="Larger text">
            <span className="text-base">A+</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
