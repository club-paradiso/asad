import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSharedRateLimitsWithConfig } from "./shared-rate-limit";

const config = {
  url: "https://redis.example.test",
  token: "test-token",
  source: "upstash" as const,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared request rate limiting", () => {
  it("checks several limits in one Redis round trip", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ result: [1, 60_000, 3, 30_000] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkSharedRateLimitsWithConfig(config, [
      { name: "session", key: "session-secret", rule: { limit: 2, windowMs: 60_000 } },
      { name: "address", key: "203.0.113.9", rule: { limit: 2, windowMs: 60_000 } },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result[0]).toMatchObject({ allowed: true, remaining: 1, retryAfterSeconds: 60 });
    expect(result[1]).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 30 });

    const body = String(capturedInit?.body ?? "");
    expect(body).toContain("EVAL");
    expect(body).not.toContain("session-secret");
    expect(body).not.toContain("203.0.113.9");
  });

  it("fails closed at the configured count without inventing extra requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ result: [4, 12_500] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const [verdict] = await checkSharedRateLimitsWithConfig(config, [
      { name: "health", key: "client", rule: { limit: 4, windowMs: 60_000 } },
    ]);

    expect(verdict).toEqual({
      allowed: true,
      remaining: 0,
      retryAfterSeconds: 13,
      limit: 4,
    });
  });
});
