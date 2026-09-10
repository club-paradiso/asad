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
import {
  InterpretationEngine,
  type ContextualTurnInfo,
  type EngineSnapshot,
  type InterpretResult,
  type ProvisionalLane,
  type TurnTiming,
} from "@/interpreter/engine/session";
import { buildSttHints } from "@/interpreter/glossary/stt-hints";
import { interpretLocally } from "@/providers/llm/mock";
import {
  beginBrowserTranslatorPreparation,
  translateWithBrowserTranslator,
  type BrowserTranslatorSession,
  type BrowserTranslatorStatus,
} from "@/providers/llm/browser-translator";
import type { ClientLatencyStage } from "@/lib/schema";
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
import {
  abortableSleep,
  BROWSER_TRANSLATOR_MODEL,
  BROWSER_TRANSLATOR_PROVIDER,
  createCloudLane,
  type CloudLane,
} from "./cloud-lane";

/** How often the engine's clock advances. 100ms keeps trigger jitter below one tenth of a second. */
const TICK_MS = 100;
/** Give recognisers a moment to emit their final result after capture is sealed. */
const FINAL_STT_SETTLE_MS = 160;
/** Do not let End hang indefinitely on a free model or bad venue network. */
const FINAL_INFLIGHT_WAIT_MS = 2200;
const FINAL_FLUSH_WAIT_MS = 2800;
/** Provisional render times kept for turns whose contextual result is still out. */
const MAX_PROVISIONAL_RENDER_MARKS = 64;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A chunk update whose React commit time is still to be measured. Ids and clocks only. */
interface RenderMarker {
  stage: ClientLatencyStage;
  stableAt: number;
  turnId: number;
  provider?: string;
  model?: string;
}

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
  const pendingRenderLatencyRef = useRef<RenderMarker[]>([]);
  /** When each turn's provisional English reached the screen, by turn id. */
  const provisionalRenderedAtRef = useRef(new Map<number, number>());

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
      clientLatencyRef.current.add(marker.stage, renderedAt - marker.stableAt, marker.provider, marker.model);
      if (marker.stage === "stable_to_provisional_render") {
        const marks = provisionalRenderedAtRef.current;
        marks.set(marker.turnId, renderedAt);
        if (marks.size > MAX_PROVISIONAL_RENDER_MARKS) {
          const oldest = marks.keys().next().value;
          if (oldest !== undefined) marks.delete(oldest);
        }
      }
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

  /**
   * The contextual lane. Demo mode never touches the network; everything else
   * goes through the cloud lane, whose retry, quota-bypass and fallback rules
   * live in `cloud-lane.ts`.
   */
  const cloudLaneRef = useRef<CloudLane | null>(null);
  /** Built lazily from Start's event handler, never during render. */
  const cloudLane = useCallback((): CloudLane => {
    cloudLaneRef.current ??= createCloudLane({
      fetchImpl: (input, init) => guardedFetch(input, init),
      browserTranslator: () => browserTranslatorRef.current,
      local: (request) =>
        interpretLocally({
          pending: request.pending,
          mode: request.mode,
          allowAnticipation: request.allowAnticipation,
        }),
      telemetry: clientLatencyRef.current,
      onProvider: (provider) => setLastProvider(provider),
    });
    return cloudLaneRef.current;
  }, []);

  const interpret = useCallback(
    async (
      request: InterpretRequest,
      signal: AbortSignal,
      turn: ContextualTurnInfo,
    ): Promise<InterpretResult> => {
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
      return cloudLane().interpret(request, signal, turn);
    },
    [cloudLane, script.id],
  );

  /**
   * The provisional lane: Chrome's on-device translator, and only when it is
   * genuinely ready. `isReady` is answered from the ref synchronously, so a
   * language pack that is still downloading simply means cloud-first for that
   * turn. Demo mode has no fast lane; its scripted English is already instant.
   */
  const provisionalLane = useMemo<ProvisionalLane>(
    () => ({
      isReady: () => optionsRef.current.source !== "demo" && browserTranslatorRef.current !== null,
      translate: (text, signal) => {
        const translator = browserTranslatorRef.current;
        if (!translator) return Promise.resolve(null);
        return translateWithBrowserTranslator(translator, text, signal);
      },
      provider: BROWSER_TRANSLATOR_PROVIDER,
      model: BROWSER_TRANSLATOR_MODEL,
    }),
    [],
  );

  /**
   * Turn timings into transcript-free samples. Ids, clocks and labels only.
   *
   * `stable_to_safe` / `stable_to_render` keep their meaning — when the turn's
   * FINAL English reached state / screen. When the contextual lane leaves the
   * provisional line standing, that final English was the provisional one, so
   * the sample points at the provisional clock rather than at the moment the
   * cloud got round to agreeing.
   */
  const recordTurnTiming = useCallback((timing: TurnTiming) => {
    const queue = clientLatencyRef.current;
    const { stableAt, provider, model, turnId } = timing;

    if (timing.lane === "provisional") {
      if (!timing.hasSafe) return;
      queue.add("stable_to_provisional", timing.safeAt - stableAt, provider, model);
      pendingRenderLatencyRef.current.push({ stage: "stable_to_provisional_render", stableAt, turnId, provider, model });
      return;
    }

    if (timing.clientDispatchedAt !== undefined) {
      queue.add("stable_to_client_dispatch", timing.clientDispatchedAt - stableAt, provider, model);
    }

    switch (timing.outcome) {
      case "applied":
        if (timing.hasSafe) {
          queue.add("stable_to_safe", timing.safeAt - stableAt, provider, model);
          pendingRenderLatencyRef.current.push({ stage: "stable_to_render", stableAt, turnId, provider, model });
        }
        break;
      case "refined":
        queue.add("stable_to_safe", timing.safeAt - stableAt, provider, model);
        pendingRenderLatencyRef.current.push({ stage: "stable_to_render", stableAt, turnId, provider, model });
        if (timing.provisionalAppliedAt !== undefined) {
          queue.add("provisional_to_refinement", timing.safeAt - timing.provisionalAppliedAt, provider, model);
        }
        break;
      case "kept":
      case "discarded": {
        // The provisional line is the final line.
        if (timing.provisionalAppliedAt !== undefined) {
          queue.add("stable_to_safe", timing.provisionalAppliedAt - stableAt, BROWSER_TRANSLATOR_PROVIDER, BROWSER_TRANSLATOR_MODEL);
          const renderedAt = provisionalRenderedAtRef.current.get(turnId);
          if (renderedAt !== undefined) {
            queue.add("stable_to_render", renderedAt - stableAt, BROWSER_TRANSLATOR_PROVIDER, BROWSER_TRANSLATOR_MODEL);
            provisionalRenderedAtRef.current.delete(turnId);
          }
        }
        if (timing.outcome === "discarded") {
          queue.add("refinement_discarded_committed", timing.safeAt - stableAt, provider, model);
        }
        break;
      }
      case "stale":
        queue.add("contextual_result_stale", timing.safeAt - stableAt, provider, model);
        break;
      default:
        break;
    }

    if (timing.hasAnticipated) {
      queue.add("stable_to_anticipated", timing.safeAt - stableAt, provider, model);
    }
  }, []);

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
    pendingRenderLatencyRef.current = [];
    provisionalRenderedAtRef.current.clear();

    const engine = new InterpretationEngine({
      mode: current.mode,
      lag: current.lag,
      prep: current.prep ?? emptyPrepSheet(),
      interpret,
      provisional: provisionalLane,
      resolveBible:
        current.source !== "demo" && current.resolveScripture !== false ? resolveBible : undefined,
      onTurnTiming: (timing) => {
        if (current.source === "demo") return;
        recordTurnTiming(timing);
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
  }, [phase, interpret, prepareBrowserTranslator, provisionalLane, recordTurnTiming, resolveBible, script, teardown]);

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
