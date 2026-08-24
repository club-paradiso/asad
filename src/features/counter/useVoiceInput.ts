"use client";

/**
 * Push-to-talk voice input for the counter.
 *
 * Deliberately push-to-talk rather than continuous: at a counter there is
 * background noise, a queue behind the visitor, and two people talking. Holding
 * a button while you speak is unambiguous about whose turn it is and what is
 * being captured.
 *
 * Uses the browser's own recognition, so it costs nothing and needs no key. It
 * is not available everywhere — the caller checks `supported` and falls back to
 * typing, which always works.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useCapability } from "@/hooks/useCapability";

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
  length: number;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => RecognitionLike;

const getCtor = (): RecognitionCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export function useVoiceInput(lang: string) {
  const supported = useCapability(() => getCtor() !== null);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognition = useRef<RecognitionLike | null>(null);
  const finalText = useRef("");
  const resolver = useRef<((text: string) => void) | null>(null);

  const stop = useCallback(() => {
    try {
      recognition.current?.stop();
    } catch {
      recognition.current?.abort();
    }
  }, []);

  /** Start listening; resolves with the final transcript when `stop` is called. */
  const start = useCallback(async (): Promise<string> => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError("This browser cannot listen. Please type instead.");
      return "";
    }

    finalText.current = "";
    setPartial("");
    setError(null);

    return new Promise<string>((resolve) => {
      resolver.current = resolve;
      const instance = new Ctor();
      instance.lang = lang;
      // Push-to-talk: one utterance, ended by releasing the button.
      instance.continuous = false;
      instance.interimResults = true;

      instance.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? "";
          if (result.isFinal) finalText.current += text;
          else interim += text;
        }
        setPartial(finalText.current + interim);
      };

      instance.onerror = (event) => {
        const code = event.error ?? "unknown";
        if (code === "no-speech") setError("Nothing was heard. Try again, or type.");
        else if (code === "not-allowed") setError("Microphone permission was denied.");
        else setError("Could not hear that. Please type instead.");
      };

      instance.onend = () => {
        setListening(false);
        const text = finalText.current.trim();
        setPartial("");
        resolver.current?.(text);
        resolver.current = null;
        recognition.current = null;
      };

      recognition.current = instance;
      setListening(true);
      try {
        instance.start();
      } catch {
        setListening(false);
        setError("Could not start listening.");
        resolve("");
      }
    });
  }, [lang]);

  useEffect(
    () => () => {
      recognition.current?.abort();
    },
    [],
  );

  return {
    supported,
    listening,
    partial,
    error,
    start,
    stop,
    dismissError: useCallback(() => setError(null), []),
  };
}
