import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPENROUTER_FREE_MODEL_RPD,
  inspectOpenRouterAccount,
} from "./openrouter-account";

const KEY = "sk-or-test-secret-never-return-this";

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter account diagnostics", () => {
  it("returns only safe tier metadata and workload math", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            is_free_tier: true,
            label: KEY,
            creator_user_id: "private-user-id",
            usage: 123.45,
            // OpenRouter currently marks this object deprecated. The bizarre
            // -1/10s shape has appeared in production and must not leak into
            // capacity decisions or diagnostics as though it were authoritative.
            rate_limit: { requests: -1, interval: "10s", note: "deprecated" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await inspectOpenRouterAccount(KEY, { baseUrl: "https://example.test/api/v1" });

    expect(result.ok).toBe(true);
    expect(result.isFreeTier).toBe(true);
    expect(result.documentedDailyAllowance).toBe(OPENROUTER_FREE_MODEL_RPD.unfunded);
    expect(result.documentedMinutesAvailable).toBe(4);
    expect(result.canSustainOneService).toBe(false);
    expect(result.estimatedCallsPerService).toBeGreaterThan(OPENROUTER_FREE_MODEL_RPD.unfunded);
    expect(result.fundedMinutes).toBeGreaterThanOrEqual(45);
    expect(JSON.stringify(result)).not.toContain("rate_limit");
    expect(JSON.stringify(result)).not.toContain("10s");
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain("private-user-id");
    expect(JSON.stringify(result)).not.toContain("123.45");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.stringify(init.headers)).toContain(KEY);
  });

  it("reports the documented funded floor as enough for one service", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { is_free_tier: false } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const result = await inspectOpenRouterAccount(KEY, { baseUrl: "https://example.test/api/v1" });
    expect(result.ok).toBe(true);
    expect(result.documentedDailyAllowance).toBe(OPENROUTER_FREE_MODEL_RPD.funded10);
    expect(result.canSustainOneService).toBe(true);
  });

  it("fails softly when tier metadata cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    const result = await inspectOpenRouterAccount(KEY, { baseUrl: "https://example.test/api/v1" });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
