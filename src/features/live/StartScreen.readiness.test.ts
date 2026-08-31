import { describe, expect, it } from "vitest";
import { readinessRows } from "./StartScreen";

describe("launcher booth preflight readiness", () => {
  it("marks an unverified raw Sermon input as limited without blocking it", () => {
    const [input] = readinessRows({
      config: null,
      mode: "sermon",
      source: "deepgram",
      audioInputLabel: "USB Mixer",
      audioInputSupported: true,
      boothPreflightVerified: false,
    });

    expect(input).toMatchObject({
      label: "입력",
      value: "USB Mixer · 사전 점검 안 됨",
      level: "limited",
    });
    expect(input.detail).toMatch(/그대로 시작해도 됩니다/);
  });

  it("returns the same Sermon input to ready after a matching fresh preflight", () => {
    const [input] = readinessRows({
      config: null,
      mode: "sermon",
      source: "deepgram",
      audioInputLabel: "USB Mixer",
      audioInputSupported: true,
      boothPreflightVerified: true,
    });

    expect(input).toMatchObject({
      label: "입력",
      value: "USB Mixer",
      level: "ready",
    });
  });

  it("does not require church booth preflight in General mode", () => {
    const [input] = readinessRows({
      config: null,
      mode: "general",
      source: "deepgram",
      audioInputLabel: "USB Mixer",
      audioInputSupported: true,
      boothPreflightVerified: false,
    });

    expect(input.level).toBe("ready");
  });
});
