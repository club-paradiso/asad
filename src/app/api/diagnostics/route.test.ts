import { afterEach, describe, expect, it, vi } from "vitest";

const OPTIONAL_MODEL_FIELDS = [
  "GEMINI_LLM_MODEL",
  "GROQ_LLM_MODEL",
  "OPENROUTER_LLM_MODEL",
  "OPENAI_LLM_MODEL",
  "ANTHROPIC_LLM_MODEL",
] as const;

describe("diagnostics optional model overrides", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats blank optional model overrides as absent deployment noise", () => {
    for (const field of OPTIONAL_MODEL_FIELDS) vi.stubEnv(field, "");

    const problems = OPTIONAL_MODEL_FIELDS.flatMap((field) => [
      { level: "error" as const, field, message: "Too small" },
      { level: "error" as const, field, message: "invalid model id" },
    ]);

    const visible = problems.filter((problem) => {
      if (!new Set(OPTIONAL_MODEL_FIELDS).has(problem.field as (typeof OPTIONAL_MODEL_FIELDS)[number])) {
        return true;
      }
      return process.env[problem.field]?.trim() !== "";
    });

    expect(visible).toEqual([]);
  });

  it("does not hide a non-empty malformed override", () => {
    vi.stubEnv("GEMINI_LLM_MODEL", "@@@");
    expect(process.env.GEMINI_LLM_MODEL?.trim()).toBe("@@@");
  });
});
