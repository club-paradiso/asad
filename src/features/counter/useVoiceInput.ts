"use client";

/**
 * Tap-to-talk voice input for Counter Mode.
 *
 * One tap starts the browser recogniser. The recogniser finishes the utterance
 * automatically after the speaker pauses; tapping the microphone again ends it
 * early. The resolved transcript is then sent by the composer, so nobody has to
 * keep a finger pressed down while talking.
 *
 * Uses the browser's own recognition, so it costs nothing and needs no key. It
 * is not available everywhere — the caller checks `supported` and keeps typing
 * available at all times.
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
  const lastHeard = useRef("");
  const resolver = useRef<((text: string) => void) | null>(null);

  const stop = useCallback(() => {
    try {
      recognition.current?.stop();
    } catch {
      recognition.current?.abort();
    }
  }, []);

  /** Start one utterance; resolves when speech ends naturally or is stopped. */
  const start = useCallback(async (): Promise<string> => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError("This browser cannot listen. Please type instead.");
      return "";
    }

    // A fast double-tap should stop the current utterance, not create two
    // recognisers racing to own the same microphone.
    if (recognition.current) {
      stop();
      return "";
    }

    finalText.current = "";
    lastHeard.current = "";
    setPartial("");
    setError(null);

    return new Promise<string>((resolve) => {
      resolver.current = resolve;
      const instance = new Ctor();
      instance.lang = lang;
      // One natural utterance. Browser Speech ends this automatically after a
      // short pause, which is the behaviour Counter Mode wants.
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
        const heard = `${finalText.current}${interim}`.trim();
        lastHeard.current = heard;
        setPartial(heard);
      };

      instance.onerror = (event) => {
        const code = event.error ?? "unknown";
        if (code === "no-speech") setError("Nothing was heard. Try again, or type.");
        else if (code === "not-allowed") setError("Microphone permission was denied.");
        else if (code === "aborted") return;
        else setError("Could not hear that. Please type instead.");
      };

      instance.onend = () => {
        setListening(false);
        // Some browser implementations leave the last words as interim when
        // stop() is called. Keep that transcript rather than silently dropping
        // what the speaker just said.
        const text = (finalText.current.trim() || lastHeard.current.trim()).trim();
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
        recognition.current = null;
        resolver.current = null;
        setListening(false);
        setError("Could not start listening.");
        resolve("");
      }
    });
  }, [lang, stop]);

  useEffect(
    () => () => {
      recognition.current?.abort();
      recognition.current = null;
      resolver.current?.("");
      resolver.current = null;
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
