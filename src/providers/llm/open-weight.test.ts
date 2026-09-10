import { describe, expect, it } from "vitest";
import { isOpenWeightModel } from "./capabilities";

describe("open-weight model classification", () => {
  it("recognises the deployed Nex N2.5 Mini model", () => {
    expect(isOpenWeightModel("nex-agi/nex-n2.5-mini:free")).toBe(true);
  });

  it("does not turn unrelated proprietary models into open weights", () => {
    expect(isOpenWeightModel("openai/gpt-5.6-sol")).toBe(false);
    expect(isOpenWeightModel("anthropic/claude-fable-5.1")).toBe(false);
  });
});
