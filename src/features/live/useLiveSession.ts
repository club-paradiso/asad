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
  beginBrowserTranslatorPreparation,
  translateWithBrowserTranslator,
  type BrowserTranslatorSession,
  type BrowserTranslatorStatus,
} from "@/providers/llm/browser-translator";
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
import { ClientLatencyQueue } from "./client-latency";

/** How often the engine's clock advances. 100ms keeps trigger jitter below one tenth of a second. */
const TICK_MS = 100;
/** Short retries only. Live work cannot wait through a conventional API backoff. */
const INTERPRET_RETRY_DELAYS_MS = [0, 350, 900] as const;
/** Give recognisers a moment to emit their final result after capture is sealed. */
const FINAL_STT_SETTLE_MS = 160;
/** Do not let End hang indefinitely on a free model or bad venue network. */
const FINAL_INFLIGHT_WAIT_MS = 2200;
const FINAL_FLUSH_WAIT_MS = 2800;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

const retryableInterpretStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const retryAfterMs = (response: Response): number | null => {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
};

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
  const [browserTranslatorStatus, setBrowserTranslatorStatus] =
    useState<BrowserTranslatorStatus>("unsupported");
  const [browserTranslatorProgress, setBrowserTranslatorProgress] = useState<number | null>(null);

  const engineRef = useRef<InterpretationEngine | null>(null);
  const providerRef = useRef<SpeechProvider | null>(null);
  const micRef = useRef<MicrophoneCapture | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserTranslatorRef = useRef<BrowserTranslatorSession | null>(null);
  const browserTranslatorPreparationRef = useRef<Promise<BrowserTranslatorSession | null> | null>(
    null,
  );
  const mountedRef = useRef(true);
  const clientLatencyRef = useRef(new ClientLatencyQueue());
  const pendingRenderLatencyRef = useRef<Array<{ stableAt: number; provider?: string; model?: string }>>([]);

  const script: DemoScript = useMemo(() => demoScriptFor(options.mode), [options.mode]);

  // Live-updating ref so the engine's callbacks always see current settings
  // without tearing down the session when a toggle changes. Seeded at mount so
  // `start()` reads the right values on the very first run, then synchronised
  // in an effect rather than during render.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (pendingRenderLatencyRef.current.length === 0) return;
    const renderedAt = Date.now();
    const markers = pendingRenderLatencyRef.current.splice(0);
    for (const marker of markers) {
      clientLatencyRef.current.add("stable_to_render", renderedAt - marker.stableAt, marker.provider, marker.model);
    }
  }, [snapshot.chunks]);

  const flushClientTelemetry = useCallback(() => {
    if (optionsRef.current.source === "demo") return;
    const samples = clientLatencyRef.current.batch();
    if (samples.length === 0) return;
    const ids = samples.map((sample) => sample.id);
    void guardedFetch("/api/telemetry/live", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ samples }),
    }).then((response) => {
      if (response.ok) clientLatencyRef.current.acknowledge(ids);
    }).catch(() => {});
  }, []);

  /**
   * Begin Chrome's local ko→en translator while the Start click still carries
   * user activation. If a model pack has to download, the console exposes that
   * state; interpretation never waits on the download mid-sentence.
   */
  const prepareBrowserTranslator = useCallback(() => {
    if (browserTranslatorRef.current) {
      setBrowserTranslatorStatus("ready");
      return;
    }
    if (browserTranslatorPreparationRef.current) return;

    const preparation = beginBrowserTranslatorPreparation({
      onDownloadProgress(progress) {
        if (mountedRef.current) setBrowserTranslatorProgress(progress);
      },
    });
    if (!preparation.supported) {
      setBrowserTranslatorStatus("unsupported");
      return;
    }

    setBrowserTranslatorStatus("preparing");
    setBrowserTranslatorProgress(0);
    browserTranslatorPreparationRef.current = preparation.session;
    void preparation.session
      .then((translator) => {
        if (!mountedRef.current) {
          translator?.destroy();
          return;
        }
        if (translator) {
          browserTranslatorRef.current = translator;
          setBrowserTranslatorStatus("ready");
          setBrowserTranslatorProgress(1);
        } else {
          setBrowserTranslatorStatus("failed");
          setBrowserTranslatorProgress(null);
        }
      })
      .finally(() => {
        browserTranslatorPreparationRef.current = null;
      });
  }, []);

  /** One interpretation call. Demo mode never touches the network. */
  const interpret = useCallback(
    async (request: InterpretRequest, signal: AbortSignal): Promise<InterpretResult> => {
      let firstClientDispatchedAt: number | undefined;

      /**
       * Prefer the already-prepared browser translator over the deterministic
       * fallback. Never wait for a model download here: a live turn has a
       * deadline, and Korean echoed back four seconds late is not translation.
       */
      const localFallback = async (reason: string): Promise<InterpretResult> => {
        const browserTranslator = browserTranslatorRef.current;
        if (browserTranslator) {
          const output = await translateWithBrowserTranslator(
            browserTranslator,
            request.pending,
            signal,
          );
          if (output) {
            setLastProvider("browser-on-device");
            return {
              output,
              degraded: true,
              reason: `${reason} Chrome on-device Korean→English backup was used.`,
              clientDispatchedAt: firstClientDispatchedAt,
              provider: "browser-on-device",
              model: "chrome-translator",
            };
          }
        }

        setLastProvider("local");
        return {
          output: interpretLocally({
            pending: request.pending,
            mode: request.mode,
            scriptId: optionsRef.current.source === "demo" ? script.id : undefined,
            allowAnticipation: request.allowAnticipation,
          }),
          degraded: true,
          reason,
          clientDispatchedAt: firstClientDispatchedAt,
          provider: "local",
          model: "deterministic",
        };
      };

      if (optionsRef.current.source === "demo") {
        // Simulated model latency, so demo mode shows the real rhythm of the
        // console rather than an impossibly instant one.
        await abortableSleep(420, signal);
        setLastProvider("local");
        return {
          output: interpretLocally({
            pending: request.pending,
            mode: request.mode,
            scriptId: script.id,
            allowAnticipation: request.allowAnticipation,
          }),
          provider: "local",
          model: "deterministic",
        };
      }

      const clientTelemetry = clientLatencyRef.current.batch();
      const telemetryIds = clientTelemetry.map((sample) => sample.id);
      const wireRequest: InterpretRequest = clientTelemetry.length > 0 ? { ...request, clientTelemetry } : request;

      let lastFailure = "Interpretation network request failed.";

      for (let attempt = 0; attempt < INTERPRET_RETRY_DELAYS_MS.length; attempt += 1) {
        if (attempt > 0) {
          await abortableSleep(INTERPRET_RETRY_DELAYS_MS[attempt], signal);
        }

        try {
          if (firstClientDispatchedAt === undefined) firstClientDispatchedAt = Date.now();
          const response = await guardedFetch("/api/interpret", {
            method: "POST",
            signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(wireRequest),
          });

          if (response.ok) {
            if (telemetryIds.length > 0) clientLatencyRef.current.acknowledge(telemetryIds);
            const data = (await response.json()) as {
              output: unknown;
              provider?: string;
              model?: string;
              degraded?: boolean;
              reason?: string;
            };
            const parsed = interpreterOutputSchema.safeParse(data.output);
            if (!parsed.success) {
              return localFallback(
                "The interpretation response was malformed — using the local backup path.",
              );
            }

            // The server intentionally returns HTTP 200 even after every cloud
            // model fails, because the transcript must keep running. That means
            // status-code retries alone cannot detect quota exhaustion. Replace
            // its deterministic Korean-only answer with on-device English when
            // Chrome has already prepared the translator.
            if (data.provider === "local") {
              return localFallback(
                data.reason ?? "The cloud interpretation provider was unavailable.",
              );
            }

            setLastProvider(data.provider);
            return {
              output: parsed.data, degraded: data.degraded, reason: data.reason,
              clientDispatchedAt: firstClientDispatchedAt, provider: data.provider, model: data.model,
            };
          }

          lastFailure =
            response.status === 429
              ? "The free interpretation provider is temporarily rate limited."
              : `Interpretation request failed (${response.status}).`;

          if (
            !retryableInterpretStatus(response.status) ||
            attempt === INTERPRET_RETRY_DELAYS_MS.length - 1
          ) {
            return localFallback(`${lastFailure} This turn used the local backup path instead.`);
          }

          // Honour a small Retry-After when present, but never let a server-side
          // abuse window turn into a long blank patch in a live sermon.
          const serverDelay = retryAfterMs(response);
          if (serverDelay && serverDelay <= 1500) {
            await abortableSleep(serverDelay, signal);
          }
        } catch (err) {
          if (signal.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
          lastFailure = err instanceof Error ? err.message : "Interpretation network request failed.";
          if (attempt === INTERPRET_RETRY_DELAYS_MS.length - 1) {
            return localFallback(
              `${lastFailure} The connection did not recover, so this turn used the local backup path.`,
            );
          }
        }
      }

      return localFallback(`${lastFailure} This turn used the local backup path.`);
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
    // Invalidate ownership before the first await. A track-ended callback can
    // race with AudioWorklet startup; the startup tail uses the ref identity
    // as its cancellation check and must see teardown synchronously.
    const mic = micRef.current;
    micRef.current = null;
    const provider = providerRef.current;
    providerRef.current = null;
    await mic?.stop().catch(() => {});
    await provider?.disconnect().catch(() => {});
  }, []);

  const stop = useCallback(async (): Promise<EngineSnapshot> => {
    const engine = engineRef.current;

    // Seal STT first while the engine is still alive. Browser/cloud recognisers
    // may emit one last stable transcript as capture closes; stopping the engine
    // first used to throw that final sentence away.
    await teardown();
    if (!engine) {
      const finalSnapshot = emptySnapshot();
      setSnapshot(finalSnapshot);
      setPhase("ended");
      flushClientTelemetry();
      return finalSnapshot;
    }

    await sleep(FINAL_STT_SETTLE_MS);

    // Let a turn that was already in flight finish if it is close. A hard cap
    // keeps End responsive on poor venue Wi-Fi and free-provider stalls.
    const waitUntil = Date.now() + FINAL_INFLIGHT_WAIT_MS;
    while (engine.snapshot().thinking && Date.now() < waitUntil) {
      await sleep(80);
    }

    if (!engine.snapshot().thinking) {
      await Promise.race([engine.flushPending(), sleep(FINAL_FLUSH_WAIT_MS)]);
    }

    engine.stop();
    const finalSnapshot = engine.snapshot();
    setSnapshot(finalSnapshot);
    setPhase("ended");
    flushClientTelemetry();
    return finalSnapshot;
  }, [flushClientTelemetry, teardown]);

  const start = useCallback(async () => {
    if (phase === "running" || phase === "starting") return;

    const current = optionsRef.current;
    // This function is called synchronously from the launcher's Start click.
    // Kick off Translator.create() before the first await so Chrome can use the
    // user's activation to download/instantiate the local language pack.
    if (current.source !== "demo") prepareBrowserTranslator();

    setError(null);
    setPhase("starting");
    setDemoBeat(null);
    setLastProvider(undefined);
    setSnapshot(emptySnapshot());

    const engine = new InterpretationEngine({
      mode: current.mode,
      lag: current.lag,
      prep: current.prep ?? emptyPrepSheet(),
      interpret,
      resolveBible:
        current.source !== "demo" && current.resolveScripture !== false ? resolveBible : undefined,
      onTurnTiming: (timing) => {
        if (current.source === "demo") return;
        const queue = clientLatencyRef.current;
        if (timing.clientDispatchedAt !== undefined) {
          queue.add("stable_to_client_dispatch", timing.clientDispatchedAt - timing.stableAt, timing.provider, timing.model);
        }
        if (timing.hasSafe) {
          queue.add("stable_to_safe", timing.safeAt - timing.stableAt, timing.provider, timing.model);
          pendingRenderLatencyRef.current.push({ stableAt: timing.stableAt, provider: timing.provider, model: timing.model });
        }
        if (timing.hasAnticipated) {
          queue.add("stable_to_anticipated", timing.safeAt - timing.stableAt, timing.provider, timing.model);
        }
      },
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
          : ((await fetchSttCredentials("ko-KR", undefined, "live")) ?? undefined);

      // Never silently replace a real microphone with the scripted demo. That
      // looked like a successful session while listening to nothing the speaker
      // actually said. The launcher normally prevents this state; if deployment
      // configuration changes underneath an open page, fail visibly instead.
      if (current.source !== "demo" && current.source !== "webspeech" && !credentials) {
        throw new Error(
          `${current.source} speech recognition is not configured. Return to the start screen and choose Browser input.`,
        );
      }

      const effectiveSource: SttProviderId = credentials?.provider ?? current.source;

      if (effectiveSource !== current.source) {
        setError(
          `The server selected ${effectiveSource} speech recognition instead of ${current.source}.`,
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
          failTerminally(
            "Speech recognition stopped unexpectedly. Check the connection, then tap Try again.",
          );
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
  }, [phase, interpret, prepareBrowserTranslator, resolveBible, script, teardown]);

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

  useEffect(
    () => () => {
      mountedRef.current = false;
      browserTranslatorRef.current?.destroy();
      browserTranslatorRef.current = null;
      flushClientTelemetry();
      void teardown();
    },
    [flushClientTelemetry, teardown],
  );

  const correct = useCallback((from: string, to: string, english?: string) => {
    engineRef.current?.correct(from, to, english);
  }, []);

  return {
    snapshot,
    phase,
    error,
    demoBeat,
    lastProvider,
    browserTranslatorStatus,
    browserTranslatorProgress,
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
