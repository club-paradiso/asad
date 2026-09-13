"use client";

/**
 * Tap-to-correct.
 *
 * The interpreter overruling the recogniser on a name or a term, without
 * leaving the console. It is anchored at the bottom of the source pane and
 * capped at ~40% of a phone screen, so the translation stays readable above
 * it: a correction is made BETWEEN sentences, and the next sentence must still
 * be visible while the box is open.
 *
 * Modal while open — focus is trapped, Escape cancels, hotkeys are switched
 * off by the console — because a half-typed correction that the T key turns
 * into a teleprompter is worse than no correction box at all.
 */
import { useEffect, useId, useRef, useState } from "react";
import { romaniseName } from "@/lib/romanise";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

export interface CorrectionSubmission {
  from: string;
  to: string;
  english?: string;
  remember: boolean;
}

const FOCUSABLE =
  'input:not([disabled]), button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function CorrectionPopover({
  open,
  heard,
  defaultRemember,
  sourceIsKorean = true,
  onApply,
  onCancel,
  className,
}: {
  open: boolean;
  /** The recognised text the interpreter long-pressed. Editable. */
  heard: string;
  /** Seeds the "remember" checkbox; the interpreter can flip it per correction. */
  defaultRemember: boolean;
  /** Romanisation suggestions only make sense for Hangul. */
  sourceIsKorean?: boolean;
  onApply: (correction: CorrectionSubmission) => void;
  onCancel: () => void;
  className?: string;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const [from, setFrom] = useState(heard);
  const [to, setTo] = useState("");
  const [english, setEnglish] = useState("");
  const [remember, setRemember] = useState(defaultRemember);

  // Re-seed each time the box opens on a new segment.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = open ? heard : null;
  if (seededFor !== seedKey) {
    setSeededFor(seedKey);
    setFrom(heard);
    setTo("");
    setEnglish("");
    setRemember(defaultRemember);
  }

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    toRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Capture phase, so the console's own Escape/hotkey handlers never see it.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previouslyFocused?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  const trimmedFrom = from.trim();
  const trimmedTo = to.trim();
  const ready = trimmedFrom.length > 0 && trimmedTo.length > 0 && trimmedFrom !== trimmedTo;
  const suggestedEnglish = sourceIsKorean && trimmedTo ? romaniseName(trimmedTo) : "";

  const submit = () => {
    if (!ready) return;
    const chosenEnglish = english.trim() || suggestedEnglish;
    onApply({
      from: trimmedFrom,
      to: trimmedTo,
      english: chosenEnglish || undefined,
      remember,
    });
  };

  const inputClass =
    "min-h-11 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--bg)] px-3 text-sm text-[var(--fg)] outline-none placeholder:text-[var(--fg-dim)] focus-visible:border-[var(--accent)]";

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      className={cn(
        "scroll-y rounded-t-2xl border border-[var(--line-strong)] bg-[var(--bg-overlay)] shadow-2xl",
        // Capped as a fraction of the viewport: the translation above must
        // keep at least 60% of a phone screen.
        "max-h-[min(40dvh,22rem)] px-3 pt-3 sm:px-4",
        className,
      )}
      style={{ paddingBottom: "calc(0.75rem + var(--safe-bottom))" }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id={`${id}-title`} className="text-[0.7rem] font-semibold uppercase tracking-wider text-[var(--fg-dim)]">
            Correct a name or term
          </h2>
          <span className="text-[0.7rem] text-[var(--fg-dim)]">Esc to cancel</span>
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[0.7rem] text-[var(--fg-dim)]">Heard</span>
            <input
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              aria-label="Heard"
              className={cn(inputClass, sourceIsKorean && "font-korean")}
            />
          </label>
          <span aria-hidden className="hidden pb-3 text-[var(--fg-dim)] sm:block">
            →
          </span>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[0.7rem] text-[var(--fg-dim)]">Correct to</span>
            <input
              ref={toRef}
              value={to}
              onChange={(event) => setTo(event.target.value)}
              aria-label="Correct to"
              placeholder={sourceIsKorean ? "류정길" : undefined}
              className={cn(inputClass, sourceIsKorean && "font-korean")}
            />
          </label>
        </div>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[0.7rem] text-[var(--fg-dim)]">
            Translation / spoken form
            {suggestedEnglish && !english.trim() && (
              <span className="ml-1.5 text-[var(--fg-muted)]">· suggested: {suggestedEnglish}</span>
            )}
          </span>
          <input
            value={english}
            onChange={(event) => setEnglish(event.target.value)}
            aria-label="Translation"
            placeholder={suggestedEnglish || "optional"}
            className={inputClass}
          />
        </label>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
          <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 text-xs text-[var(--fg-muted)]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            다음 세션에도 기억
          </label>
          <Button size="md" tone="quiet" onClick={onCancel} className="min-w-20">
            Cancel
          </Button>
          <Button size="md" tone="primary" type="submit" disabled={!ready} className="min-w-24">
            Apply
          </Button>
        </div>
      </form>
    </div>
  );
}
