"use client";

/**
 * One-time free-tier privacy disclosure.
 *
 * Shown once, before the first live cloud session, when the configured routing
 * would send transcript content to a provider whose free tier may use it to
 * improve their products.
 *
 * The reason this exists at all: sermons contain personal testimonies, prayer
 * requests, names and pastoral information. "It's free" is not a good enough
 * reason to send that somewhere without saying so. The alternative offered here
 * is real — local-only mode genuinely sends nothing.
 *
 * Deliberately once per browser, not once per session: interrupting every
 * service would train the interpreter to dismiss it without reading.
 */
import { useCallback, useState } from "react";
import { Button, Label } from "@/components/ui/primitives";
import { useCapability } from "@/hooks/useCapability";

const ACK_KEY = "tong-yuck:free-tier-privacy-ack";

export interface DisclosureProvider {
  label: string;
  note: string;
}

/** Whether this browser has already seen the disclosure. */
export function hasAcknowledged(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(ACK_KEY) === "1";
  } catch {
    // Private mode: show it rather than assume consent.
    return false;
  }
}

export function PrivacyDisclosure({
  providers,
  onAccept,
  onUseLocalOnly,
}: {
  providers: DisclosureProvider[];
  onAccept: () => void;
  onUseLocalOnly: () => void;
}) {
  // Derived, not stored: whether the disclosure is due is a function of the
  // configured providers and what this browser has already seen. Setting it in
  // an effect would cost an extra render on every session start.
  const acknowledged = useCapability(hasAcknowledged, true);
  const [dismissed, setDismissed] = useState(false);
  const visible = providers.length > 0 && !acknowledged && !dismissed;

  const acknowledge = useCallback(() => {
    try {
      window.localStorage.setItem(ACK_KEY, "1");
    } catch {
      // Nothing to do; the disclosure simply shows again next time.
    }
    setDismissed(true);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-disclosure-title"
    >
      <div className="scroll-y max-h-full w-full max-w-lg rounded-lg border border-[var(--line-strong)] bg-[var(--bg-raised)] p-5">
        <Label className="text-[var(--warn)]">Before your first live session</Label>
        <h2 id="privacy-disclosure-title" className="mt-1.5 text-lg font-semibold">
          This setup sends what is said to a free AI service
        </h2>

        <p className="mt-3 text-sm leading-relaxed text-[var(--fg-muted)]">
          Free tiers are not free of consequences. With the current
          configuration, the Korean transcript and the English assistance are
          sent to:
        </p>

        <ul className="mt-3 space-y-2.5">
          {providers.map((provider) => (
            <li
              key={provider.label}
              className="rounded-md border border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--warn)_7%,transparent)] px-3 py-2.5"
            >
              <p className="text-sm font-medium text-[var(--warn)]">{provider.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--fg-muted)]">
                {provider.note}
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-sm leading-relaxed text-[var(--fg-muted)]">
          Sermons often include testimonies, prayer requests and names. If this
          session is sensitive, use local-only mode — it sends nothing anywhere,
          and Scripture, terminology and wordplay detection all still work.
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button
            tone="primary"
            className="flex-1"
            onClick={() => {
              acknowledge();
              onAccept();
            }}
          >
            I understand — continue
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              acknowledge();
              onUseLocalOnly();
            }}
          >
            Use local-only mode
          </Button>
        </div>

        <p className="mt-3 text-xs text-[var(--fg-dim)]">
          Shown once per browser. Full details in docs/privacy.md.
        </p>
      </div>
    </div>
  );
}
