import { describe, expect, it } from "vitest";
import {
  HOT_WINDOW_MS,
  IDLE_AFTER_MS,
  POLL_ACTIVE_MS,
  POLL_HIDDEN_MS,
  POLL_HOT_MS,
  POLL_IDLE_MS,
  pollIntervalFor,
} from "./polling";

describe("adaptive poll cadence", () => {
  const at = (quietForMs: number, extra: Partial<Parameters<typeof pollIntervalFor>[0]> = {}) =>
    pollIntervalFor({ hidden: false, now: 100_000, lastChangeAt: 100_000 - quietForMs, sendPending: false, ...extra });

  it("polls fast while the conversation is live", () => {
    expect(at(0)).toBe(POLL_HOT_MS);
    expect(at(HOT_WINDOW_MS - 1)).toBe(POLL_HOT_MS);
  });

  it("polls fast while this device has a send in flight, however quiet it was", () => {
    expect(at(IDLE_AFTER_MS * 2, { sendPending: true })).toBe(POLL_HOT_MS);
  });

  it("settles to the ordinary cadence after a pause", () => {
    expect(at(HOT_WINDOW_MS)).toBe(POLL_ACTIVE_MS);
    expect(at(IDLE_AFTER_MS - 1)).toBe(POLL_ACTIVE_MS);
  });

  it("relaxes once the desk has gone quiet, but never beyond a couple of seconds", () => {
    expect(at(IDLE_AFTER_MS)).toBe(POLL_IDLE_MS);
    expect(POLL_IDLE_MS).toBeLessThanOrEqual(2500);
  });

  it("stays slow in a hidden tab whatever is happening", () => {
    expect(at(0, { hidden: true })).toBe(POLL_HIDDEN_MS);
    expect(at(0, { hidden: true, sendPending: true })).toBe(POLL_HIDDEN_MS);
  });

  it("never costs more than two polls a second", () => {
    expect(POLL_HOT_MS).toBeGreaterThanOrEqual(500);
  });
});
