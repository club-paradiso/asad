import { describe, expect, it } from "vitest";
import { enforcesJsonSchema, promptCapabilitiesFor } from "./schema-enforcement";

describe("LLM schema enforcement", () => {
  it("does not confuse OpenRouter JSON-object support with schema enforcement", () => {
    expect(enforcesJsonSchema("openrouter", "google/gemma-4-26b-a4b-it:free")).toBe(false);
    expect(promptCapabilitiesFor("openrouter").structuredOutput).toBe(false);
  });

  it("recognises an OpenRouter primary that really supports json_schema", () => {
    expect(enforcesJsonSchema("openrouter", "openai/gpt-oss-120b")).toBe(true);
  });

  it("preserves direct-provider schema capabilities", () => {
    expect(promptCapabilitiesFor("gemini").structuredOutput).toBe(true);
    expect(promptCapabilitiesFor("anthropic").structuredOutput).toBe(false);
  });
});
