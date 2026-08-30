"use client";

/**
 * React binding for the interpretation engine.
 *
 * Owns the things the engine deliberately does not: the speech provider, the
 * microphone, the clock interval, and the network calls. The engine itself
 * stays a pure state machine so it can be tested without a browser.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BibleReference,
  ConnectionState,
  InterpretationMode,
  LagProfile,
  PrepSheet,
} from "@/types";
import { emptyPrepSheet } from "@/types";
import type { InterpretRequest } from "@/lib/schema";
import { interpreterOutputSchema } from "@/lib/schema";
import {
  InterpretationEngine,
  type EngineSnapshot,
  type InterpretResult,
} from "@/interpreter/engine/session";
import { buildSttHints } from "@/interpreter/glossary/stt-hints";
import { interpretLocally } from "@/providers/llm/mock";
import {
  MicrophoneCapture,
  createSpeechProvider,
  fetchSttCredentials,
  type SpeechProvider,
  type SttProviderId,
  type SttStatus,
} from "@/providers/stt";
import type { DemoBeat, DemoScript } from "@/demo/types";
import { demoScriptFor } from "@/demo/sermon-script";
import { guardedFetch } from "@/lib/session-client";

/** How often the engine's clock advances. 200ms is well inside human latency. */
const TICK_MS = 200;

export type SessionPhase = "idle" | "starting" | "running" | "ended";

export interface LiveSessionOptions {
  mode: InterpretationMode;
  lag: LagProfile;
  prep?: PrepSheet;
  /** `demo` needs no key and no microphone. */
  source: SttProviderId;
  /** Preferred physical booth input for providers that accept raw audio. */
  audioDeviceId?: string;
  /** Demo playback rate; 1 is real time. */
  demoSpeed?: number;
  /** Look up Scripture text. Skipped entirely in demo mode. */
  resolveScripture?: boolean;
}

const emptySnapshot = (): EngineSnapshot => ({
  segments: [],
  partial: null,
  chunks: [],
  scripture: [],
  glossary: [],
  culturalNotes: [],
  entities: [],
  corrections: [],
  connection: "idle",
  health: { stt: "ok", llm: "ok", bible: "ok" },
  thinking: false,
});

export function useLiveSession(options: LiveSessionOptions) {
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(emptySnapshot);
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [demoBeat, setDemoBeat] = useState<DemoBeat | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  /** Which provider answered the most recent turn — drives the AI pill. */
  const [lastProvider, setLastProvider] = useState<string | undefined>(undefined);

  const engineRef = useRef<InterpretationEngine | null>(null);
  const providerRef = useRef<SpeechProvider | null>(null);
  const micRef = useRef<MicrophoneCapture | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const script: DemoScript = useMemo(() => demoScriptFor(options.mode), [options.mode]);

  // Live-updating ref so the engine's callbacks always see current settings
  // without tearing down the session when a toggle changes. Seeded at mount so
  // `start()` reads the right values on the very first run, then synchronised
  // in an effect rather than during render.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  /** One interpretation call. Demo mode never touches the network. */
  const interpret = useCallback(
    async (request: InterpretRequest, signal: AbortSignal): Promise<InterpretResult> => {
      if (optionsRef.current.source === "demo") {
        // Simulated model latency, so demo mode shows the real rhythm of the
        // console rather than an impossibly instant one.
        await new Promise((resolve) => setTimeout(resolve, 420));
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        setLastProvider("local");
        return {
          output: interpretLocally({
            pending: request.pending,
            mode: request.mode,
            scriptId: script.id,
            allowAnticipation: request.allowAnticipation,
          }),
        };
      }

      const response = await guardedFetch("/api/interpret", {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        // 429 is the one status worth naming: it is the deployment protecting
        // itself, not a fault, and the console recovers on the next turn.
        throw new Error(
          response.status === 429
            ? "Interpretation is being rate limited — slowing down."
            : `Interpretation request failed (${response.status}).`,
        );
      }

      const data = (await response.json()) as {
        output: unknown;
        provider?: string;
        degraded?: boolean;
        reason?: string;
      };
      const parsed = interpreterOutputSchema.safeParse(data.output);
      if (!parsed.success) throw new Error("Interpretation response failed validation.");

      setLastProvider(data.provider);
      return { output: parsed.data, degraded: data.degraded, reason: data.reason };
    },
    [script.id],
  );

  const resolveBible = useCallback(async (reference: BibleReference) => {
    const response = await fetch(`/api/bible?ref=${encodeURIComponent(reference.display)}`);
    if (!response.ok) return reference;
    const data = (await response.json()) as { reference?: BibleReference };
    return data.reference ?? reference;
  }, []);

  const teardown = useCallback(async () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    await micRef.current?.stop().catch(() => {});
    micRef.current = null;
    await providerRef.current?.disconnect().catch(() => {});
    providerRef.current = null;
  }, []);

  const stop = useCallback(async () => {
    engineRef.current?.stop();
    await teardown();
    setPhase("ended");
  }, [teardown]);

  const start = useCallback(async () => {
    if (phase === "running" || phase === "starting") return;
    setError(null);
    setPhase("starting");
    setDemoBeat(null);
    setLastProvider(undefined);
    setSnapshot(emptySnapshot());

    const current = optionsRef.current;
    const engine = new InterpretationEngine({
      mode: current.mode,
      lag: current.lag,
      prep: current.prep ?? emptyPrepSheet(),
      interpret,
      resolveBible:
        current.source !== "demo" && current.resolveScripture !== false ? resolveBible : undefined,
      onChange: setSnapshot,
    });
    engineRef.current = engine;
    engine.start();
    setStartedAt(Date.now());

    // Hardware/provider terminal failures abort the interpreter engine first,
    // then close capture/provider resources before exposing Try again. Keeping
    // the engine instance in this closure prevents an old teardown from
    // overwriting a newer retry session if the user moves quickly.
    const failTerminally = (message: string) => {
      setError(message);
      engine.stop();
      void teardown().finally(() => {
        if (engineRef.current !== engine) return;
        engine.setConnection("error");
        engine.setHealth("stt", "down", message);
        setPhase("idle");
      });
    };

    try {
      // The recogniser gets only the highest-value terms. In sermon mode this
      // includes community-glossary terms that actually occur in today's prep.
      const hints = buildSttHints(current.mode, current.prep);

      const credentials =
        current.source === "demo" || current.source === "webspeech"
          ? undefined
          : ((await fetchSttCredentials()) ?? undefined);

      // A cloud provider that turns out to be unconfigured falls back to demo
      // rather than opening a console that cannot hear anything.
      const effectiveSource: SttProviderId =
        credentials && credentials.provider !== current.source
          ? credentials.provider
          : current.source;

      if (effectiveSource !== current.source) {
        setError(
          `${current.source} is not configured on the server — running the scripted demo instead.`,
        );
      }

      const provider = createSpeechProvider({
        provider: effectiveSource,
        language: "ko-KR",
        hints,
        credentials,
        demo: {
          script,
          speed: current.demoSpeed,
          onBeat: (beat) => setDemoBeat(beat),
          onComplete: () => {
            engineRef.current?.setConnection("idle");
          },
        },
      });
      providerRef.current = provider;

      provider.onPartial((text) => engineRef.current?.handlePartial(text));
      provider.onStable((text) => engineRef.current?.handleStable(text));
      provider.onError((err) => setError(err.message));
      provider.onStatus((status) => {
        engineRef.current?.setConnection(mapStatus(status));
        engineRef.current?.setHealth(
          "stt",
          status === "error" ? "down" : status === "reconnecting" ? "degraded" : "ok",
        );

        // A recogniser that reports a terminal error is no longer listening.
        // Tear it down and expose the direct-interaction retry button instead
        // of leaving the UI saying "running" while the microphone is dead.
        if (status === "error") {
          failTerminally("Speech recognition stopped unexpectedly. Check the connection, then tap Try again.");
        }
      });

      await provider.connect();

      if (provider.needsAudio) {
        if (!MicrophoneCapture.isSupported()) {
          throw new Error("This browser cannot capture microphone audio.");
        }
        const mic = new MicrophoneCapture({
          deviceId: current.audioDeviceId || undefined,
          onFrame: (frame) => provider.sendAudio(frame),
          onError: (err) => setError(err.message),
          onEnded: () => {
            failTerminally(
              current.audioDeviceId
                ? "Selected audio input disconnected. Reconnect it or choose System default, then tap Try again."
                : "Audio input disconnected. Check the input device, then tap Try again.",
            );
          },
        });
        micRef.current = mic;
        await mic.start();
        // A track can theoretically end while AudioWorklet setup is still
        // finishing. In that case terminal teardown has already detached this
        // mic; never let the tail of start() resurrect the session as running.
        if (micRef.current !== mic) return;
      }

      tickRef.current = setInterval(() => engineRef.current?.tick(), TICK_MS);
      setPhase("running");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.name === "NotAllowedError"
            ? "Microphone permission was denied. Grant access, then tap Try again."
            : err.name === "OverconstrainedError" || err.name === "NotFoundError"
              ? "The selected audio input is unavailable. Reconnect it or choose System default, then tap Try again."
              : err.message
          : "Could not start the session.";
      setError(message);
      engine.stop();
      await teardown();
      if (engineRef.current === engine) {
        engine.setConnection("error");
        engine.setHealth("stt", "down", message);
        setPhase("idle");
      }
    }
  }, [phase, interpret, resolveBible, script, teardown]);

  // Push setting changes into the running engine rather than restarting it.
  useEffect(() => {
    engineRef.current?.setMode(options.mode);
  }, [options.mode]);

  useEffect(() => {
    engineRef.current?.setLag(options.lag);
  }, [options.lag]);

  useEffect(() => {
    if (options.prep) engineRef.current?.setPrep(options.prep);
  }, [options.prep]);

  useEffect(() => () => void teardown(), [teardown]);

  const correct = useCallback((from: string, to: string, english?: string) => {
    engineRef.current?.correct(from, to, english);
  }, []);

  return {
    snapshot,
    phase,
    error,
    demoBeat,
    lastProvider,
    startedAt,
    script,
    start,
    stop,
    correct,
    dismissError: useCallback(() => setError(null), []),
  };
}

export type LiveSession = ReturnType<typeof useLiveSession>;

const mapStatus = (status: SttStatus): ConnectionState => {
  switch (status) {
    case "connecting":
      return "connecting";
    case "listening":
      return "live";
    case "reconnecting":
      return "reconnecting";
    case "error":
      return "error";
    case "closed":
      return "idle";
    default:
      return "idle";
  }
};
