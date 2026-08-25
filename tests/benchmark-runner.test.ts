import { describe, expect, it } from "vitest";

import { availableProviders } from "../benchmarks/runner";
import { scoreProvider, type CaseResult } from "../benchmarks/score";
import { parseEnv } from "@/lib/env";

const KEY = "test-key-that-is-long-enough";

describe("benchmark provider tiers", () => {
  it("honours a paid-tier declaration for Gemini", () => {
    const env = parseEnv({ GEMINI_API_KEY: KEY, LLM_PAID_TIER: "gemini" });
    const gemini = availableProviders(env).available.find(
      (entry) => entry.id === "gemini",
    );

    expect(gemini?.paid).toBe(true);
  });

  it("does not award paid-tier scoring to an undeclared Gemini key", () => {
    const env = parseEnv({ GEMINI_API_KEY: KEY });
    const gemini = availableProviders(env).available.find(
      (entry) => entry.id === "gemini",
    );

    expect(gemini?.paid).toBe(false);
  });

  it("treats providers without a free API tier as paid", () => {
    const env = parseEnv({ OPENAI_API_KEY: KEY, ANTHROPIC_API_KEY: KEY });
    const providers = availableProviders(env).available;

    expect(providers.find((entry) => entry.id === "openai")?.paid).toBe(true);
    expect(providers.find((entry) => entry.id === "anthropic")?.paid).toBe(
      true,
    );
  });
});

describe("benchmark usage telemetry", () => {
  it("aggregates usage reports and measures cached input", () => {
    const benchCase = {
      caseId: "usage",
      category: "scripture",
      ok: true,
      latencyMs: 500,
      safeChunks: [],
      anticipatedChunks: [],
      schemaValid: true,
      speakability: {
        score: 1,
        issues: [],
        stats: { chunks: 0, meanWordsPerChunk: 0, maxWordsPerChunk: 0 },
      },
      fidelity: {
        score: 1,
        missingRequired: [],
        forbiddenHit: [],
        scriptureMissing: [],
        culturalMissing: [],
      },
      hardFailures: [],
      usageReports: 2,
      usage: {
        inputTokens: 1_000,
        cachedInputTokens: 700,
        outputTokens: 200,
        totalTokens: 1_200,
      },
    } satisfies CaseResult;

    const score = scoreProvider("gemini", "test-model", [benchCase], {
      paidTier: true,
    });

    expect(score.tier).toBe("paid");
    expect(score.usage).toEqual({
      requestsWithUsage: 2,
      inputTokens: 1_000,
      cachedInputTokens: 700,
      outputTokens: 200,
      totalTokens: 1_200,
      cacheHitRate: 0.7,
    });
  });
});
