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
      <p
        className={cn(
          "text-center text-xs leading-relaxed text-[var(--danger)]",
          className,
        )}
      >
        {strings.translationUnavailable}
      </p>
    );
  }

  return null;
}
