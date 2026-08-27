/**
 * Model capability resolution.
 *
 * The contract under test is conservatism: an unknown slug must claim LESS
 * than it might support, never more. Under-claiming costs a slightly larger
 * prompt; over-claiming costs a live turn.
 */
import { describe, expect, it } from "vitest";
import { capabilitiesForModel, liveSuitabilityProblem } from "./models";

describe("known families", () => {
  it("classifies the live default as fast and schema-capable", () => {
    const caps = capabilitiesForModel("google/gemini-3.7-flash");
    expect(caps.structuredOutput).toBe("json_schema");
    expect(caps.sampling).toBe("supported");
    expect(caps.latencyClass).toBe("fast");
    expect(caps.liveSuitable).toBe(true);
    expect(caps.source).toBe("registry");
  });

  it("classifies the quality model as suitable but not fast", () => {
    const caps = capabilitiesForModel("anthropic/claude-sonnet-5");
    expect(caps.liveSuitable).toBe(true);
    expect(caps.latencyClass).toBe("standard");
    expect(caps.promptCaching).toBe(true);
  });

  it("rules reasoning-first models out of the live path", () => {
    for (const id of ["openai/o3-mini", "deepseek/deepseek-r1", "qwen/qwq-32b"]) {
      const caps = capabilitiesForModel(id);
      expect(caps.reasoningAlwaysOn).toBe(true);
      expect(caps.liveSuitable).toBe(false);
      expect(liveSuitabilityProblem(caps)).toBeTruthy();
    }
  });

  it("does not mistake a reasoning variant for its chat family", () => {
    // Ordering bug guard: `qwq` must not fall through to the open-weight chat
    // pattern and inherit its claim that reasoning is off by default.
    expect(capabilitiesForModel("qwen/qwq-32b").reasoningAlwaysOn).toBe(true);
    expect(capabilitiesForModel("qwen/qwen-2.5-72b-instruct").reasoningAlwaysOn).toBe(false);
  });

  it("ignores an OpenRouter variant suffix when matching a family", () => {
    // `:free` and `:nitro` select routing, not a different model.
    expect(capabilitiesForModel("meta-llama/llama-3.3-70b-instruct:free").openWeights).toBe(true);
    expect(capabilitiesForModel("google/gemini-3.7-flash:nitro").structuredOutput).toBe(
      "json_schema",
    );
  });

  it("marks open-weight families as such", () => {
    expect(capabilitiesForModel("openai/gpt-oss-120b").openWeights).toBe(true);
    expect(capabilitiesForModel("mistralai/mistral-small").openWeights).toBe(true);
    expect(capabilitiesForModel("google/gemini-3.7-flash").openWeights).toBe(false);
  });
});

describe("unknown slugs", () => {
  it("falls back conservatively rather than optimistically", () => {
    const caps = capabilitiesForModel("some-vendor/entirely-new-model-v9");
    expect(caps.source).toBe("inferred");
    // Not json_schema: claiming schema enforcement we do not have produces
    // prose where the console expects JSON.
    expect(caps.structuredOutput).toBe("json_object");
    expect(caps.reasoning).toBe("none");
    expect(caps.note).toBeTruthy();
  });

  it("still returns something usable rather than throwing", () => {
    expect(() => capabilitiesForModel("")).not.toThrow();
    expect(capabilitiesForModel("").maxOutputTokens).toBeGreaterThan(0);
  });
});

describe("OpenRouter pool routers", () => {
  it("recognises the free pool and marks it unfit for a live session", () => {
    // Not a capability judgement — a consistency one. The pool picks a
    // different model per call, so terminology and register drift mid-sermon
    // and the interpreter is the one who absorbs it.
    const caps = capabilitiesForModel("openrouter/free");
    expect(caps.source).toBe("registry");
    expect(caps.liveSuitable).toBe(false);
    expect(caps.note).toContain("pin a model");
  });

  it("still claims schema support, because require_parameters enforces it", () => {
    expect(capabilitiesForModel("openrouter/free").structuredOutput).toBe("json_schema");
    expect(capabilitiesForModel("openrouter/auto").structuredOutput).toBe("json_schema");
  });

  it("does not mistake a vendor-prefixed model for the pool", () => {
    expect(capabilitiesForModel("openrouter/some-real-model").family).not.toBe("OpenRouter pool");
  });
});
