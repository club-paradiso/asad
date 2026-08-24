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
    "bg-[var(--accent)] text-[#141007] border-[var(--accent)] hover:brightness-110 font-semibold",
  quiet:
    "bg-transparent text-[var(--fg-muted)] border-transparent hover:text-[var(--fg)] hover:bg-[var(--bg-overlay)]",
  danger:
    "bg-transparent text-[var(--danger)] border-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-[0.8125rem]",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-14 px-6 text-base",
};

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
        "inline-flex items-center justify-center gap-2 rounded-md border transition-colors select-none",
        "disabled:opacity-40 disabled:pointer-events-none",
        SIZE[size],
        TONE[tone],
        active && tone === "neutral" && "border-[var(--accent)] text-[var(--accent)]",
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
        onClick && "cursor-pointer hover:brightness-125",
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
}: {
  options: Array<{ value: T; label: string; title?: string }>;
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  label?: string;
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
              "rounded transition-colors",
              size === "sm" ? "h-8 px-2.5 text-[0.75rem]" : "min-h-10 px-3.5 text-sm",
              selected
                ? "bg-[var(--accent)] text-[#141007] font-semibold"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
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
      className="flex w-full items-center justify-between gap-4 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-3 text-left min-h-12"
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
