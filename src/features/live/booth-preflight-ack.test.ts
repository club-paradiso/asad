import { describe, expect, it } from "vitest";
import {
  BOOTH_PREFLIGHT_ACK_MAX_AGE_MS,
  clearBoothPreflightAcknowledgement,
  isBoothPreflightAcknowledged,
  writeBoothPreflightAcknowledgement,
} from "./booth-preflight-ack";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => data.set(key, String(value)),
  } as Storage;
}

describe("booth preflight acknowledgement", () => {
  it("recognises the same selected input during the short same-tab window", () => {
    const storage = memoryStorage();
    const now = 1_000_000;
    writeBoothPreflightAcknowledgement("usb-mixer", now, storage);

    expect(isBoothPreflightAcknowledged("usb-mixer", now + 60_000, storage)).toBe(true);
    expect(isBoothPreflightAcknowledged("other-device", now + 60_000, storage)).toBe(false);
  });

  it("keeps System default distinct from an explicitly selected input", () => {
    const storage = memoryStorage();
    const now = 1_000_000;
    writeBoothPreflightAcknowledgement(undefined, now, storage);

    expect(isBoothPreflightAcknowledged(undefined, now + 1, storage)).toBe(true);
    expect(isBoothPreflightAcknowledged("usb-mixer", now + 1, storage)).toBe(false);
  });

  it("expires rather than becoming a promise about tomorrow's wiring", () => {
    const storage = memoryStorage();
    const now = 1_000_000;
    writeBoothPreflightAcknowledgement("usb-mixer", now, storage);

    expect(
      isBoothPreflightAcknowledged(
        "usb-mixer",
        now + BOOTH_PREFLIGHT_ACK_MAX_AGE_MS + 1,
        storage,
      ),
    ).toBe(false);
  });

  it("can be invalidated immediately when the booth check stops being ready", () => {
    const storage = memoryStorage();
    const now = 1_000_000;
    writeBoothPreflightAcknowledgement("usb-mixer", now, storage);
    clearBoothPreflightAcknowledgement(storage);

    expect(isBoothPreflightAcknowledged("usb-mixer", now + 1, storage)).toBe(false);
  });
});
