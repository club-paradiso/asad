"use client";

/** React binding for the one-utterance Counter speech controller. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useCapability } from "@/hooks/useCapability";
import { ensureMicrophonePermission, prefetchSttCredentials } from "@/providers/stt";
import {
  CounterSpeechController,
  type CounterVoiceFailure,
  type CounterVoicePhase,
} from "./counter-speech";

export function useVoiceInput(lang: string, counterCode?: string, counterToken?: string) {
  const supported = useCapability(() => CounterSpeechController.isPotentiallyAvailable());
  const [phase, setPhase] = useState<CounterVoicePhase>("idle");
  const [partial, setPartial] = useState("");
  const [failure, setFailure] = useState<CounterVoiceFailure | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const controller = useRef<CounterSpeechController | null>(null);
  const preparing = useRef(false);
  const cancelledWhilePreparing = useRef(false);
  const lastPartial = useRef("");

  const prewarm = useCallback(() => {
    if (!counterCode || !counterToken) return;
    void prefetchSttCredentials(lang, { code: counterCode, token: counterToken });
  }, [counterCode, counterToken, lang]);

  const start = useCallback(async (): Promise<string> => {
    if (controller.current || preparing.current) return "";
    preparing.current = true;
    cancelledWhilePreparing.current = false;
    setFailure(null);
    setUsedFallback(false);
    setPartial("");
    setPhase("connecting");
    lastPartial.current = "";

    try {
      // Normally Counter setup has already completed this permission handshake.
      // Keep it here as a one-tap fallback for direct links, expired browser
      // grants, and browsers that cannot be preflighted reliably. The recording
      // action continues automatically after the native permission sheet closes.
      const permission = await ensureMicrophonePermission();
      if (cancelledWhilePreparing.current) {
        setPhase("idle");
        return "";
      }
      if (permission === "denied") {
        setFailure("permission");
        setPhase("idle");
        return "";
      }

      const next = new CounterSpeechController(
        lang,
        {
          onPhase: setPhase,
          onPartial: (text) => {
            // Keep a private in-memory copy even after the controller clears the
            // live preview on completion. If the provider dies after recognising
            // useful speech, the editable composer can recover that text instead
            // of making the visitor repeat the entire turn.
            if (text.trim()) lastPartial.current = text;
            setPartial(text);
          },
          onFallback: () => setUsedFallback(true),
        },
        undefined,
        counterCode,
        counterToken,
      );
      controller.current = next;

      const result = await next.listen();
      setFailure(result.failure ?? null);
      setUsedFallback(result.usedFallback);

      if (result.text.trim()) return result.text;

      // Permission denial and an explicit stop are intentional hard stops.
      // For provider/no-speech failures, however, a partial transcript is still
      // valuable because Composer always hands voice text back for review before
      // it can be sent. Recovering it improves UX without pretending it is final.
      if (
        result.failure !== "permission" &&
        result.failure !== "stopped" &&
        lastPartial.current.trim()
      ) {
        return lastPartial.current.trim();
      }

      return "";
    } finally {
      controller.current = null;
      preparing.current = false;
      cancelledWhilePreparing.current = false;
      // Prepare the next one-shot credential in the background. Providers with
      // an explicit expiry can keep it ready longer; opaque credentials retain
      // the conservative short window in the STT module.
      prewarm();
    }
  }, [counterCode, counterToken, lang, prewarm]);

  const stop = useCallback(() => {
    if (controller.current) {
      controller.current.stop();
      return;
    }
    if (preparing.current) {
      cancelledWhilePreparing.current = true;
      setPhase("finishing");
    }
  }, []);

  useEffect(() => {
    prewarm();
    return () => {
      cancelledWhilePreparing.current = true;
      controller.current?.dispose();
      controller.current = null;
    };
    // A participant language/capability change must also terminate the old
    // recogniser so the next tap cannot continue with stale STT credentials.
  }, [counterCode, counterToken, lang, prewarm]);

  return {
    supported: supported && phase !== "unavailable",
    phase,
    /** True only once the recogniser really is ready to hear speech. */
    listening: phase === "listening",
    /** Includes permission/provider preparation so a second tap can cancel. */
    active: phase === "connecting" || phase === "listening",
    partial,
    failure,
    usedFallback,
    start,
    stop,
    dismissError: useCallback(() => setFailure(null), []),
  };
}
