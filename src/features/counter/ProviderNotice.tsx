"use client";

/**
 * Public counter screens should not expose infrastructure/provider details.
 *
 * We still query the server for one operational reason: if no translation
 * provider is configured at all, users need a clear failure message instead of
 * discovering it only after they try to send something. A healthy configured
 * provider is intentionally represented as `null` here so neither the visitor
 * nor staff setup screen renders vendor, model-weight, training, retention or
 * logging details.
 */
import { useEffect, useState } from "react";
import type { AppConfig } from "@/app/api/config/route";
import type { CounterStrings } from "@/counter/ui-strings";
import { cn } from "@/lib/cn";

export type CounterDisclosure = AppConfig["counter"];

/**
 * Return disclosure data only when translation is unavailable.
 * Provider details remain available to diagnostics/internal tooling through the
 * config API, but are not promoted on general-user counter surfaces.
 */
export function useCounterDisclosure(): CounterDisclosure | null {
  const [disclosure, setDisclosure] = useState<CounterDisclosure | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: AppConfig | null) => {
        if (cancelled || !value) return;
        setDisclosure(value.counter.provider ? null : value.counter);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return disclosure;
}

export function ProviderNotice({
  disclosure,
  strings,
  className,
}: {
  disclosure: CounterDisclosure | null;
  strings: CounterStrings;
  className?: string;
}) {
  // Healthy provider details are deliberately hidden from public UI.
  if (!disclosure) return null;

  // Only an actionable outage remains visible.
  if (!disclosure.provider) {
    return (
      /* Shape and a live region, not just a colour.
         This line is read by a visitor who shares no language with the staff
         member in front of them, on their own phone, at a counter — the least
         forgiving reading conditions in the product. Red alone carries nothing
         for a colour-blind reader or in direct sunlight, and a plain <p> that
         appears after the page has loaded is never announced at all. */
      <p
        role="alert"
        className={cn(
          "flex items-start justify-center gap-1.5 text-center text-[0.8125rem] leading-relaxed text-[var(--danger)]",
          className,
        )}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="mt-0.5 size-4 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        >
          <path d="M12 3 22 21H2z" />
          <path d="M12 10v4" strokeLinecap="round" />
          <path d="M12 17.5h.01" strokeLinecap="round" />
        </svg>
        {strings.translationUnavailable}
      </p>
    );
  }

  return null;
}
