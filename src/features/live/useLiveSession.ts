"use client";

/**
 * React binding for the interpretation engine.
 *
 * Owns the things the engine deliberately does not: the speech provider, the
 * microphone, the clock interval, the network calls, the audio-activity
 * signal and persistent memory. The engine itself stays a pure state machine
 * so it can be tested without a browser.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BibleReference,
  ConnectionState,
  ContextDomain,
  LagProfile,
  LanguagePair,
  PrepSheet,
  StableTranscriptMeta,
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
  STT_PROVIDER_INFO,
  createSpeechProvider,
  fetchSttCredentials,
  type SpeechProvider,
  type SttProviderId,
  type SttStatus,
} from "@/providers/stt";
import type { DemoBeat, DemoScript } from "@/demo/types";
import { demoScriptFor } from "@/demo/sermon-script";
import { canonicalPair, isKoreanToEnglish, languageDisplayName } from "@/languages/registry";
import {
  loadPersistentMemory,
  persistLearnings,
  savePersistentMemory,
  seedFromPersistent,
} from "@/interpreter/memory/persistent";
import { layerForDomain } from "@/types";
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
/** No partial for this long after the last one means the speaker paused. */
const SPEECH_SILENCE_MS = 1_400;
/** Raw-audio RMS above this is speech; below it for a while is silence. */
const SPEECH_RMS_THRESHOLD = 0.012;
const SPEECH_ONSET_QUIET_MS = 600;

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

/**
 * What the microphone is doing, as far as the console should say. Derived
 * from the recogniser's status and from speech activity — a raw-audio level
 * where the browser hands us frames, otherwise interim-result cadence.
 */
export type AudioActivity = "off" | "mic-active" | "speech" | "silence" | "reconnecting" | "unavailable";

export interface LiveSessionOptions {
  /** Canonical registry ids. */
  languagePair: LanguagePair;
  /** `auto` unless the interpreter overrode it. */
  context: ContextDomain;
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
  /** Keep user-confirmed corrections and bindings for future sessions. */
  rememberCorrections?: boolean;
}

export interface CorrectionOptions {
  english?: string;
  remember?: boolean;
  scope?: "source" | "target" | "entity";
}

const emptySnapshot = (pair: LanguagePair): EngineSnapshot => ({
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
  languagePair: pair,
  domain: { domain: "generic", confidence: 0, source: "default", signals: [] },
});

/** Root-mean-square of a PCM16 frame. Cheap enough to run on every 50 ms frame. */
function frameRms(frame: ArrayBuffer): number {
  const samples = new Int16Array(frame);
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

export function useLiveSession(options: LiveSessionOptions) {
  const pair = useMemo(() => canonicalPair(options.languagePair), [options.languagePair]);
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => emptySnapshot(pair));
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [demoBeat, setDemoBeat] = useState<DemoBeat | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [audio, setAudio] = useState<AudioActivity>("off");
  /**
   * Which provider answered the most recent turn. The console shows this only
   * when it is the deterministic local interpreter, because that is the case
   * where the English is not a translation and has to be read differently.
   */
  const [lastProvider, setLastProvider] = useState<string | undefined>(undefined);
  const [browserTranslatorStatus, setBrowserTranslatorStatus] =
    useState<BrowserTranslatorStatus>("unsupported");

  const engineRef = useRef<InterpretationEngine | null>(null);
  const providerRef = useRef<SpeechProvider | null>(null);
  const micRef = useRef<MicrophoneCapture | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserTranslatorRef = useRef<BrowserTranslatorSession | null>(null);
  const browserTranslatorPreparationRef = useRef<Promise<BrowserTranslatorSession | null> | null>(
    null,
  );
  const browserTranslatorPairRef = useRef<string>("");
  const mountedRef = useRef(true);
  /** The last message the speech provider itself reported, if any. */
  const providerErrorRef = useRef<string | null>(null);
  const clientLatencyRef = useRef(new ClientLatencyQueue());
  const pendingRenderLatencyRef = useRef<RenderMarker[]>([]);
  /** When each turn's provisional English reached the screen, by turn id. */
  const provisionalRenderedAtRef = useRef(new Map<number, number>());
  /** Speech-activity clocks for T0/T1/T2. Times only. */
  const speechRef = useRef<{
    onsetAt: number | null;
    firstPartialAt: number | null;
    lastPartialAt: number;
    quietSince: number;
    silenceTimer: ReturnType<typeof setTimeout> | null;
    status: SttStatus;
  }>({ onsetAt: null, firstPartialAt: null, lastPartialAt: 0, quietSince: 0, silenceTimer: null, status: "idle" });

  const demoAvailable = isKoreanToEnglish(pair);
  const script: DemoScript = useMemo(
    () => demoScriptFor(layerForDomain(options.context === "auto" ? "sermon" : options.context)),
    [options.context],
  );

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
   * Begin the browser's on-device translator for this pair while the Start
   * click still carries user activation. If a model pack has to download, the
   * console exposes that state; interpretation never waits on the download
   * mid-sentence. A pair change discards a translator built for another pair.
   */
  const prepareBrowserTranslator = useCallback((currentPair: LanguagePair) => {
    const key = `${currentPair.source}>${currentPair.target}`;
    if (browserTranslatorRef.current && browserTranslatorPairRef.current === key) {
      setBrowserTranslatorStatus("ready");
      return;
    }
    if (browserTranslatorRef.current) {
      browserTranslatorRef.current.destroy();
      browserTranslatorRef.current = null;
    }
    if (browserTranslatorPreparationRef.current) return;

    const preparation = beginBrowserTranslatorPreparation({ pair: currentPair });
    if (!preparation.supported) {
      setBrowserTranslatorStatus("unsupported");
      return;
    }

    setBrowserTranslatorStatus("preparing");
    browserTranslatorPairRef.current = key;
    browserTranslatorPreparationRef.current = preparation.session;
    void preparation.session
      .then((translator) => {
        if (!mountedRef.current || browserTranslatorPairRef.current !== key) {
          translator?.destroy();
          return;
        }
        if (translator) {
          browserTranslatorRef.current = translator;
          setBrowserTranslatorStatus("ready");
        } else {
          setBrowserTranslatorStatus("failed");
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
          pair: request.languagePair,
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
            pair: request.languagePair,
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
   * The provisional lane: the browser's on-device translator, and only when
   * it is genuinely ready. `isReady` is answered from the ref synchronously,
   * so a language pack that is still downloading simply means cloud-first for
   * that turn. Demo mode has no fast lane; its scripted English is already
   * instant.
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
   * cloud got round to agreeing. `stable_to_first_useful` is the interpreter's
   * number: the first target-language content for the turn, whichever path.
   */
  const recordTurnTiming = useCallback((timing: TurnTiming) => {
    const queue = clientLatencyRef.current;
    const { stableAt, provider, model, turnId } = timing;

    if (timing.firstUseful) {
      queue.add("stable_to_first_useful", timing.safeAt - stableAt, provider, model);
    }

    if (timing.lane === "provisional") {
      if (!timing.hasSafe) return;
      if (provider === "translation-memory") {
        queue.add("stable_to_memory_hit", timing.safeAt - stableAt, provider, model);
      }
      queue.add("stable_to_provisional", timing.safeAt - stableAt, provider, model);
      pendingRenderLatencyRef.current.push({ stage: "stable_to_provisional_render", stableAt, turnId, provider, model });
      return;
    }

    if (timing.clientDispatchedAt !== undefined) {
      queue.add("stable_to_client_dispatch", timing.clientDispatchedAt - stableAt, provider, model);
    }
    if (timing.qualityStartAt !== undefined) {
      queue.add("quality_repair_start", timing.qualityStartAt - stableAt, provider, model);
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
        pendingRenderLatencyRef.current.push({ stage: "quality_repair_rendered", stableAt, turnId, provider, model });
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

  /* --- Audio activity --------------------------------------------------- */

  const clearSilenceTimer = () => {
    const speech = speechRef.current;
    if (speech.silenceTimer) clearTimeout(speech.silenceTimer);
    speech.silenceTimer = null;
  };

  /** Interim text arrived: the speaker is talking. T1 when it is the first since a pause. */
  const notePartial = useCallback(() => {
    const speech = speechRef.current;
    const now = Date.now();
    if (speech.firstPartialAt === null) {
      speech.firstPartialAt = now;
      if (speech.onsetAt !== null && optionsRef.current.source !== "demo") {
        clientLatencyRef.current.add("speech_to_first_partial", now - speech.onsetAt);
      }
    }
    speech.lastPartialAt = now;
    if (speech.status === "listening") setAudio("speech");
    clearSilenceTimer();
    speech.silenceTimer = setTimeout(() => {
      speech.silenceTimer = null;
      speech.firstPartialAt = null;
      speech.onsetAt = null;
      if (speechRef.current.status === "listening") setAudio("silence");
    }, SPEECH_SILENCE_MS);
  }, []);

  /** Final text arrived: T2. */
  const noteStable = useCallback(() => {
    const speech = speechRef.current;
    if (speech.firstPartialAt !== null && optionsRef.current.source !== "demo") {
      clientLatencyRef.current.add("partial_to_stable", Date.now() - speech.firstPartialAt);
    }
    speech.firstPartialAt = null;
    speech.onsetAt = null;
  }, []);

  /** Raw audio frame (providers that take PCM): T0 is the onset after quiet. */
  const noteFrame = useCallback((frame: ArrayBuffer) => {
    const speech = speechRef.current;
    const now = Date.now();
    const rms = frameRms(frame);
    if (rms >= SPEECH_RMS_THRESHOLD) {
      if (speech.onsetAt === null && now - speech.quietSince >= SPEECH_ONSET_QUIET_MS) {
        speech.onsetAt = now;
        if (speech.status === "listening") setAudio("speech");
      }
      speech.quietSince = now;
    }
  }, []);

  const mapAudio = (status: SttStatus): AudioActivity => {
    switch (status) {
      case "listening":
        return "mic-active";
      case "reconnecting":
      case "connecting":
        return "reconnecting";
      case "error":
        return "unavailable";
      default:
        return "off";
    }
  };

  const teardown = useCallback(async () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    clearSilenceTimer();
    // Invalidate ownership before the first await. A track-ended callback can
    // race with AudioWorklet startup; the startup tail uses the ref identity
    // as its cancellation check and must see teardown synchronously.
    const mic = micRef.current;
    micRef.current = null;
    const provider = providerRef.current;
    providerRef.current = null;
    await mic?.stop().catch(() => {});
    await provider?.disconnect().catch(() => {});
    setAudio("off");
  }, []);

  /** Keep what the session learned, under the user's setting. Never transcripts. */
  const persist = useCallback((engine: InterpretationEngine) => {
    if (optionsRef.current.rememberCorrections === false) return;
    if (optionsRef.current.source === "demo") return;
    try {
      const learnings = engine.learnings();
      if (
        learnings.corrections.length === 0 &&
        learnings.entities.length === 0 &&
        learnings.memory.length === 0
      ) {
        return;
      }
      const next = persistLearnings(loadPersistentMemory(), {
        ...learnings,
        pair: engine.snapshot().languagePair,
        now: Date.now(),
      });
      savePersistentMemory(next);
    } catch {
      // Persistence is a convenience; a full or private store is not an error.
    }
  }, []);

  const stop = useCallback(async (): Promise<EngineSnapshot> => {
    const engine = engineRef.current;

    // Seal STT first while the engine is still alive. Browser/cloud recognisers
    // may emit one last stable transcript as capture closes; stopping the engine
    // first used to throw that final sentence away.
    await teardown();
    if (!engine) {
      const finalSnapshot = emptySnapshot(pair);
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
    persist(engine);
    const finalSnapshot = engine.snapshot();
    setSnapshot(finalSnapshot);
    setPhase("ended");
    flushClientTelemetry();
    return finalSnapshot;
  }, [flushClientTelemetry, pair, persist, teardown]);

  const start = useCallback(async () => {
    if (phase === "running" || phase === "starting") return;

    const current = optionsRef.current;
    const currentPair = canonicalPair(current.languagePair);
    // This function is called synchronously from the launcher's Start click.
    // Kick off Translator.create() before the first await so the browser can
    // use the user's activation to download/instantiate the language pack.
    if (current.source !== "demo") prepareBrowserTranslator(currentPair);

    setError(null);
    providerErrorRef.current = null;
    setPhase("starting");
    setDemoBeat(null);
    setLastProvider(undefined);
    setSnapshot(emptySnapshot(currentPair));
    pendingRenderLatencyRef.current = [];
    provisionalRenderedAtRef.current.clear();
    speechRef.current = { onsetAt: null, firstPartialAt: null, lastPartialAt: 0, quietSince: Date.now(), silenceTimer: null, status: "idle" };

    // Earlier sessions' confirmed corrections and bindings, when allowed.
    const persisted =
      current.rememberCorrections === false || current.source === "demo"
        ? undefined
        : seedFromPersistent(loadPersistentMemory(), currentPair);

    const engine = new InterpretationEngine({
      languagePair: currentPair,
      context: current.context,
      lag: current.lag,
      prep: current.prep ?? emptyPrepSheet(),
      persisted,
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
    //
    // `fallback` really is a fallback. A recogniser reports its own failure
    // before it reports the status change, and it knows things this does not:
    // a denied microphone was being described here as a connection problem,
    // sending the interpreter to check the venue Wi-Fi over a permission
    // prompt. Whatever the provider said wins.
    const failTerminally = (fallback: string) => {
      const message = providerErrorRef.current ?? fallback;
      setError(message);
      engine.stop();
      void teardown().finally(() => {
        if (engineRef.current !== engine) return;
        engine.setConnection("error");
        engine.setHealth("stt", "down", message);
        setAudio("unavailable");
        setPhase("idle");
      });
    };

    try {
      if (current.source === "demo" && !isKoreanToEnglish(currentPair)) {
        throw new Error(
          `The scripted demo is Korean → English. Choose Browser input for ${languageDisplayName(currentPair.source)}.`,
        );
      }

      // The recogniser gets only the highest-value terms. In the worship layer
      // this includes community-glossary terms that actually occur in today's prep.
      const layer = layerForDomain(current.context === "auto" ? "generic" : current.context);
      const hints = buildSttHints(layer, current.prep, undefined, currentPair.source);

      const credentials =
        current.source === "demo" || current.source === "webspeech"
          ? undefined
          : ((await fetchSttCredentials(currentPair.source, undefined, "live")) ?? undefined);

      // Never silently replace a real microphone with the scripted demo. That
      // looked like a successful session while listening to nothing the speaker
      // actually said. The launcher normally prevents this state; if deployment
      // configuration changes underneath an open page, fail visibly instead.
      if (current.source !== "demo" && current.source !== "webspeech" && !credentials) {
        throw new Error(
          `${STT_PROVIDER_INFO[current.source]?.label ?? current.source} speech recognition is not set up on this deployment. Go back and choose Browser input.`,
        );
      }

      const effectiveSource: SttProviderId = credentials?.provider ?? current.source;

      if (effectiveSource !== current.source) {
        // Not a fault, but not silent either: the interpreter agreed to send
        // audio to one provider and it is going to a different one.
        setError(
          `Speech recognition switched to ${STT_PROVIDER_INFO[effectiveSource]?.label ?? effectiveSource} — the input you chose is not available here. Voice is sent to that provider instead.`,
        );
      }

      const provider = createSpeechProvider({
        provider: effectiveSource,
        language: currentPair.source,
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

      provider.onPartial((text) => {
        notePartial();
        engineRef.current?.handlePartial(text);
      });
      provider.onStable((text: string, meta?: StableTranscriptMeta) => {
        noteStable();
        engineRef.current?.handleStable(text, meta);
      });
      provider.onError((err) => {
        providerErrorRef.current = err.message;
        setError(err.message);
      });
      provider.onStatus((status) => {
        speechRef.current.status = status;
        setAudio(mapAudio(status));
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
          onFrame: (frame) => {
            noteFrame(frame);
            provider.sendAudio(frame);
          },
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
        setAudio(err instanceof Error && err.name === "NotAllowedError" ? "unavailable" : "off");
        setPhase("idle");
      }
    }
  }, [phase, interpret, noteFrame, notePartial, noteStable, prepareBrowserTranslator, provisionalLane, recordTurnTiming, resolveBible, script, teardown]);

  // Push setting changes into the running engine rather than restarting it.
  useEffect(() => {
    engineRef.current?.setContext(options.context);
  }, [options.context]);

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

  const correct = useCallback((from: string, to: string, correction?: CorrectionOptions) => {
    engineRef.current?.correct(from, to, {
      ...correction,
      remember: correction?.remember ?? optionsRef.current.rememberCorrections !== false,
    });
  }, []);

  const setContext = useCallback((context: ContextDomain) => {
    engineRef.current?.setContext(context);
  }, []);

  return {
    snapshot,
    phase,
    error,
    demoBeat,
    lastProvider,
    browserTranslatorStatus,
    startedAt,
    script,
    demoAvailable,
    audio,
    start,
    stop,
    correct,
    setContext,
    dismissError: useCallback(() => {
      providerErrorRef.current = null;
      setError(null);
    }, []),
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
