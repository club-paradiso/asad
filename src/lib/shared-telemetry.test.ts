import { afterEach, describe, expect, it, vi } from "vitest";
import {
  persistSharedLatencyWithConfig,
  readSharedLatencySnapshotWithConfig,
  SHARED_TELEMETRY_MAX_SAMPLES,
} from "./shared-telemetry";

const config = {
  url: "https://redis.example.test",
  token: "test-token",
  source: "upstash" as const,
};

afterEach(() => vi.unstubAllGlobals());

describe("shared live latency telemetry", () => {
  it("stores a bounded transcript-free batch in one Redis round trip", async () => {
    let init: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, next?: RequestInit) => {
      init = next;
      return new Response(JSON.stringify({ result: 3 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const count = await persistSharedLatencyWithConfig(
      config,
      [
        {
          id: "c1-1",
          stage: "stable_to_render",
          ms: 2100,
          provider: "openrouter",
          model: "nex-agi/nex-n2.5-mini:free",
        },
        {
          id: "c1-2",
          stage: "stable_to_safe",
          ms: 2000,
          provider: "설교 원문은 저장되면 안 됩니다",
          model: "model with spaces",
        },
        {
          id: "c1-1",
          stage: "stable_to_render",
          ms: 2100,
          provider: "openrouter",
          model: "nex-agi/nex-n2.5-mini:free",
        },
      ],
      1_800_000_000_000,
    );

    expect(count).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = String(init?.body ?? "");
    expect(body).toContain("EVAL");
    expect(body).toContain(String(SHARED_TELEMETRY_MAX_SAMPLES));
    expect(body).toContain("stable_to_render");
    expect(body).toContain("nex-agi/nex-n2.5-mini:free");
    expect(body).not.toContain("설교 원문");
    expect(body).not.toContain("model with spaces");
    expect(body.match(/c1-1/g)).toHaveLength(1);
  });

  it("aggregates shared samples into exact diagnostics percentiles and SLOs", async () => {
    const members = [
      { id: "a-1", stage: "stable_to_render", ms: 1800, provider: "openrouter" },
      { id: "a-2", stage: "stable_to_render", ms: 2600, provider: "openrouter" },
      { id: "a-3", stage: "provider_response", ms: 1200, provider: "openrouter" },
      { id: "a-4", stage: "provider_response", ms: 1700, provider: "openrouter" },
      { nonsense: true },
    ].map((value) => JSON.stringify(value));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ result: members }), { status: 200 })),
    );

    const snapshot = await readSharedLatencySnapshotWithConfig(config, 1_800_000_000_000);
    expect(snapshot.sampleCount).toBe(4);
    expect(snapshot.latency.stable_to_render).toMatchObject({ count: 2, p50: 1800, p95: 2600 });
    expect(snapshot.latency.provider_response).toMatchObject({ count: 2, p50: 1200, p95: 1700 });
    expect(snapshot.latency.server_to_safe.count).toBe(0);
    expect(snapshot.slo.find((item) => item.stage === "stable_to_render")).toMatchObject({
      p50Met: true,
      p95Met: true,
    });
  });
});
