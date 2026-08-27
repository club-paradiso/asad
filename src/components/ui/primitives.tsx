"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The whole component vocabulary of tong-yuck.
 *
 * There is no card, no panel, no shadow and no rounded hero. Every primitive
 * here exists because a specific piece of the console needed it, and each one
 * is sized for a thumb on an iPhone in landscape (44px minimum target).
 */

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("type-label", className)}>{children}</span>;
}

type ButtonTone = "neutral" | "primary" | "quiet" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const TONE: Record<ButtonTone, string> = {
  neutral:
    "bg-[var(--bg-overlay)] text-[var(--fg)] border-[var(--line-strong)] hover:border-[var(--fg-dim)]",
  primary:
    "bg-[var(--accent)] text-[var(--accent-contrast)] border-[var(--accent)] hover:brightness-110 font-semibold",
  quiet:
    "bg-transparent text-[var(--fg-muted)] border-transparent hover:text-[var(--fg)] hover:bg-[var(--bg-overlay)]",
  danger:
    "bg-transparent text-[var(--danger)] border-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]",
};

/**
 * Pressed styles are a separate map rather than classes layered on top of
 * TONE. Two arbitrary `text-[...]` utilities have equal specificity, so which
 * one wins depends on their order in the generated stylesheet, not on the
 * order they appear in the class list — the on-state would silently lose.
 * A toggle you cannot read without pressing is not a toggle.
 */
const TONE_ACTIVE: Record<ButtonTone, string> = {
  neutral: "bg-[var(--accent-dim)] text-[var(--accent)] border-[var(--accent)]",
  primary:
    "bg-[var(--accent)] text-[var(--accent-contrast)] border-[var(--accent)] font-semibold",
  quiet: "bg-[var(--accent-dim)] text-[var(--accent)] border-[color-mix(in_srgb,var(--accent)_35%,transparent)]",
  danger: "bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] text-[var(--danger)] border-[var(--danger)]",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3 text-[0.8125rem]",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-14 px-6 text-base",
};

const INTERACTIVE =
  "touch-manipulation select-none cursor-pointer transition-[color,background-color,border-color,filter,transform] " +
  "active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

export function Button({
  children,
  onClick,
  tone = "neutral",
  size = "md",
  active = false,
  disabled = false,
  className,
  title,
  type = "button",
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: ButtonTone;
  size?: ButtonSize;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: "button" | "submit";
  ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md border",
        INTERACTIVE,
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none disabled:active:scale-100",
        SIZE[size],
        active ? TONE_ACTIVE[tone] : TONE[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Connection state, shown as a colour and a word. No spinner: a spinner in the
 * corner of a live console is motion the interpreter has to learn to ignore.
 */
export function StatusDot({
  state,
  className,
}: {
  state: "live" | "connecting" | "reconnecting" | "degraded" | "offline" | "error" | "idle";
  className?: string;
}) {
  const colour =
    state === "live"
      ? "var(--ok)"
      : state === "connecting" || state === "reconnecting"
        ? "var(--accent)"
        : state === "degraded"
          ? "var(--warn)"
          : state === "error" || state === "offline"
            ? "var(--danger)"
            : "var(--fg-dim)";

  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 rounded-full shrink-0",
        (state === "connecting" || state === "reconnecting") && "pulse-live",
        className,
      )}
      style={{ background: colour }}
    />
  );
}

/** A context chip. Small, scannable, never more than two lines. */
export function Chip({
  children,
  tone = "neutral",
  className,
  onClick,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "info" | "accent";
  className?: string;
  onClick?: () => void;
  title?: string;
}) {
  const styles =
    tone === "info"
      ? "border-[color-mix(in_srgb,var(--info)_38%,transparent)] bg-[var(--info-dim)] text-[var(--info)]"
      : tone === "accent"
        ? "border-[color-mix(in_srgb,var(--accent)_38%,transparent)] bg-[var(--accent-dim)] text-[var(--accent)]"
        : "border-[var(--line)] bg-[var(--bg-overlay)] text-[var(--fg-muted)]";

  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      title={title}
      className={cn(
        "shrink-0 rounded border px-2.5 py-1.5 type-context whitespace-nowrap text-left",
        onClick && `${INTERACTIVE} hover:brightness-125`,
        styles,
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Segmented control. Used for mode, lag and view — never more than four items. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  label,
  indicator = false,
}: {
  options: Array<{ value: T; label: string; title?: string }>;
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  label?: string;
  indicator?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-md border border-[var(--line-strong)] bg-[var(--bg-overlay)] p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded",
              INTERACTIVE,
              size === "sm" ? "min-h-11 px-2.5 text-[0.75rem]" : "min-h-11 px-3.5 text-sm",
              selected
                ? "bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            {indicator ? (
              <span
                aria-hidden
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border-2",
                  selected ? "border-current" : "border-[var(--fg-dim)]",
                )}
              >
                {selected ? <span className="size-2 rounded-full bg-current" /> : null}
              </span>
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <span className="text-xs text-[var(--fg-dim)]">{hint}</span> : null}
    </label>
  );
}

const inputStyles =
  "w-full rounded-md border border-[var(--line-strong)] bg-[var(--bg-raised)] px-3 py-2.5 " +
  "text-[var(--fg)] placeholder:text-[var(--fg-dim)] text-sm";

export function TextInput({
  value,
  onChange,
  placeholder,
  korean = false,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  korean?: boolean;
  id?: string;
}) {
  return (
    <input
      {...rest}
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={cn(inputStyles, korean && "font-korean")}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
  korean = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  korean?: boolean;
}) {
  return (
    <textarea
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={cn(inputStyles, "resize-y leading-relaxed", korean && "font-korean")}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full min-h-12 items-center justify-between gap-4 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-3 text-left",
        INTERACTIVE,
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-[var(--fg)]">{label}</span>
        {hint ? <span className="text-xs text-[var(--fg-dim)]">{hint}</span> : null}
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-[var(--accent)]" : "bg-[var(--line-strong)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
