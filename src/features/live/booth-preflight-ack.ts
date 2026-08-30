import { normalizeBoothAudioDeviceId } from "./booth-audio-preference";

/**
 * Same-tab, short-lived evidence that the operator completed Booth Preflight
 * for the physical input they are about to use.
 *
 * Session storage is deliberate: this is not a preference and must not become
 * a stale promise that tomorrow's booth wiring is still safe. Only an opaque
 * device id plus a timestamp is stored; never labels, audio, transcript, or
 * church/session content.
 */
export const BOOTH_PREFLIGHT_ACK_STORAGE_KEY = "asad:sermon:booth-preflight:v1";
export const BOOTH_PREFLIGHT_ACK_MAX_AGE_MS = 4 * 60 * 60 * 1000;

const SYSTEM_DEFAULT_KEY = "__system_default__";

interface BoothPreflightAck {
  v: 1;
  device: string;
  checkedAt: number;
}

function browserSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function deviceKey(deviceId?: string): string {
  return normalizeBoothAudioDeviceId(deviceId) || SYSTEM_DEFAULT_KEY;
}

export function writeBoothPreflightAcknowledgement(
  deviceId?: string,
  now = Date.now(),
  storage: Storage | null = browserSessionStorage(),
): void {
  if (!storage || !Number.isFinite(now)) return;
  const value: BoothPreflightAck = {
    v: 1,
    device: deviceKey(deviceId),
    checkedAt: now,
  };
  try {
    storage.setItem(BOOTH_PREFLIGHT_ACK_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Preflight evidence is advisory. Storage failure must never block the
    // interpreter from using the ordinary church interpretation path.
  }
}

export function clearBoothPreflightAcknowledgement(
  storage: Storage | null = browserSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(BOOTH_PREFLIGHT_ACK_STORAGE_KEY);
  } catch {
    // Optional, same rationale as writes above.
  }
}

export function isBoothPreflightAcknowledged(
  deviceId?: string,
  now = Date.now(),
  storage: Storage | null = browserSessionStorage(),
): boolean {
  if (!storage || !Number.isFinite(now)) return false;

  try {
    const raw = storage.getItem(BOOTH_PREFLIGHT_ACK_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<BoothPreflightAck>;
    if (
      parsed.v !== 1 ||
      typeof parsed.device !== "string" ||
      typeof parsed.checkedAt !== "number" ||
      !Number.isFinite(parsed.checkedAt)
    ) {
      return false;
    }

    const age = now - parsed.checkedAt;
    if (age < 0 || age > BOOTH_PREFLIGHT_ACK_MAX_AGE_MS) return false;
    return parsed.device === deviceKey(deviceId);
  } catch {
    return false;
  }
}
