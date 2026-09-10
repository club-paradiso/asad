/**
 * Live pipeline harness.
 *
 * Replays deterministic transcript timing through the REAL interpretation
 * engine — real stabiliser, real rolling context, real chunk store, real
 * router — and measures what the interpreter would actually experience. No
 * microphone and no audio: the timing is scripted so the measurement is
 * repeatable.
 *
 * This is the measurement that answers the Phase 2 question, because it
 * includes the parts a provider benchmark leaves out: when the engine decides
 * to fire, how long the console waits, and what happens on a fallback.
 */
import {
  InterpretationEngine,
  type EngineSnapshot,
  type ProvisionalLane,
  type TurnTiming,
} from "@/interpreter/engine/session";
import { __resetChunkIds } from "@/interpreter/engine/chunks";
import type { LaneStats } from "@/interpreter/engine/turns";
import { emptyPrepSheet, type InterpreterOutput, type LagProfile } from "@/types";
import type { InterpretRequest } from "@/lib/schema";
import { parseInterpreterOutput } from "@/lib/schema";
import { buildLiveUserPrompt, systemPromptFor } from "@/interpreter/prompts/live";
import { INTERPRETER_JSON_SCHEMA } from "@/interpreter/prompts/json-schema";
import { applyProfile, chooseProfile, type ContextProfile } from "@/interpreter/context/profiles";
import { capabilitiesFor } from "@/providers/llm/capabilities";
import { deadlineFor } from "@/providers/llm/deadlines";
import { LlmRouter } from "@/providers/llm/router";
import { parseEnv } from "@/lib/env";
import { estimateTokens, summarise, type Percentiles } from "@/lib/telemetry";
import { SERMON_DEMO } from "@/demo/sermon-script";
import { interpretLocally } from "@/providers/llm/mock";

/** Korean is spoken at roughly 6 syllables per second in a sermon register. */
const SYLLABLES_PER_SECOND = 6;

/**
 * Two-lane simulation. Everything here is virtual time on the engine's clock;
 * none of it measures a real translator or a real cloud model.
 */
export interface TwoLaneSimulation {
  /** Mocked on-device translator latency, virtual ms. */
  provisionalDelayMs: number;
  /** Mocked cloud latency range, virtual ms. Drawn per call from a seeded PRNG. */
  cloudDelayMs: { min: number; max: number };
  /** Fraction of cloud calls that get an extra `spikeMs` on top. */
  spikeRate?: number;
  spikeMs?: number;
  /** Fraction of cloud calls that throw instead of answering. */
  cloudFailureRate?: number;
  /** Fraction of translator calls that return nothing. */
  translatorFailureRate?: number;
  seed?: number;
}

export interface LiveBenchOptions {
  /** How many minutes of speech to simulate. */
  minutes: number;
  lag?: LagProfile;
  /** Speed the wall clock up; 60 means a minute of speech per second. */
  speedup?: number;
  /** Force a context profile instead of letting the router choose one. */
  forceProfile?: ContextProfile;
  /** Run the two-lane engine against mocked delayed lanes. Absent = cloud-first, as before. */
  twoLane?: TwoLaneSimulation;
  onProgress?: (message: string) => void;
}

export interface LiveBenchResult {
  minutes: number;
  lag: LagProfile;
  segments: number;
  interpretationCalls: number;
  callsPerMinute: number;
  latency: {
    providerResponse: Percentiles;
    stableToSafe: Percentiles;
  };
  tokens: {
    perCall: Percentiles;
    sessionTotal: number;
    profileCounts: Record<string, number>;
  };
  fallbacks: number;
  rateLimitEvents: number;
  providersUsed: Record<string, number>;
  /** Bounded-growth evidence for the soak test. */
  bounds: {
    finalChunks: number;
    finalSegments: number;
    peakContextTokens: number;
    maxInFlight: number;
  };
  slo: {
    stableToSafeP50Met: boolean;
    stableToSafeP95Met: boolean;
    providerP50Met: boolean;
    providerP95Met: boolean;
  };
  /** Present only for a two-lane run. Simulated numbers, labelled as such. */
  twoLane?: {
    simulation: TwoLaneSimulation;
    /** Stable Korean → provisional English applied to engine state. */
    stableToProvisional: Percentiles;
    /** Stable Korean → contextual English accepted (applied or refined). */
    stableToContextual: Percentiles;
    /** Provisional applied → contextual refinement replaced it. */
    provisionalToRefinement: Percentiles;
    lanes: LaneStats;
    cloudFailuresInjected: number;
    translatorFailuresInjected: number;
    /** Korean beats that never reached either lane successfully. Must be ~0. */
    uncoveredKorean: number;
    /** Committed chunks whose text or state changed later. Must be 0. */
    committedRewrites: number;
  };
}

/** Deterministic PRNG so a soak is repeatable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Timers on the virtual clock. Fired by the replay loop as `now` advances. */
class VirtualTimers {
  private pending: Array<{ at: number; fire: () => void }> = [];
  wait(at: number): Promise<void> {
    return new Promise((resolve) => {
      this.pending.push({ at, fire: resolve });
    });
  }
  flush(now: number): void {
    const due = this.pending.filter((t) => t.at <= now);
    this.pending = this.pending.filter((t) => t.at > now);
    for (const timer of due) timer.fire();
  }
  get size(): number {
    return this.pending.length;
  }
}

/**
 * Drive the engine on a virtual clock.
 *
 * The engine takes its clock by injection precisely so this is possible: a
 * 45-minute session can be measured in seconds without faking the logic.
 */
export async function runLiveBenchmark(options: LiveBenchOptions): Promise<LiveBenchResult> {
  __resetChunkIds();
  const lag = options.lag ?? "balanced";
  const log = options.onProgress ?? (() => {});

  const env = parseEnv();
  const router = new LlmRouter(env);

  let now = 0;
  const clock = () => now;

  let snapshot: EngineSnapshot | null = null;
  const providerLatencies: number[] = [];
  const stableToSafe: number[] = [];
  const tokenTotals: number[] = [];
  const profileCounts: Record<string, number> = {};
  const providersUsed: Record<string, number> = {};
  let calls = 0;
  let fallbacks = 0;
  let rateLimitEvents = 0;
  let peakContextTokens = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  /** Timestamp of the stabilised Korean that triggered the current request. */
  let triggerAt = 0;

  /* --- Two-lane simulation state ---------------------------------------- */
  const twoLane = options.twoLane;
  const random = mulberry32(twoLane?.seed ?? 20260910);
  const timers = new VirtualTimers();
  const stableToProvisional: number[] = [];
  const stableToContextual: number[] = [];
  const provisionalToRefinement: number[] = [];
  let cloudFailuresInjected = 0;
  let translatorFailuresInjected = 0;
  /** Beats whose Korean reached a lane that answered. */
  const coveredKorean = new Set<string>();
  const spokenBeats: string[] = [];
  /** Committed text by chunk id; any later difference is a rewrite of history. */
  const committed = new Map<string, string>();
  let committedRewrites = 0;

  const cloudDelay = (): number => {
    if (!twoLane) return 0;
    const { min, max } = twoLane.cloudDelayMs;
    let delay = min + Math.floor(random() * Math.max(0, max - min));
    if (twoLane.spikeRate && random() < twoLane.spikeRate) delay += twoLane.spikeMs ?? 4_000;
    return delay;
  };

  const provisionalLane: ProvisionalLane | undefined = twoLane
    ? {
        isReady: () => true,
        provider: "browser-on-device",
        model: "chrome-translator",
        translate: async (text, signal): Promise<InterpreterOutput | null> => {
          await timers.wait(now + twoLane.provisionalDelayMs);
          if (signal.aborted) return null;
          if (twoLane.translatorFailureRate && random() < twoLane.translatorFailureRate) {
            translatorFailuresInjected += 1;
            return null;
          }
          // The demo script's authored English stands in for the on-device
          // translator; it exists for every beat and is deterministic.
          const output = interpretLocally({
            pending: text,
            mode: "sermon",
            scriptId: SERMON_DEMO.id,
            allowAnticipation: false,
          });
          for (const beat of spokenBeats) if (text.includes(beat)) coveredKorean.add(beat);
          return { safeChunks: output.safeChunks, confidence: output.confidence };
        },
      }
    : undefined;

  const onTurnTiming = (timing: TurnTiming) => {
    if (timing.lane === "provisional") {
      if (timing.hasSafe) stableToProvisional.push(timing.safeAt - timing.stableAt);
      return;
    }
    if (timing.outcome === "applied" || timing.outcome === "refined") {
      stableToContextual.push(timing.safeAt - timing.stableAt);
    }
    if (timing.outcome === "refined" && timing.provisionalAppliedAt !== undefined) {
      provisionalToRefinement.push(timing.safeAt - timing.provisionalAppliedAt);
    }
  };

  const auditCommitted = (next: EngineSnapshot) => {
    for (const chunk of next.chunks) {
      const was = committed.get(chunk.id);
      if (was === undefined) {
        if (chunk.state === "committed") committed.set(chunk.id, chunk.text);
      } else if (chunk.state !== "committed" || chunk.text !== was) {
        committedRewrites += 1;
      }
    }
  };

  const interpret = async (request: InterpretRequest): Promise<{ output: ReturnType<typeof parseInterpreterOutput> }> => {
    calls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);

    const preferred = router.preferred() ?? "local";
    const caps = capabilitiesFor(preferred);
    const decision = options.forceProfile
      ? { profile: options.forceProfile, reason: "forced" }
      : chooseProfile({
          recommendedLiveTokens: caps.recommendedLiveContextTokens,
          quotaPressure: router.pressureFor(preferred),
          lag,
        });
    profileCounts[decision.profile] = (profileCounts[decision.profile] ?? 0) + 1;

    const budgeted = { ...request, context: applyProfile(request.context, decision.profile) };
    const system = systemPromptFor(request.mode, {
      schemaEnforced: caps.structuredOutput,
      ultraCompact: decision.profile === "ultra-compact",
    });
    const user = buildLiveUserPrompt(budgeted);
    const tokens = estimateTokens(system) + estimateTokens(user);
    tokenTotals.push(tokens);
    peakContextTokens = Math.max(peakContextTokens, tokens);

    try {
      const result = await router.complete(
        {
          system,
          user,
          maxOutputTokens: 700,
          temperature: 0.2,
          jsonSchema: INTERPRETER_JSON_SCHEMA,
          thinking: "none",
        },
        {
          deadlineMs: deadlineFor({ workflow: "live", lag, provider: preferred }),
          estimatedTokens: tokens,
          validate: (response) => parseInterpreterOutput(response.text) !== null,
        },
      );

      providerLatencies.push(result.response.latencyMs);
      providersUsed[result.provider] = (providersUsed[result.provider] ?? 0) + 1;
      if (result.degraded) fallbacks += 1;
      for (const attempt of result.attempts) {
        if (attempt.failureKind === "rate_limited" || attempt.failureKind === "quota_exhausted") {
          rateLimitEvents += 1;
        }
      }

      if (twoLane) {
        // The local provider answered instantly; hold the answer for the
        // simulated cloud round trip so the fast lane genuinely runs ahead.
        await timers.wait(now + cloudDelay());
        if (twoLane.cloudFailureRate && random() < twoLane.cloudFailureRate) {
          cloudFailuresInjected += 1;
          throw new Error("simulated cloud failure");
        }
        for (const beat of spokenBeats) if (request.pending.includes(beat)) coveredKorean.add(beat);
      }

      // Stabilised Korean → English available to render.
      stableToSafe.push(now - triggerAt + result.response.latencyMs);
      return { output: parseInterpreterOutput(result.response.text) };
    } finally {
      inFlight -= 1;
    }
  };

  const engine = new InterpretationEngine({
    mode: "sermon",
    lag,
    prep: emptyPrepSheet(),
    now: clock,
    onChange: (next) => {
      snapshot = next;
      if (twoLane) auditCommitted(next);
    },
    interpret: async (request) => {
      const { output } = await interpret(request);
      if (!output) throw new Error("schema validation failed");
      return { output, provider: "local", model: "deterministic" };
    },
    provisional: provisionalLane,
    onTurnTiming: twoLane ? onTurnTiming : undefined,
  });

  engine.start();

  /* --- Replay ------------------------------------------------------------ */
  const beats = SERMON_DEMO.beats;
  const targetMs = options.minutes * 60_000;
  let segments = 0;
  let beatIndex = 0;

  while (now < targetMs) {
    const beat = beats[beatIndex % beats.length];
    beatIndex += 1;

    // How long this sentence actually takes to SAY, not how long the demo
    // spends animating it. Korean runs at roughly 6 syllables per second, and
    // one Hangul character is one syllable — so character count is a good
    // proxy. Without this the harness replays ~4x faster than real speech and
    // reports a call rate no sermon would ever produce.
    const syllables = [...beat.korean].filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0xac00 && code <= 0xd7a3;
    }).length;
    const speakingMs = Math.max(1200, Math.round((syllables / SYLLABLES_PER_SECOND) * 1000));

    const partials = beat.partials ?? [];
    const step = partials.length > 0 ? speakingMs / (partials.length + 1) : speakingMs;
    for (const partial of partials) {
      now += step;
      timers.flush(now);
      engine.handlePartial(partial);
    }
    now += step;
    timers.flush(now);

    triggerAt = now;
    spokenBeats.push(beat.korean);
    engine.handleStable(beat.korean);
    segments += 1;

    // Advance the clock in small steps so the engine's tick logic runs the way
    // it does live, rather than jumping past its own timers.
    const hold = beat.holdMs ?? 800;
    for (let elapsed = 0; elapsed < hold; elapsed += 200) {
      now += 200;
      timers.flush(now);
      engine.tick();
      // Let any in-flight interpretation promise settle.
      await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));
    }

    if (segments % 50 === 0) {
      log(`  ${Math.round(now / 60_000)} min · ${segments} segments · ${calls} calls`);
    }
  }

  // Let the tail of the session settle before ending it, as End does live.
  for (let elapsed = 0; twoLane && elapsed < 8_000 && timers.size > 0; elapsed += 200) {
    now += 200;
    timers.flush(now);
    engine.tick();
    await new Promise((resolve) => setImmediate(resolve));
  }
  const lanes = engine.laneStats();
  engine.stop();
  // Drain anything still settling.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const state = snapshot as unknown as EngineSnapshot;
  const providerPct = summarise(providerLatencies);
  const safePct = summarise(stableToSafe);

  return {
    minutes: options.minutes,
    lag,
    segments,
    interpretationCalls: calls,
    callsPerMinute: Number((calls / options.minutes).toFixed(2)),
    latency: { providerResponse: providerPct, stableToSafe: safePct },
    tokens: {
      perCall: summarise(tokenTotals),
      sessionTotal: tokenTotals.reduce((a, b) => a + b, 0),
      profileCounts,
    },
    fallbacks,
    rateLimitEvents,
    providersUsed,
    bounds: {
      finalChunks: state?.chunks.length ?? 0,
      finalSegments: state?.segments.length ?? 0,
      peakContextTokens,
      maxInFlight,
    },
    slo: {
      stableToSafeP50Met: safePct.count > 0 && safePct.p50 <= 2500,
      stableToSafeP95Met: safePct.count > 0 && safePct.p95 <= 4500,
      providerP50Met: providerPct.count > 0 && providerPct.p50 <= 1500,
      providerP95Met: providerPct.count > 0 && providerPct.p95 <= 3000,
    },
    ...(twoLane
      ? {
          twoLane: {
            simulation: twoLane,
            stableToProvisional: summarise(stableToProvisional),
            stableToContextual: summarise(stableToContextual),
            provisionalToRefinement: summarise(provisionalToRefinement),
            lanes,
            cloudFailuresInjected,
            translatorFailuresInjected,
            uncoveredKorean: spokenBeats.filter((beat) => !coveredKorean.has(beat)).length,
            committedRewrites,
          },
        }
      : {}),
  };
}
