import { describe, expect, it } from "vitest";
import { captureAudioConstraints } from "./audio";

describe("captureAudioConstraints", () => {
  it("requires an explicitly selected booth device exactly", () => {
    expect(captureAudioConstraints("opaque-device-id")).toMatchObject({
      deviceId: { exact: "opaque-device-id" },
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
    });
  });

  it("leaves device selection to the browser for System default", () => {
    const constraints = captureAudioConstraints();
    expect("deviceId" in constraints).toBe(false);
    expect(constraints.channelCount).toBe(1);
  });
});
