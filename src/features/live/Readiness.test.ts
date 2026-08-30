import { describe, expect, it } from "vitest";
import { isBoothPreflightActionRow, type ReadinessRow } from "./Readiness";

const row = (overrides: Partial<ReadinessRow> = {}): ReadinessRow => ({
  label: "Input",
  value: "USB Mixer · not preflight-verified",
  level: "limited",
  ...overrides,
});

describe("booth preflight readiness shortcut", () => {
  it("appears only for the limited Input state produced by an unverified Sermon booth input", () => {
    expect(isBoothPreflightActionRow(row())).toBe(true);
  });

  it("does not appear after the input becomes ready", () => {
    expect(
      isBoothPreflightActionRow(
        row({ value: "USB Mixer", level: "ready" }),
      ),
    ).toBe(false);
  });

  it("does not hijack unrelated limited readiness rows", () => {
    expect(
      isBoothPreflightActionRow(
        row({
          label: "Recognition",
          value: "Browser recognition is limited",
        }),
      ),
    ).toBe(false);
  });
});
