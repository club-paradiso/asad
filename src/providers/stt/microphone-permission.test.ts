import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetMicrophonePermissionReadiness,
  ensureMicrophonePermission,
  getMicrophonePermissionState,
} from "./microphone-permission";

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
const originalPermissions = Object.getOwnPropertyDescriptor(navigator, "permissions");

function setNavigatorProperty(name: "mediaDevices" | "permissions", value: unknown) {
  Object.defineProperty(navigator, name, {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  __resetMicrophonePermissionReadiness();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
  else Reflect.deleteProperty(navigator, "mediaDevices");
  if (originalPermissions) Object.defineProperty(navigator, "permissions", originalPermissions);
  else Reflect.deleteProperty(navigator, "permissions");
  __resetMicrophonePermissionReadiness();
});

describe("microphone permission readiness", () => {
  it("can inspect a prompt state without opening the microphone", async () => {
    const getUserMedia = vi.fn();
    const query = vi.fn(async () => ({ state: "prompt" as PermissionState }));
    setNavigatorProperty("mediaDevices", { getUserMedia });
    setNavigatorProperty("permissions", { query });

    await expect(getMicrophonePermissionState()).resolves.toBe("prompt");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("requests a prompt once and immediately releases the probe stream", async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }));
    const query = vi.fn(async () => ({ state: "prompt" as PermissionState }));
    setNavigatorProperty("mediaDevices", { getUserMedia });
    setNavigatorProperty("permissions", { query });

    await expect(ensureMicrophonePermission()).resolves.toBe("granted");
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalledTimes(1);

    // The same page must not flash the permission/capture path again.
    await expect(ensureMicrophonePermission()).resolves.toBe("granted");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("does not open a stream when the browser already reports a grant", async () => {
    const getUserMedia = vi.fn();
    const query = vi.fn(async () => ({ state: "granted" as PermissionState }));
    setNavigatorProperty("mediaDevices", { getUserMedia });
    setNavigatorProperty("permissions", { query });

    await expect(getMicrophonePermissionState()).resolves.toBe("granted");
    await expect(ensureMicrophonePermission()).resolves.toBe("granted");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("reports denial without retrying the native permission sheet", async () => {
    const getUserMedia = vi.fn();
    const query = vi.fn(async () => ({ state: "denied" as PermissionState }));
    setNavigatorProperty("mediaDevices", { getUserMedia });
    setNavigatorProperty("permissions", { query });

    await expect(getMicrophonePermissionState()).resolves.toBe("denied");
    await expect(ensureMicrophonePermission()).resolves.toBe("denied");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("maps a native NotAllowedError to permission denial", async () => {
    const getUserMedia = vi.fn(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    const query = vi.fn(async () => ({ state: "prompt" as PermissionState }));
    setNavigatorProperty("mediaDevices", { getUserMedia });
    setNavigatorProperty("permissions", { query });

    await expect(ensureMicrophonePermission()).resolves.toBe("denied");
  });
});
