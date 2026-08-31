"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Label({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("type-label", className)}>{children}</span>;
}

type ButtonTone = "neutral" | "primary" | "quiet" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const TONE: Record<ButtonTone, string> = {
  neutral:
    "bg-[var(--bg-raised)] text-[var(--fg)] border-[var(--line)] hover:bg-[var(--bg-overlay)] hover:border-[var(--line-strong)]",
  primary:
    "bg-[var(--accent)] text-[var(--accent-contrast)] border-[var(--accent)] font-semibold shadow-sm hover:brightness-105",
  quiet:
    "bg-transparent text-[var(--fg-muted)] border-transparent hover:text-[var(--fg)] hover:bg-[var(--bg-overlay)]",
  danger:
    "bg-transparent text-[var(--danger)] border-[color-mix(in_srgb,var(--danger)_48%,transparent)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]",
};

const TONE_ACTIVE: Record<ButtonTone, string> = {
  neutral:
    "bg-[var(--accent-dim)] text-[var(--accent)] border-[color-mix(in_srgb,var(--accent)_45%,var(--line))]",
  primary:
    "bg-[var(--accent)] text-[var(--accent-contrast)] border-[var(--accent)] font-semibold shadow-sm",
  quiet:
    "bg-[var(--accent-dim)] text-[var(--accent)] border-[color-mix(in_srgb,var(--accent)_32%,transparent)]",
  danger:
    "bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)] border-[var(--danger)]",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3 text-[0.8125rem]",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-14 px-6 text-base",
};

const INTERACTIVE =
  "touch-manipulation select-none cursor-pointer transition-[color,background-color,border-color,filter,transform,box-shadow] " +
  "active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] " +
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
        "inline-flex items-center justify-center gap-2 rounded-xl border",
        INTERACTIVE,
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
        SIZE[size],
        active ? TONE_ACTIVE[tone] : TONE[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function StatusDot({
  state,
  className,
}: {
  state:
    | "live"
    | "connecting"
    | "reconnecting"
    | "degraded"
    | "offline"
    | "error"
    | "idle";
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
        "inline-block size-2 shrink-0 rounded-full",
        (state === "connecting" || state === "reconnecting") && "pulse-live",
        className,
      )}
      style={{ background: colour }}
    />
  );
}

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
      ? "border-[color-mix(in_srgb,var(--info)_34%,transparent)] bg-[var(--info-dim)] text-[var(--info)]"
      : tone === "accent"
        ? "border-[color-mix(in_srgb,var(--accent)_34%,transparent)] bg-[var(--accent-dim)] text-[var(--accent)]"
        : "border-[var(--line)] bg-[var(--bg-raised)] text-[var(--fg-muted)]";

  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      title={title}
      className={cn(
        "shrink-0 rounded-lg border px-2.5 py-1.5 text-left type-context whitespace-nowrap",
        onClick && `${INTERACTIVE} hover:bg-[var(--bg-overlay)]`,
        styles,
        className,
      )}
    >
      {children}
    </Tag>
  );
}

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
      className="inline-flex rounded-xl border border-[var(--line)] bg-[var(--bg-overlay)] p-1"
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
              "inline-flex items-center justify-center gap-1.5 rounded-lg",
              INTERACTIVE,
              size === "sm"
                ? "min-h-11 px-2.5 text-[0.75rem]"
                : "min-h-11 px-3.5 text-sm",
              selected
                ? "bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold shadow-sm"
                : "text-[var(--fg-muted)] hover:bg-[color-mix(in_srgb,var(--bg-raised)_72%,transparent)] hover:text-[var(--fg)]",
            )}
          >
            {indicator ? (
              <span
                aria-hidden
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded-full border",
                  selected ? "border-current" : "border-[var(--fg-dim)]",
                )}
              >
                {selected ? <span className="size-1.5 rounded-full bg-current" /> : null}
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
  "min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-2.5 " +
  "text-sm text-[var(--fg)] placeholder:text-[var(--fg-dim)] shadow-sm transition-[border-color,box-shadow,background-color] " +
  "hover:border-[var(--line-strong)]";

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
        "flex min-h-12 w-full items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[var(--bg-raised)] px-3.5 py-3 text-left shadow-sm hover:border-[var(--line-strong)]",
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
            "absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
