import { afterEach, describe, expect, it } from "vitest";
import { enforcesJsonSchema, promptCapabilitiesFor } from "./schema-enforcement";

const previousPrimary = process.env.OPENROUTER_PRIMARY_MODEL;
const previousLegacyModel = process.env.OPENROUTER_LLM_MODEL;

afterEach(() => {
  if (previousPrimary === undefined) delete process.env.OPENROUTER_PRIMARY_MODEL;
  else process.env.OPENROUTER_PRIMARY_MODEL = previousPrimary;

  if (previousLegacyModel === undefined) delete process.env.OPENROUTER_LLM_MODEL;
  else process.env.OPENROUTER_LLM_MODEL = previousLegacyModel;
});

describe("LLM schema enforcement", () => {
  it("does not confuse OpenRouter JSON-object support with schema enforcement", () => {
    expect(enforcesJsonSchema("openrouter", "google/gemma-4-26b-a4b-it:free")).toBe(false);
    expect(
      promptCapabilitiesFor("openrouter", "google/gemma-4-26b-a4b-it:free").structuredOutput,
    ).toBe(false);
  });

  it("recognises an OpenRouter primary that really supports json_schema", () => {
    expect(enforcesJsonSchema("openrouter", "openai/gpt-oss-120b")).toBe(true);
    expect(enforcesJsonSchema("openrouter", "nex-agi/nex-n2.5-mini:free")).toBe(true);
  });

  it("uses the configured production primary for prompt capability resolution", () => {
    process.env.OPENROUTER_PRIMARY_MODEL = "nex-agi/nex-n2.5-mini:free";
    expect(promptCapabilitiesFor("openrouter").structuredOutput).toBe(true);

    process.env.OPENROUTER_PRIMARY_MODEL = "google/gemma-4-26b-a4b-it:free";
    expect(promptCapabilitiesFor("openrouter").structuredOutput).toBe(false);
  });

  it("fails conservative when no OpenRouter model is available", () => {
    delete process.env.OPENROUTER_PRIMARY_MODEL;
    delete process.env.OPENROUTER_LLM_MODEL;
    expect(promptCapabilitiesFor("openrouter").structuredOutput).toBe(false);
  });

  it("preserves direct-provider schema capabilities", () => {
    expect(promptCapabilitiesFor("gemini").structuredOutput).toBe(true);
    expect(promptCapabilitiesFor("anthropic").structuredOutput).toBe(false);
  });
});
