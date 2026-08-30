"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/primitives";
import type { RescueCueState } from "./useRescueCue";

export interface RescueControlProps {
  state: RescueCueState;
  onTrigger: () => void;
  onClear: () => void;
  disabled?: boolean;
}

const isTypingTarget = (target: EventTarget | null) => {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  const tag = element.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable
  );
};

/**
 * Compact booth-facing Rescue control.
 *
 * `R` is intentionally ignored while the interpreter is typing in a form.
 * The transient result is visually separate from the ordinary English stream:
 * it is an emergency bridge, not a chunk to commit into session history.
 */
export function RescueControl({
  state,
  onTrigger,
  onClear,
  disabled = false,
}: RescueControlProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        disabled ||
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "r" ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      onTrigger();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled, onTrigger]);

  const visible = state.phase !== "idle";

  return (
    <section aria-label="Rescue" className="flex flex-col gap-2">
      <Button
        type="button"
        tone="neutral"
        size="sm"
        disabled={disabled || state.phase === "loading"}
        onClick={onTrigger}
        aria-keyshortcuts="R"
        className="min-w-24"
      >
        {state.phase === "loading" ? "Rescuing…" : "Rescue · R"}
      </Button>

      {visible && (
        <div
          role="status"
          aria-live="polite"
          className="max-w-xl rounded-lg border border-[var(--line-strong)] bg-[var(--bg-overlay)] px-4 py-3 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
                Rescue · catch up now
              </p>
              {state.phase === "loading" ? (
                <p className="mt-1 text-sm text-[var(--fg-muted)]">
                  Finding the shortest safe bridge into the current idea…
                </p>
              ) : state.phase === "showing" ? (
                <div className="mt-1 space-y-1">
                  {state.chunks.map((chunk, index) => (
                    <p
                      key={`${index}-${chunk}`}
                      className="text-base font-semibold leading-snug text-[var(--fg)]"
                    >
                      {chunk}
                    </p>
                  ))}
                  <p className="pt-1 text-xs text-[var(--fg-dim)]">
                    Recovery cue only · not added to the normal English stream
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-sm text-[var(--fg-muted)]">
                  {state.reason || "No safe Rescue cue is available right now."}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClear}
              aria-label="Dismiss Rescue cue"
              className="-mr-1 -mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-[var(--fg-dim)] hover:bg-[var(--bg-raised)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
