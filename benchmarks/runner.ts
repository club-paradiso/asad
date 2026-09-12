/**
 * Benchmark runner.
 *
 * Runs the dataset against every provider that has a key configured, and skips
 * the rest cleanly. Requiring every key would make the benchmark unrunnable,
 * which would make it unrun.
 */
import { parseEnv } from "@/lib/env";
import { parseInterpreterOutput } from "@/lib/schema";
import {
  buildLiveUserPrompt,
  systemPromptFor,
} from "@/interpreter/prompts/live";
import { INTERPRETER_JSON_SCHEMA } from "@/interpreter/prompts/json-schema";
import { applyProfile, chooseProfile, type ContextProfile } from "@/interpreter/context/profiles";
// The same conservative, model-aware view `/api/interpret` uses. Imported from
// the module rather than the `@/providers/llm` barrel, which pulls in
// `server-only` and cannot load under tsx.
import { promptCapabilitiesFor } from "@/providers/llm/schema-enforcement";
import { LocalLlmProvider } from "@/providers/llm/mock";
import { createProvider } from "@/providers/llm/factory";
import { toLlmError } from "@/providers/llm/errors";
import type {
  LlmProvider,
  LlmProviderId,
  LlmUsage,
} from "@/providers/llm/types";
import type { InterpretRequest } from "@/lib/schema";
import { BENCH_CASES, type BenchCase } from "./dataset";
import {
  scoreCase,
  scoreProvider,
  type CaseResult,
  type ProviderScore,
} from "./score";

export interface RunnerOptions {
  /** Restrict to these providers. */
  only?: LlmProviderId[];
  /** Per-request deadline. Generous relative to live, to measure honestly. */
  deadlineMs?: number;
  /** Repeat each case N times and keep the median latency. */
  repeats?: number;
  onProgress?: (message: string) => void;
}

export interface BenchmarkRun {
  startedAt: string;
  finishedAt: string;
  deadlineMs: number;
  repeats: number;
  cases: number;
  scores: ProviderScore[];
  skipped: Array<{ provider: LlmProviderId; reason: string }>;
  environment: {
    node: string;
    reachability: Record<string, boolean>;
  };
}

/** Build the provider instances we actually have keys for. */
export function availableProviders(env = parseEnv()): {
  available: Array<{ id: LlmProviderId; provider: LlmProvider; paid: boolean }>;
  skipped: Array<{ provider: LlmProviderId; reason: string }>;
} {
  const available: Array<{
    id: LlmProviderId;
    provider: LlmProvider;
    paid: boolean;
  }> = [];
  const skipped: Array<{ provider: LlmProviderId; reason: string }> = [];

  // The local interpreter always participates: it is the floor every cloud
  // provider has to beat to be worth its latency and its privacy cost.
  available.push({
    id: "local",
    provider: new LocalLlmProvider(),
    paid: false,
  });

  for (const id of [
    "gemini",
    "groq",
    "openrouter",
    "openai",
    "anthropic",
  ] as const) {
    const config = env.llm.providers[id];
    if (!config.apiKey) {
      skipped.push({
        provider: id,
        reason: `no ${id.toUpperCase()}_API_KEY configured`,
      });
      continue;
    }
    // The same factory the live router uses. A benchmark that builds its own
    // provider is measuring a request production does not send.
    const provider = createProvider(id, env);
    if (!provider) {
      skipped.push({ provider: id, reason: "provider could not be constructed" });
      continue;
    }
    // OpenAI and Anthropic have no free API tier. The other providers must be
    // explicitly declared paid; otherwise the benchmark must not award paid
    // privacy or sustainability points to an unknown/free key.
    const paid =
      id === "openai" || id === "anthropic" || env.llm.paidTier.has(id);
    available.push({ id, provider, paid });
  }

  return { available, skipped };
}

/** Turn a bench case into the same request shape the live route builds. */
export function requestFor(benchCase: BenchCase): InterpretRequest {
  return {
    mode: benchCase.mode,
    lag: "balanced",
    pending: benchCase.korean,
    // Bench cases are whole utterances, and the `incomplete` category is the
    // one that deliberately is not: score it as the clock-cut unit it is, or
    // the model is marked down for refusing to finish a sentence the speaker
    // never finished.
    boundary: benchCase.category === "incomplete" ? "timeout" : "sentence",
    continuesPrevious: false,
    context: {
      recentKorean: benchCase.priorKorean ?? [],
      recentEnglish: benchCase.priorEnglish ?? [],
      glossary: [],
      entities: benchCase.context?.entities
        ? benchCase.context.entities.map((e) => ({ ...e, kind: "person" as const }))
        : benchCase.category === "wordplay"
          ? [
              {
                korean: "류정길",
                english: "Ryu Jeong-gil",
                kind: "person" as const,
              },
            ]
          : [],
      scripture: [],
      // A case that ships corrections needs them delivered, or it is testing
      // nothing: "does an interpreter's correction win?" cannot be answered
      // by a request that does not carry one.
      corrections: benchCase.context?.corrections ?? [],
    },
    allowAnticipation: !benchCase.expect.forbidAnticipation,
  };
}

/**
 * The prompt `/api/interpret` would actually send this provider.
 *
 * The benchmark used to call `systemPromptFor(mode)` bare, which defaults
 * `schemaEnforced` to false and never selects a context profile — so it
 * measured a prompt production does not send. The gap is not cosmetic:
 *
 *   - four of the five cloud providers enforce the JSON schema natively, and
 *     production drops the prose restatement of that shape for them;
 *   - OpenRouter and Groq sustain fewer tokens per live call than the `full`
 *     profile costs, so production runs them on the ultra-compact system
 *     contract with a heavily clipped context.
 *
 * Measuring OpenRouter at `full` was therefore measuring a configuration the
 * live route never uses, on the provider that is first in the production
 * routing order.
 *
 * Quota pressure is zero and p95 latency unknown because a benchmark run is a
 * fresh session — which is the state every service starts in.
 */
export function livePromptFor(
  id: LlmProviderId,
  benchCase: BenchCase,
  request: InterpretRequest,
): { system: string; user: string; profile: ContextProfile; schemaEnforced: boolean } {
  const caps = promptCapabilitiesFor(id);
  const decision = chooseProfile({
    recommendedLiveTokens: caps.recommendedLiveContextTokens,
    quotaPressure: 0,
    latencyP95Ms: undefined,
    lag: request.lag,
  });
  return {
    system: systemPromptFor(benchCase.mode, {
      schemaEnforced: caps.structuredOutput,
      ultraCompact: decision.profile === "ultra-compact",
    }),
    user: buildLiveUserPrompt({
      ...request,
      context: applyProfile(request.context, decision.profile),
    }),
    profile: decision.profile,
    schemaEnforced: caps.structuredOutput,
  };
}

async function runCase(
  id: LlmProviderId,
  provider: LlmProvider,
  benchCase: BenchCase,
  deadlineMs: number,
  repeats: number,
): Promise<CaseResult> {
  const request = requestFor(benchCase);
  const { system, user } = livePromptFor(id, benchCase, request);

  const latencies: number[] = [];
  const usages: LlmUsage[] = [];
  let lastText: string | null = null;
  let lastError: string | undefined;

  for (let i = 0; i < repeats; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    const started = Date.now();
    try {
      const response = await provider.complete({
        system,
        user,
        maxOutputTokens: 700,
        temperature: 0.2,
        jsonSchema: INTERPRETER_JSON_SCHEMA,
        thinking: "none",
        signal: controller.signal,
      });
      latencies.push(response.latencyMs || Date.now() - started);
      if (response.usage) usages.push(response.usage);
      lastText = response.text;
      lastError = undefined;
    } catch (error) {
      latencies.push(Date.now() - started);
      lastError = toLlmError(error).message;
      lastText = null;
    } finally {
      clearTimeout(timer);
    }
  }

  const median =
    latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)] ?? 0;
  const output = lastText ? parseInterpreterOutput(lastText) : null;
  const result = scoreCase(benchCase, output, median, lastError);
  const usage = usages.reduce<LlmUsage>(
    (total, current) => ({
      inputTokens: (total.inputTokens ?? 0) + (current.inputTokens ?? 0),
      outputTokens: (total.outputTokens ?? 0) + (current.outputTokens ?? 0),
      totalTokens: (total.totalTokens ?? 0) + (current.totalTokens ?? 0),
      ...(current.cachedInputTokens !== undefined && total.cachedInputTokens !== undefined
        ? { cachedInputTokens: total.cachedInputTokens + current.cachedInputTokens }
        : {}),
    }),
    usages.every((current) => current.cachedInputTokens !== undefined)
      ? { cachedInputTokens: 0 }
      : {},
  );
  return usages.length > 0
    ? { ...result, usage, usageReports: usages.length }
    : result;
}

export async function runBenchmark(
  options: RunnerOptions = {},
): Promise<BenchmarkRun> {
  const startedAt = new Date().toISOString();
  const deadlineMs = options.deadlineMs ?? 12_000;
  const repeats = options.repeats ?? 1;
  const log = options.onProgress ?? (() => {});

  const { available, skipped } = availableProviders();
  const selected = options.only
    ? available.filter((entry) => options.only!.includes(entry.id))
    : available;

  const scores: ProviderScore[] = [];

  for (const entry of selected) {
    // Say which configuration is being measured. A score for a provider run at
    // `full` is not comparable to the same provider run as production runs it,
    // and the report should never leave that ambiguous.
    const shape = livePromptFor(entry.id, BENCH_CASES[0], requestFor(BENCH_CASES[0]));
    log(
      `\n▸ ${entry.id} (${entry.provider.model}) — ${shape.profile} context, ` +
        `${shape.schemaEnforced ? "native schema" : "prose schema contract"}`,
    );
    const cases: CaseResult[] = [];
    for (const benchCase of BENCH_CASES) {
      const result = await runCase(
        entry.id,
        entry.provider,
        benchCase,
        deadlineMs,
        repeats,
      );
      cases.push(result);
      const mark = result.ok ? "·" : result.hardFailures.length ? "✗" : "!";
      log(
        `  ${mark} ${benchCase.id} ${benchCase.category} ${result.latencyMs}ms`,
      );
    }
    scores.push({
      ...scoreProvider(entry.id, entry.provider.model, cases, {
        paidTier: entry.paid,
      }),
      promptProfile: shape.profile,
      schemaEnforced: shape.schemaEnforced,
    });
  }

  scores.sort((a, b) => {
    if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;
    return b.total - a.total;
  });

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    deadlineMs,
    repeats,
    cases: BENCH_CASES.length,
    scores,
    skipped: options.only
      ? skipped.filter((s) => options.only!.includes(s.provider))
      : skipped,
    environment: {
      node: process.version,
      reachability: {},
    },
  };
}
