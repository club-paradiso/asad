import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import {
  OPENROUTER_MAX_MODEL_FALLBACKS,
  PUBLIC_FREE_OPENROUTER_FALLBACK_MODELS,
  isPublicZeroCostOpenRouterModel,
  publicFreeOpenRouterFallbackModels,
  restorePublicFreeOpenRouter,
} from "./public-free";

const KEY = "x".repeat(24);

const currentProductionShape = (overrides: Record<string, string> = {}) => ({
  VERCEL: "1",
  LLM_ROUTING_MODE: "reliable",
  LLM_PROVIDER: "openrouter",
  OPENROUTER_API_KEY: KEY,
  OPENROUTER_PRIMARY_MODEL: "nex-agi/nex-n2.5-mini:free",
  OPENROUTER_DATA_COLLECTION: "deny",
  ...overrides,
});

const asProcessEnv = (source: Record<string, string>): NodeJS.ProcessEnv =>
  source as unknown as NodeJS.ProcessEnv;

describe("public free OpenRouter restoration", () => {
  it("restores the explicitly free production provider without enabling paid cloud routes", () => {
    const source = currentProductionShape();
    const processEnv = asProcessEnv(source);
    const parsed = parseEnv(processEnv);

    // The central parser stays conservative on public Vercel deployments.
    expect(parsed.llm.providers.openrouter.configured).toBe(false);

    const restored = restorePublicFreeOpenRouter(parsed, processEnv);

    expect(restored.llm.providers.openrouter.configured).toBe(true);
    expect(restored.llm.providers.openrouter.apiKey).toBe(KEY);
    expect(restored.llm.providers.openrouter.model).toBe(
      "nex-agi/nex-n2.5-mini:free",
    );
    expect(restored.problems).not.toContainEqual(
      expect.objectContaining({ field: "LLM_PROVIDER", level: "error" }),
    );
    expect(restored.problems).toContainEqual(
      expect.objectContaining({ field: "APP_ACCESS_KEY", level: "warning" }),
    );

    const fallbacks = publicFreeOpenRouterFallbackModels(restored, processEnv);
    expect(fallbacks).toEqual([
      "openrouter/free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "google/gemma-4-31b-it:free",
    ]);
    expect(fallbacks).toHaveLength(OPENROUTER_MAX_MODEL_FALLBACKS);
    expect(fallbacks).not.toContain(restored.llm.openrouter.primaryModel);
    expect(PUBLIC_FREE_OPENROUTER_FALLBACK_MODELS.every(isPublicZeroCostOpenRouterModel)).toBe(
      true,
    );
  });

  it("never exceeds OpenRouter's three-model fallback API ceiling", () => {
    const source = currentProductionShape({
      OPENROUTER_PRIMARY_MODEL: "some-vendor/another-free-model:free",
    });
    const processEnv = asProcessEnv(source);
    const restored = restorePublicFreeOpenRouter(parseEnv(processEnv), processEnv);
    const fallbacks = publicFreeOpenRouterFallbackModels(restored, processEnv);

    expect(PUBLIC_FREE_OPENROUTER_FALLBACK_MODELS.length).toBeGreaterThan(
      OPENROUTER_MAX_MODEL_FALLBACKS,
    );
    expect(fallbacks).toHaveLength(OPENROUTER_MAX_MODEL_FALLBACKS);
    expect(fallbacks).toEqual([
      "nex-agi/nex-n2.5-mini:free",
      "openrouter/free",
      "nvidia/nemotron-3-super-120b-a12b:free",
    ]);
  });

  it("admits only explicit :free variants or the exact dynamic free-router alias", () => {
    expect(isPublicZeroCostOpenRouterModel("nex-agi/nex-n2.5-mini:free")).toBe(true);
    expect(isPublicZeroCostOpenRouterModel("google/gemma-4-31b-it:free")).toBe(true);
    expect(isPublicZeroCostOpenRouterModel("openrouter/free")).toBe(true);
    expect(isPublicZeroCostOpenRouterModel("openrouter/auto")).toBe(false);
    expect(isPublicZeroCostOpenRouterModel("google/gemini-3.7-flash")).toBe(false);
  });

  it.each([
    ["paid-capable model", { OPENROUTER_PRIMARY_MODEL: "google/gemini-3.7-flash" }],
    ["dynamic free router as primary", { OPENROUTER_PRIMARY_MODEL: "openrouter/free" }],
    ["paid fallback", { LLM_ALLOW_PAID_FALLBACK: "true" }],
    ["quality escalation", { OPENROUTER_QUALITY_ESCALATION: "true" }],
    ["collection allowed", { OPENROUTER_DATA_COLLECTION: "allow" }],
    ["declared paid tier", { LLM_PAID_TIER: "openrouter" }],
    ["different pinned provider", { LLM_PROVIDER: "gemini" }],
  ])("refuses %s on a public deployment", (_label, overrides) => {
    const source = currentProductionShape(overrides);
    const processEnv = asProcessEnv(source);
    const parsed = parseEnv(processEnv);
    const restored = restorePublicFreeOpenRouter(parsed, processEnv);

    expect(restored.llm.providers.openrouter.configured).toBe(false);
    expect(restored.llm.providers.openrouter.apiKey).toBeUndefined();
    expect(publicFreeOpenRouterFallbackModels(restored, processEnv)).toEqual([]);
  });

  it("does nothing when the deployment already has an access gate", () => {
    const source = currentProductionShape({ APP_ACCESS_KEY: "private-deployment-key" });
    const processEnv = asProcessEnv(source);
    const parsed = parseEnv(processEnv);

    expect(parsed.llm.providers.openrouter.configured).toBe(true);
    const restored = restorePublicFreeOpenRouter(parsed, processEnv);
    expect(restored.llm.providers.openrouter.configured).toBe(true);
    expect(restored.problems.some((problem) => problem.field === "APP_ACCESS_KEY")).toBe(false);
    expect(publicFreeOpenRouterFallbackModels(restored, processEnv)).toEqual([]);
  });
});
