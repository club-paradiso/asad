import { beforeEach, describe, expect, it } from "vitest";
import {
  BOOTH_AUDIO_DEVICE_STORAGE_KEY,
  normalizeBoothAudioDeviceId,
  readPreferredBoothAudioDeviceId,
  resolvePreferredBoothAudioDeviceId,
  writePreferredBoothAudioDeviceId,
} from "./booth-audio-preference";

const DEVICE_ID = "f47ac10b58cc4372a5670e02b2c3d479";

describe("Sermon booth audio preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists only the opaque selected device id", () => {
    writePreferredBoothAudioDeviceId(DEVICE_ID);

    expect(Object.keys(window.localStorage)).toEqual([BOOTH_AUDIO_DEVICE_STORAGE_KEY]);
    expect(readPreferredBoothAudioDeviceId()).toBe(DEVICE_ID);
    expect(window.localStorage.getItem(BOOTH_AUDIO_DEVICE_STORAGE_KEY)).not.toMatch(
      /mixer|church|transcript|audio label|sermon/i,
    );
  });

  it("treats system default as no stored override", () => {
    writePreferredBoothAudioDeviceId(DEVICE_ID);
    writePreferredBoothAudioDeviceId("default");

    expect(readPreferredBoothAudioDeviceId()).toBe("");
    expect(window.localStorage.getItem(BOOTH_AUDIO_DEVICE_STORAGE_KEY)).toBeNull();
  });

  it("bounds malformed or unexpectedly long ids", () => {
    expect(normalizeBoothAudioDeviceId(" x ")).toBe("x");
    expect(normalizeBoothAudioDeviceId("x".repeat(800))).toHaveLength(512);
    expect(normalizeBoothAudioDeviceId(null)).toBe("");
  });

  it("reuses a stored input only while that exact device is visible", () => {
    const devices = [
      { deviceId: "default", label: "Default" },
      { deviceId: DEVICE_ID, label: "USB Audio CODEC" },
    ];

    expect(resolvePreferredBoothAudioDeviceId(DEVICE_ID, devices)).toBe(DEVICE_ID);
    expect(resolvePreferredBoothAudioDeviceId("old-device", devices)).toBe("");
  });
});
