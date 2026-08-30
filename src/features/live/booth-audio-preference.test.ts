import { beforeEach, describe, expect, it } from "vitest";
import {
  BOOTH_AUDIO_DEVICE_STORAGE_KEY,
  normalizeBoothAudioDeviceId,
  readPreferredBoothAudioDeviceId,
  resolvePreferredBoothAudioDeviceId,
  writePreferredBoothAudioDeviceId,
} from "./booth-audio-preference";

describe("Sermon booth audio preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists only the opaque selected device id", () => {
    writePreferredBoothAudioDeviceId("usb-mixer-123");

    expect(Object.keys(window.localStorage)).toEqual([BOOTH_AUDIO_DEVICE_STORAGE_KEY]);
    expect(readPreferredBoothAudioDeviceId()).toBe("usb-mixer-123");
    expect(window.localStorage.getItem(BOOTH_AUDIO_DEVICE_STORAGE_KEY)).not.toMatch(
      /mixer|church|transcript|audio label|sermon/i,
    );
  });

  it("treats system default as no stored override", () => {
    writePreferredBoothAudioDeviceId("usb-mixer-123");
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
      { deviceId: "usb-mixer-123", label: "USB Audio CODEC" },
    ];

    expect(resolvePreferredBoothAudioDeviceId("usb-mixer-123", devices)).toBe(
      "usb-mixer-123",
    );
    expect(resolvePreferredBoothAudioDeviceId("old-device", devices)).toBe("");
  });
});
