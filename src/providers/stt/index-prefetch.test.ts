import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guardedFetch: vi.fn() }));

vi.mock("@/lib/session-client", () => ({ guardedFetch: mocks.guardedFetch }));

import { fetchSttCredentials, prefetchSttCredentials } from "./index";

function response(data: Record<string, unknown>): Response {
  return { ok: true, json: async () => data } as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-04T00:00:00Z"));
  mocks.guardedFetch.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Counter STT credential prewarm", () => {
  it("keeps explicitly expiring credentials ready beyond 20 seconds", async () => {
    mocks.guardedFetch.mockResolvedValue(
      response({ provider: "deepgram", token: "x", expiresAt: Date.now() + 90 * 60_000 }),
    );
    const access = { code: "ABCD", token: "x" };

    await prefetchSttCredentials("ko-KR", access);
    expect(mocks.guardedFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25_000);

    await expect(fetchSttCredentials("ko-KR", undefined, "counter", access)).resolves.toMatchObject({
      provider: "deepgram",
      token: "x",
    });
    expect(mocks.guardedFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the conservative 20-second window when expiry is unknown", async () => {
    mocks.guardedFetch.mockResolvedValue(response({ provider: "openai", token: "x" }));
    const access = { code: "EFGH", token: "x" };

    await prefetchSttCredentials("en-US", access);
    expect(mocks.guardedFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25_000);

    await fetchSttCredentials("en-US", undefined, "counter", access);
    expect(mocks.guardedFetch).toHaveBeenCalledTimes(2);
  });
});
