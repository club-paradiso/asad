import type { AudioInputOption } from "./useAudioInputs";

/**
 * Browser-local preference for the physical church feed used by Sermon Mode.
 *
 * Only the opaque MediaDeviceInfo.deviceId is persisted. No audio, transcript,
 * church name, device label, or session content is stored.
 */
export const BOOTH_AUDIO_DEVICE_STORAGE_KEY = "asad:sermon:booth-audio-device:v1";

const MAX_DEVICE_ID_LENGTH = 512;

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeBoothAudioDeviceId(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "default") return "";
  return trimmed.slice(0, MAX_DEVICE_ID_LENGTH);
}

export function readPreferredBoothAudioDeviceId(storage: Storage | null = browserStorage()): string {
  if (!storage) return "";
  try {
    return normalizeBoothAudioDeviceId(storage.getItem(BOOTH_AUDIO_DEVICE_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function writePreferredBoothAudioDeviceId(
  deviceId: string,
  storage: Storage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    const normalized = normalizeBoothAudioDeviceId(deviceId);
    if (normalized) storage.setItem(BOOTH_AUDIO_DEVICE_STORAGE_KEY, normalized);
    else storage.removeItem(BOOTH_AUDIO_DEVICE_STORAGE_KEY);
  } catch {
    // Local storage is an optional convenience. Never block interpreting if it
    // is unavailable, quota-limited, or disabled by the browser.
  }
}

/**
 * Reuse a stored device only when the browser can still see that exact input.
 * USB interfaces can disappear, browsers can rotate ids, and a church laptop
 * may be moved between booths. Falling back to system default is safer than
 * silently requesting a dead device id.
 */
export function resolvePreferredBoothAudioDeviceId(
  preferred: string,
  devices: readonly AudioInputOption[],
): string {
  const normalized = normalizeBoothAudioDeviceId(preferred);
  if (!normalized) return "";
  return devices.some((device) => device.deviceId === normalized) ? normalized : "";
}
