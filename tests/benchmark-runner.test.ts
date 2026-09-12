import { describe, expect, it } from "vitest";

import { availableProviders, livePromptFor, requestFor } from "../benchmarks/runner";
import { scoreProvider, type CaseResult } from "../benchmarks/score";
import { BENCH_CASES } from "../benchmarks/dataset";
import { applyProfile, chooseProfile } from "@/interpreter/context/profiles";
import { buildLiveUserPrompt, systemPromptFor } from "@/interpreter/prompts/live";
import { promptCapabilitiesFor } from "@/providers/llm/schema-enforcement";
import { parseEnv } from "@/lib/env";

const KEY = "test-key-that-is-long-enough";
const testEnv = (values: Record<string, string>) =>
  parseEnv(values as NodeJS.ProcessEnv);

describe("benchmark provider tiers", () => {
  it("honours a paid-tier declaration for Gemini", () => {
    const env = testEnv({ GEMINI_API_KEY: KEY, LLM_PAID_TIER: "gemini" });
    const gemini = availableProviders(env).available.find(
      (entry) => entry.id === "gemini",
    );

    expect(gemini?.paid).toBe(true);
  });

  it("does not award paid-tier scoring to an undeclared Gemini key", () => {
    const env = testEnv({ GEMINI_API_KEY: KEY });
    const gemini = availableProviders(env).available.find(
      (entry) => entry.id === "gemini",
    );

    expect(gemini?.paid).toBe(false);
  });

  it("treats providers without a free API tier as paid", () => {
    const env = testEnv({ OPENAI_API_KEY: KEY, ANTHROPIC_API_KEY: KEY });
    const providers = availableProviders(env).available;

    expect(providers.find((entry) => entry.id === "openai")?.paid).toBe(true);
    expect(providers.find((entry) => entry.id === "anthropic")?.paid).toBe(
      true,
    );
  });
});

/**
 * A benchmark that sends a different request than `/api/interpret` is not
 * measuring the product. It scored every provider on `systemPromptFor(mode)`
 * with no options, which meant the prose restatement of the JSON schema was
 * always included and no context profile was ever applied — so OpenRouter and
 * Groq, the two providers production runs on the ultra-compact contract, were
 * measured on a document the live route never sends them.
 */
describe("the benchmark sends what production sends", () => {
  const sermon = BENCH_CASES.find((c) => c.mode === "sermon") ?? BENCH_CASES[0];

  it("selects the same context profile the live route would", () => {
    for (const id of ["local", "gemini", "groq", "openrouter", "openai", "anthropic"] as const) {
      const request = requestFor(sermon);
      const expected = chooseProfile({
        recommendedLiveTokens: promptCapabilitiesFor(id).recommendedLiveContextTokens,
        quotaPressure: 0,
        latencyP95Ms: undefined,
        lag: request.lag,
      }).profile;

      expect(livePromptFor(id, sermon, request).profile).toBe(expected);
    }
  });

  it("drops the prose schema contract exactly where the provider enforces it natively", () => {
    for (const id of ["gemini", "groq", "openrouter", "openai", "anthropic"] as const) {
      const shaped = livePromptFor(id, sermon, requestFor(sermon));
      expect(shaped.schemaEnforced).toBe(promptCapabilitiesFor(id).structuredOutput);
    }
  });

  it("assembles byte-for-byte what /api/interpret would assemble", () => {
    for (const id of ["local", "gemini", "groq", "openrouter", "openai", "anthropic"] as const) {
      const request = requestFor(sermon);
      const caps = promptCapabilitiesFor(id);
      const decision = chooseProfile({
        recommendedLiveTokens: caps.recommendedLiveContextTokens,
        quotaPressure: 0,
        latencyP95Ms: undefined,
        lag: request.lag,
      });

      // The route's own two lines, spelled out rather than imported, so a
      // change to either side has to be made deliberately on both.
      const system = systemPromptFor(sermon.mode, {
        schemaEnforced: caps.structuredOutput,
        ultraCompact: decision.profile === "ultra-compact",
      });
      const user = buildLiveUserPrompt({
        ...request,
        context: applyProfile(request.context, decision.profile),
      });

      const shaped = livePromptFor(id, sermon, request);
      expect(shaped.system).toBe(system);
      expect(shaped.user).toBe(user);
    }
  });

  it("no longer sends every provider the same prompt", () => {
    const request = requestFor(sermon);
    const bare = systemPromptFor(sermon.mode);
    // Groq is run ultra-compact in production; it must not receive the full
    // sermon contract the benchmark used to measure it on.
    expect(livePromptFor("groq", sermon, request).system).not.toBe(bare);
    expect(livePromptFor("groq", sermon, request).profile).toBe("ultra-compact");
    expect(livePromptFor("openrouter", sermon, request).profile).toBe("ultra-compact");
    // Gemini has the headroom for the full context, and says so.
    expect(livePromptFor("gemini", sermon, request).profile).toBe("full");
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
