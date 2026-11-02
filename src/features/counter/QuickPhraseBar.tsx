"use client";

/**
 * Quick phrases — the zero-error path.
 *
 * These do not call a model. The sender's own wording and the recipient's
 * wording are both pre-written, so the phrases a counter repeats forty times a
 * day cannot be mistranslated, cannot be slow, and cannot come out differently
 * on the fortieth try than on the first.
 *
 * Collapsed by default on phones, where the bar would otherwise eat a third of
 * a portrait screen. Open by default on a desk-sized screen: there the phrases
 * are the fastest thing staff can press, and hiding them behind a toggle made
 * the zero-latency path the slowest one to reach.
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import type { Participant } from "@/counter/types";
import { phrasesFor, phraseText } from "@/counter/quick-phrases";
import { findLanguage } from "@/counter/languages";
import type { CounterStrings } from "@/counter/ui-strings";
import { cn } from "@/lib/cn";

const WIDE_QUERY = "(min-width: 768px) and (min-height: 600px)";
const readWide = () =>
  typeof window !== "undefined" && !!window.matchMedia?.(WIDE_QUERY).matches;
const subscribeWide = (onChange: () => void) => {
  const query = typeof window !== "undefined" ? window.matchMedia?.(WIDE_QUERY) : undefined;
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
};

export function QuickPhraseBar({
  role,
  lang,
  strings,
  onSend,
  disabled = false,
}: {
  role: Participant;
  lang: string;
  strings: CounterStrings;
  /** Sends the phrase *id*; the server resolves both sides from the table. */
  onSend: (id: string) => void;
  disabled?: boolean;
}) {
  const wide = useSyncExternalStore(subscribeWide, readWide, () => false);
  // null = the person has not touched the toggle yet: follow the screen size.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? wide;
  const setOpen = (next: boolean | ((value: boolean) => boolean)) =>
    setChosen(typeof next === "function" ? next(open) : next);
  const rtl = findLanguage(lang)?.rtl ?? false;

  const phrases = useMemo(
    () =>
      phrasesFor(role)
        .map((phrase) => ({ id: phrase.id, label: phraseText(phrase, lang) }))
        .filter((entry): entry is { id: string; label: string } => !!entry.label),
    [role, lang],
  );

  if (phrases.length === 0) return null;

  return (
    <div className="border-t border-[var(--line)] bg-[var(--bg)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="mx-auto flex min-h-10 w-full max-w-3xl items-center justify-between px-4 py-2 text-sm text-[var(--fg-muted)]"
      >
        <span>{strings.quickPhrases}</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="scroll-y max-h-40 px-3 pb-2.5 sm:px-5">
          <div className="mx-auto flex max-w-3xl flex-wrap gap-2" dir={rtl ? "rtl" : undefined}>
            {phrases.map((phrase) => (
              <button
                key={phrase.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onSend(phrase.id);
                  // On a desk the bar stays put for the next phrase.
                  if (!wide) setOpen(false);
                }}
                lang={lang}
                className={cn(
                  "rounded-full border border-[var(--line-strong)] bg-[var(--bg-raised)]",
                  "min-h-10 px-3.5 py-2 text-sm text-[var(--fg)] transition-colors",
                  "hover:border-[var(--accent)] disabled:pointer-events-none disabled:opacity-40",
                )}
              >
                {phrase.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
