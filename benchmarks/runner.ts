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
    context: {
      recentKorean: benchCase.priorKorean ?? [],
      recentEnglish: benchCase.priorEnglish ?? [],
      glossary: [],
      entities:
        benchCase.category === "wordplay"
          ? [
              {
                korean: "류정길",
                english: "Ryu Jeong-gil",
                kind: "person" as const,
              },
            ]
          : [],
      scripture: [],
      corrections: [],
    },
    allowAnticipation: !benchCase.expect.forbidAnticipation,
  };
}

async function runCase(
  provider: LlmProvider,
  benchCase: BenchCase,
  deadlineMs: number,
  repeats: number,
): Promise<CaseResult> {
  const request = requestFor(benchCase);
  const system = systemPromptFor(benchCase.mode);
  const user = buildLiveUserPrompt(request);

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
      cachedInputTokens:
        (total.cachedInputTokens ?? 0) + (current.cachedInputTokens ?? 0),
    }),
    {},
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
    log(`\n▸ ${entry.id} (${entry.provider.model})`);
    const cases: CaseResult[] = [];
    for (const benchCase of BENCH_CASES) {
      const result = await runCase(
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
    scores.push(
      scoreProvider(entry.id, entry.provider.model, cases, {
        paidTier: entry.paid,
      }),
    );
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
