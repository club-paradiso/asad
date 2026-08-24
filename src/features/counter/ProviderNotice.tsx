"use client";

/**
 * Who will see what the visitor is about to say.
 *
 * A stranger at a counter is asked to type medical symptoms, immigration
 * status or money problems into a device they did not choose. Naming the
 * company that receives it — and saying plainly when a free tier may keep it —
 * belongs on the join screen, before the first word, in the visitor's own
 * language. Not in a policy page they cannot read.
 */
import { useEffect, useState } from "react";
import type { AppConfig } from "@/app/api/config/route";
import type { CounterStrings } from "@/counter/ui-strings";
import { cn } from "@/lib/cn";

export type CounterDisclosure = AppConfig["counter"];

/** Ask the server once what a counter turn would reach. */
export function useCounterDisclosure(): CounterDisclosure | null {
  const [disclosure, setDisclosure] = useState<CounterDisclosure | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: AppConfig | null) => {
        if (!cancelled && value) setDisclosure(value.counter);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return disclosure;
}

const fill = (template: string, provider: string) =>
  template.replace("{provider}", provider);

export function ProviderNotice({
  disclosure,
  strings,
  className,
}: {
  disclosure: CounterDisclosure | null;
  strings: CounterStrings;
  className?: string;
}) {
  // Still loading: say nothing rather than flash a claim and correct it.
  if (!disclosure) return null;

  if (!disclosure.provider) {
    return (
      <p
        className={cn(
          "text-center text-xs leading-relaxed text-[var(--danger)]",
          className,
        )}
      >
        {strings.translationFailed} — no translation provider is configured.
      </p>
    );
  }

  return (
    <div className={cn("text-center text-xs leading-relaxed", className)}>
      <p className="text-[var(--fg-dim)]">
        {fill(strings.sentTo, disclosure.provider)}
      </p>
      {disclosure.mayTrain && (
        <p className="mt-1 text-[var(--warn)]">
          {fill(strings.mayTrain, disclosure.provider)}
        </p>
      )}
    </div>
  );
}
