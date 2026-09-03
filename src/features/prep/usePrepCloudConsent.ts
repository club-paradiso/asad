"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppConfig } from "@/app/api/config/route";
import { useCapability } from "@/hooks/useCapability";
import {
  hasAcknowledged,
  type DisclosureProvider,
} from "@/features/live/PrivacyDisclosure";

export type PrepConsentPhase =
  | "checking"
  | "clear"
  | "needed"
  | "granted"
  | "declined";

export function resolvePrepConsent(input: {
  acknowledged: boolean;
  modelAvailable: boolean | undefined;
  disclosure: DisclosureProvider[] | undefined;
}): PrepConsentPhase {
  if (input.acknowledged) return "clear";
  // No model means the deterministic local brief can run entirely in the
  // browser. There is no third-party provider to disclose.
  if (input.modelAvailable === false) return "clear";
  // Unknown routing is not permission. Wait until the deployment tells us
  // where the material would go.
  if (input.modelAvailable === undefined || input.disclosure === undefined) {
    return "checking";
  }
  return input.disclosure.length > 0 ? "needed" : "clear";
}

export function prepPhasePermitsCloud(phase: PrepConsentPhase): boolean {
  return phase === "clear" || phase === "granted";
}

export function usePrepCloudConsent() {
  // Prep has no user-gesture timing requirement, so unlike the live speech
  // gate there is no reason to optimistically assume browser consent during
  // SSR. The button stays closed until hydration reads the real local value.
  const acknowledged = useCapability(() => hasAcknowledged("prep"), false);
  const [modelAvailable, setModelAvailable] = useState<boolean | undefined>(undefined);
  const [disclosure, setDisclosure] = useState<DisclosureProvider[] | undefined>(undefined);
  const [decision, setDecision] = useState<"granted" | "declined" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((config: AppConfig | null) => {
        if (cancelled) return;
        setModelAvailable(config?.llm.modelAvailable ?? true);
        setDisclosure(
          config?.llm.freeTierDisclosure ?? [
            {
              label: "Cloud preparation provider",
              note: "This deployment's privacy details could not be loaded. Continue only if you are willing to send the prep material to its configured AI provider.",
            },
          ],
        );
      })
      .catch(() => {
        if (cancelled) return;
        // Fail closed. A broken config check must never become permission to
        // upload an outline under an unknown privacy posture.
        setModelAvailable(true);
        setDisclosure([
          {
            label: "Cloud preparation provider",
            note: "This deployment's privacy details could not be loaded. Continue only if you are willing to send the prep material to its configured AI provider.",
          },
        ]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const phase: PrepConsentPhase =
    decision ?? resolvePrepConsent({ acknowledged, modelAvailable, disclosure });

  return {
    phase,
    providers: disclosure ?? [],
    modelAvailable,
    mayUseCloud: prepPhasePermitsCloud(phase),
    grant: useCallback(() => setDecision("granted"), []),
    decline: useCallback(() => setDecision("declined"), []),
  };
}
