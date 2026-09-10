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
            rate_limit: { requests: 50, interval: "1d", note: "deprecated" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await inspectOpenRouterAccount(KEY, { baseUrl: "https://example.test/api/v1" });

    expect(result.ok).toBe(true);
    expect(result.isFreeTier).toBe(true);
    expect(result.reportedRequestLimit).toBe(50);
    expect(result.estimatedCallsPerService).toBeGreaterThan(OPENROUTER_FREE_MODEL_RPD.unfunded);
    expect(result.fundedMinutes).toBeGreaterThanOrEqual(45);
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain("private-user-id");
    expect(JSON.stringify(result)).not.toContain("123.45");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.stringify(init.headers)).toContain(KEY);
  });

  it("fails softly when tier metadata cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    const result = await inspectOpenRouterAccount(KEY, { baseUrl: "https://example.test/api/v1" });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
