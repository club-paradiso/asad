import { describe, expect, it } from "vitest";
import { deadlineFor, turnBudgetFor } from "./deadlines";

describe("live provider deadlines", () => {
  it("gives OpenRouter room for model-level failover without consuming the local floor", () => {
    expect(deadlineFor({ workflow: "live", lag: "fast", provider: "openrouter" })).toBe(3750);
    expect(deadlineFor({ workflow: "live", lag: "balanced", provider: "openrouter" })).toBe(5350);
    expect(deadlineFor({ workflow: "live", lag: "safe", provider: "openrouter" })).toBe(7000);

    for (const lag of ["fast", "balanced", "safe"] as const) {
      const deadline = deadlineFor({ workflow: "live", lag, provider: "openrouter" });
      expect(turnBudgetFor(lag) - deadline).toBeGreaterThanOrEqual(250);
    }
  });

  it("does not loosen direct-provider deadlines", () => {
    expect(deadlineFor({ workflow: "live", lag: "balanced", provider: "gemini" })).toBe(3500);
    expect(deadlineFor({ workflow: "live", lag: "balanced", provider: "anthropic" })).toBe(3800);
  });

  it("still shrinks a second provider attempt", () => {
    expect(
      deadlineFor({ workflow: "live", lag: "balanced", provider: "openrouter", attempt: 1 }),
    ).toBe(3300);
  });

  it("leaves non-live workflows unchanged", () => {
    expect(deadlineFor({ workflow: "prep", provider: "openrouter" })).toBe(45_000);
    expect(deadlineFor({ workflow: "review", provider: "openrouter" })).toBe(60_000);
  });
});
