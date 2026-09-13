"use client";

/**
 * The language pair — the launcher's primary control.
 *
 * Two selects and an arrow, nothing else. Native `<select>` deliberately: on a
 * phone it opens the platform picker with its own search and inertia, it is
 * keyboard- and screen-reader-native, and a custom listbox of twenty-five
 * languages would be a worse version of something every OS already ships.
 *
 * Each option is labelled with the language's ENDONYM first. Someone looking
 * for their own language scans for the word they write it with, not for its
 * Korean or English name — a 中文 speaker should not have to decode 중국어
 * before they can find themselves in the list.
 */
import {
  LIVE_SOURCE_LANGUAGES,
  LIVE_TARGET_LANGUAGES,
  liveLanguagePairProblem,
  type LanguageDefinition,
} from "@/lib/languages";

const optionLabel = (language: LanguageDefinition): string =>
  language.endonym === language.en
    ? language.endonym
    : `${language.endonym} · ${language.en}`;

function LanguageSelect({
  id,
  label,
  value,
  options,
  onChange,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  options: LanguageDefinition[];
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="brand-caption">
        {label}
      </label>
      <select
        id={id}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-14 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--bg-raised)] px-3.5 text-base font-medium text-[var(--fg)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] aria-[invalid]:border-[var(--danger)]"
      >
        {options.map((language) => (
          <option key={language.id} value={language.id}>
            {optionLabel(language)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function LanguagePair({
  source,
  target,
  onSourceChange,
  onTargetChange,
  onSwap,
}: {
  source: string;
  target: string;
  onSourceChange: (value: string) => void;
  onTargetChange: (value: string) => void;
  onSwap?: () => void;
}) {
  const problem = liveLanguagePairProblem(source, target);

  return (
    <div className="flex items-end gap-2 sm:gap-3">
      <LanguageSelect
        id="live-source-language"
        label="말하는 언어"
        value={source}
        options={LIVE_SOURCE_LANGUAGES}
        onChange={onSourceChange}
        invalid={problem === "unknown-source" || problem === "same-language"}
      />

      {onSwap ? (
        <button
          type="button"
          onClick={onSwap}
          aria-label="언어 방향 바꾸기"
          title="언어 방향 바꾸기"
          className="mb-0.5 inline-flex size-14 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--bg-raised)] text-[var(--fg-muted)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
        >
          <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none">
            <path
              d="M3.5 7h13M13 3.5 16.5 7 13 10.5M16.5 13h-13M7 9.5 3.5 13 7 16.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <span aria-hidden className="mb-4 shrink-0 text-lg text-[var(--fg-dim)]">
          →
        </span>
      )}

      <LanguageSelect
        id="live-target-language"
        label="통역할 언어"
        value={target}
        options={LIVE_TARGET_LANGUAGES}
        onChange={onTargetChange}
        invalid={problem === "unknown-target" || problem === "same-language"}
      />
    </div>
  );
}
