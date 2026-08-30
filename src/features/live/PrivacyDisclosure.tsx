"use client";

/**
 * One-time free-tier privacy disclosure.
 *
 * Live interpretation and Prep are separate disclosure surfaces. A live
 * transcript is already sensitive, but Prep may send an entire outline or
 * script. Acknowledging one therefore must not silently count as acknowledging
 * the other.
 */
import { useCallback, useState } from "react";
import { Button, Label } from "@/components/ui/primitives";
import { useCapability } from "@/hooks/useCapability";

export type PrivacyDisclosureContext = "live" | "prep";

const ACK_KEYS: Record<PrivacyDisclosureContext, string> = {
  live: "tong-yuck:free-tier-privacy-ack",
  prep: "tong-yuck:prep-free-tier-privacy-ack",
};

export interface DisclosureProvider {
  label: string;
  note: string;
}

export function privacyAcknowledgementKey(context: PrivacyDisclosureContext): string {
  return ACK_KEYS[context];
}

/** Whether this browser has already accepted this workflow's cloud disclosure. */
export function hasAcknowledged(context: PrivacyDisclosureContext = "live"): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(ACK_KEYS[context]) === "1";
  } catch {
    // Private mode: show it rather than assume consent.
    return false;
  }
}

const COPY: Record<
  PrivacyDisclosureContext,
  {
    label: string;
    title: string;
    intro: string;
    sensitivity: string;
    accept: string;
    localOnly: string;
  }
> = {
  live: {
    label: "Before your first live session",
    title: "This setup sends what is said to a free AI service",
    intro:
      "With the current configuration, the Korean transcript and the English assistance are sent to:",
    sensitivity:
      "Sermons often include testimonies, prayer requests and names. If this session is sensitive, use local-only mode — it sends nothing anywhere, and Scripture, terminology and wordplay detection all still work.",
    accept: "I understand — continue",
    localOnly: "Use local-only mode",
  },
  prep: {
    label: "Before using AI preparation",
    title: "This brief may send your prep material to a free AI service",
    intro:
      "With the current configuration, the speaker, title, notes and outline you entered may be sent to:",
    sensitivity:
      "Prep material can contain names, testimonies, pastoral notes or an unpublished sermon manuscript. If you do not want that material sent to an AI provider, build the local-only brief instead.",
    accept: "I understand — build brief",
    localOnly: "Build local-only brief",
  },
};

export function PrivacyDisclosure({
  providers,
  onAccept,
  onUseLocalOnly,
  context = "live",
}: {
  providers: DisclosureProvider[];
  onAccept: () => void;
  onUseLocalOnly: () => void;
  context?: PrivacyDisclosureContext;
}) {
  // Derived, not stored: whether the disclosure is due is a function of the
  // configured providers and what this browser has already accepted. Setting
  // it in an effect would cost an extra render on every session start.
  const acknowledged = useCapability(() => hasAcknowledged(context), true);
  const [dismissed, setDismissed] = useState(false);
  const visible = providers.length > 0 && !acknowledged && !dismissed;
  const copy = COPY[context];

  const acknowledge = useCallback(() => {
    try {
      window.localStorage.setItem(ACK_KEYS[context], "1");
    } catch {
      // Nothing to do; the disclosure simply shows again next time.
    }
    setDismissed(true);
  }, [context]);

  if (!visible) return null;

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-disclosure-title"
    >
      <div className="scroll-y max-h-full w-full max-w-lg rounded-lg border border-[var(--line-strong)] bg-[var(--bg-raised)] p-5">
        <Label className="text-[var(--warn)]">{copy.label}</Label>
        <h2 id="privacy-disclosure-title" className="mt-1.5 text-lg font-semibold">
          {copy.title}
        </h2>

        <p className="mt-3 text-sm leading-relaxed text-[var(--fg-muted)]">
          Free tiers are not free of consequences. {copy.intro}
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
          {copy.sensitivity}
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button
            tone="primary"
            className="flex-1"
            onClick={() => {
              // Only the path that actually permits cloud use is persisted as
              // accepted. Choosing local-only is not consent for a later run.
              acknowledge();
              onAccept();
            }}
          >
            {copy.accept}
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              setDismissed(true);
              onUseLocalOnly();
            }}
          >
            {copy.localOnly}
          </Button>
        </div>

        <p className="mt-3 text-xs text-[var(--fg-dim)]">
          Cloud acceptance is remembered once per browser for this workflow. Choosing local-only is not stored as cloud consent. Full details in docs/privacy.md.
        </p>
      </div>
    </div>
  );
}
