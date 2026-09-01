"use client";

/** React binding for the one-utterance Counter speech controller. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useCapability } from "@/hooks/useCapability";
import {
  CounterSpeechController,
  type CounterVoiceFailure,
  type CounterVoicePhase,
} from "./counter-speech";

export function useVoiceInput(lang: string, counterCode?: string) {
  const supported = useCapability(() => CounterSpeechController.isPotentiallyAvailable());
  const [phase, setPhase] = useState<CounterVoicePhase>("idle");
  const [partial, setPartial] = useState("");
  const [failure, setFailure] = useState<CounterVoiceFailure | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const controller = useRef<CounterSpeechController | null>(null);

  const start = useCallback(async (): Promise<string> => {
    if (controller.current) return "";
    setFailure(null);
    setUsedFallback(false);

    const next = new CounterSpeechController(lang, {
      onPhase: setPhase,
      onPartial: setPartial,
      onFallback: () => setUsedFallback(true),
    }, undefined, counterCode);
    controller.current = next;

    try {
      const result = await next.listen();
      setFailure(result.failure ?? null);
      setUsedFallback(result.usedFallback);
      return result.text;
    } finally {
      controller.current = null;
    }
  }, [counterCode, lang]);

  const stop = useCallback(() => controller.current?.stop(), []);

  useEffect(
    () => () => {
      controller.current?.dispose();
      controller.current = null;
    },
    [],
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
