"use client";

/**
 * The language pair picker — the first and usually the only decision on the
 * launcher.
 *
 * Two selects and a swap. Both selects carry a VISIBLE label, because "which
 * side is which" is the whole question and an icon between two identical
 * dropdowns does not answer it. The swap button is a 44px target: on a phone
 * it is the control most likely to be pressed in a hurry when the speaker
 * turns out to be answering rather than asking.
 *
 * Source and target can never be the same language. A collision swaps the
 * sides rather than silently overriding one of them, and everything that
 * leaves this component has been through `canonicalPair`, so a consumer only
 * ever sees registry ids.
 */
import { useId } from "react";
import { LANGUAGES, canonicalPair, type LanguagePairIds } from "@/languages/registry";
import { cn } from "@/lib/cn";

const optionLabel = (language: (typeof LANGUAGES)[number]) =>
  language.name.ko === language.name.native
    ? language.name.ko
    : `${language.name.ko} · ${language.name.native}`;

export function LanguagePairPicker({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: LanguagePairIds;
  onChange: (pair: LanguagePairIds) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const pair = canonicalPair(value);

  const choose = (side: "source" | "target", next: string) => {
    const other = side === "source" ? pair.target : pair.source;
    // Picking the language already on the other side means "turn it around".
    if (next === other) {
      onChange(canonicalPair({ source: pair.target, target: pair.source }));
      return;
    }
    onChange(
      canonicalPair(
        side === "source" ? { source: next, target: pair.target } : { source: pair.source, target: next },
      ),
    );
  };

  const swap = () => onChange(canonicalPair({ source: pair.target, target: pair.source }));

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2 sm:gap-3",
        className,
      )}
      role="group"
      aria-label="언어 쌍"
    >
      <LanguageSelect
        id={`${id}-source`}
        label="말하는 언어"
        value={pair.source}
        disabled={disabled}
        onChange={(next) => choose("source", next)}
      />

      <button
        type="button"
        onClick={swap}
        disabled={disabled}
        aria-label="언어 방향 바꾸기"
        title="언어 방향 바꾸기"
        className="mb-px grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--line-strong)] bg-[var(--bg-raised)] text-lg text-[var(--fg)] shadow-sm transition-[background-color,border-color,transform] hover:bg-[var(--accent-dim)] active:scale-[0.96] disabled:opacity-40"
      >
        <span aria-hidden>⇄</span>
      </button>

      <LanguageSelect
        id={`${id}-target`}
        label="통역할 언어"
        value={pair.target}
        disabled={disabled}
        onChange={(next) => choose("target", next)}
      />
    </div>
  );
}

function LanguageSelect({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="brand-caption">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-11 w-full appearance-none truncate rounded-xl border border-[var(--line-strong)] bg-[var(--bg-raised)] py-2.5 pl-3 pr-9 text-sm font-semibold text-[var(--fg)] shadow-sm outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-dim)] disabled:opacity-40"
        >
          {LANGUAGES.map((language) => (
            <option key={language.id} value={language.id}>
              {optionLabel(language)}
            </option>
          ))}
        </select>
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          fill="none"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fg-dim)]"
        >
          <path
            d="m6.5 8 3.5 3.5L13.5 8"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
