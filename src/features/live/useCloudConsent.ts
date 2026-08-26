"use client";

/**
 * The gate between pressing Start and anything leaving the machine.
 *
 * THE BUG THIS EXISTS TO FIX. The console started itself on mount — one
 * `useEffect` calling `start()` — while a *separate* effect fetched
 * `/api/config` to find out which providers needed disclosing. Those two
 * effects raced, and the race had a winner: `start()` opened the microphone,
 * connected cloud speech recognition and began dispatching `/api/interpret`
 * while the disclosure was still in flight. By the time the modal rendered,
 * the first Korean of the sermon had already been sent to a provider whose
 * free tier may use it to improve their products, and the interpreter had not
 * yet been told that would happen.
 *
 * A consent dialog that appears after the data has left is not consent.
 *
 * So the state machine here is the authority, and `LiveConsole` may not call
 * `start()` unless it says so. The cost is that a session needing disclosure
 * waits for one `/api/config` round trip before opening the microphone, which
 * is the correct trade: the alternative is sending a testimony to a third
 * party and apologising afterwards.
 */
import { useCallback, useEffect, useState } from "react";
import type { SttProviderId } from "@/providers/stt";
import { openSession } from "@/lib/session-client";
import { hasAcknowledged, type DisclosureProvider } from "./PrivacyDisclosure";

export type ConsentPhase =
  /** Still finding out. NOTHING may start. */
  | "checking"
  /** Nothing to disclose — demo mode, or no training-capable provider. */
  | "clear"
  /** Disclosure required and not yet given. NOTHING may start. */
  | "needed"
  /** The interpreter read it and continued. */
  | "granted"
  /** The interpreter chose local-only. Cloud must not be used. */
  | "declined";

export interface CloudConsent {
  phase: ConsentPhase;
  providers: DisclosureProvider[];
  /** The single question `LiveConsole` asks before starting anything. */
  mayStart: boolean;
  grant: () => void;
  decline: () => void;
}

/** What `/api/config` tells us that matters here. */
interface ConfigShape {
  llm?: { freeTierDisclosure?: DisclosureProvider[] };
}

/**
 * Resolve the phase from what is known.
 *
 * Pure and exported so the invariant is a unit test rather than a hope: no
 * combination of inputs may produce `mayStart` while a disclosure is
 * outstanding.
 */
export function resolvePhase(input: {
  source: SttProviderId;
  acknowledged: boolean;
  /** Undefined until `/api/config` has answered. */
  disclosure: DisclosureProvider[] | undefined;
}): ConsentPhase {
  // Demo mode never opens a socket, never touches the network and never
  // reaches a provider. There is nothing to disclose because nothing leaves.
  if (input.source === "demo") return "clear";
  // Acknowledged once per browser, by product decision: interrupting every
  // service trains the interpreter to dismiss it without reading.
  if (input.acknowledged) return "clear";
  if (input.disclosure === undefined) return "checking";
  return input.disclosure.length > 0 ? "needed" : "clear";
}

/** Only these two phases permit a byte to leave the machine. */
export const phasePermitsStart = (phase: ConsentPhase): boolean =>
  phase === "clear" || phase === "granted";

export function useCloudConsent(source: SttProviderId): CloudConsent {
  const [disclosure, setDisclosure] = useState<DisclosureProvider[] | undefined>(
    // Demo mode resolves synchronously rather than through an effect, so it
    // never spends a render in `checking` and never delays the demo.
    source === "demo" ? [] : undefined,
  );
  const [decision, setDecision] = useState<"granted" | "declined" | null>(null);
  const [acknowledged] = useState(() => (source === "demo" ? true : hasAcknowledged()));

  useEffect(() => {
    // Demo mode touches nothing, so it needs neither a session nor a check.
    if (source === "demo") return;

    let cancelled = false;

    // Minting the session token here, alongside the disclosure check, keeps
    // both prerequisites for a cloud call on the same gate: by the time
    // anything may start, the browser is authorised and the interpreter has
    // been told.
    void openSession();

    // An acknowledged browser already resolves to `clear` in `resolvePhase`,
    // so there is nothing to fetch and no state to set.
    if (acknowledged) return;

    fetch("/api/config", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((config: ConfigShape | null) => {
        if (cancelled) return;
        setDisclosure(config?.llm?.freeTierDisclosure ?? []);
      })
      .catch(() => {
        // The config endpoint failed, so we do not know what would be
        // disclosed. Failing OPEN here would start a cloud session under an
        // unknown privacy posture, which is the exact thing this module
        // exists to prevent — so an unknown posture is treated as one that
        // needs saying out loud.
        if (!cancelled) {
          setDisclosure([
            {
              label: "Cloud interpretation provider",
              note: "This deployment's privacy details could not be loaded, so the provider that will receive the transcript is unknown. Continue only if you are willing to send this session to it.",
            },
          ]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [source, acknowledged]);

  const phase: ConsentPhase =
    decision ?? resolvePhase({ source, acknowledged, disclosure });

  return {
    phase,
    providers: disclosure ?? [],
    mayStart: phasePermitsStart(phase),
    grant: useCallback(() => setDecision("granted"), []),
    decline: useCallback(() => setDecision("declined"), []),
  };
}
