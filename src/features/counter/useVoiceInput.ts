"use client";

/** React binding for the one-utterance Counter speech controller. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useCapability } from "@/hooks/useCapability";
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
  const lastPartial = useRef("");

  const start = useCallback(async (): Promise<string> => {
    if (controller.current) return "";
    setFailure(null);
    setUsedFallback(false);
    setPartial("");
    lastPartial.current = "";

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

    try {
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
    }
  }, [counterCode, counterToken, lang]);

  const stop = useCallback(() => controller.current?.stop(), []);

  useEffect(
    () => () => {
      controller.current?.dispose();
      controller.current = null;
    },
    // A participant language/capability change must also terminate the old
    // recogniser so the next tap cannot continue with stale STT credentials.
    [counterCode, counterToken, lang],
  );

  return {
    supported: supported && phase !== "unavailable",
    phase,
    listening: phase === "listening" || phase === "connecting",
    partial,
    failure,
    usedFallback,
    start,
    stop,
    dismissError: useCallback(() => setFailure(null), []),
  };
}
