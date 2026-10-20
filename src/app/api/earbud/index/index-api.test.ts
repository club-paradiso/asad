import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  env: vi.fn(),
  translate: vi.fn(),
}));

vi.mock("@/lib/guard", () => ({ guardInferenceRoute: mocks.guard }));
vi.mock("@/lib/env", () => ({ appEnv: mocks.env }));
vi.mock("@/features/earbud/ensemble/providers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/earbud/ensemble/providers")>();
  return { ...original, translateIndex: mocks.translate };
});

import { POST } from "./route";

const input = {
  context: "conversation", source: "en-US", target: "ko-KR",
  lag: "fast", pending: "My E-7-1 visa has not been approved.", history: {},
};
const request = () => new Request("http://localhost/api/earbud/index", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify(input),
});

describe("Phase 4B access-gated Index live-provider route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ASAD_INDEX_TRANSLATE_PUBLIC", "1");
    mocks.guard.mockResolvedValue({ ok: true, body: input });
    mocks.env.mockReturnValue({ access: { key: "FAKE_PRIVATE_TEST_GATE" } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects an unconfigured deployment without calling the vendor", async () => {
    vi.stubEnv("ASAD_INDEX_TRANSLATE_PUBLIC", "0");
    expect((await POST(request())).status).toBe(503);
    expect(mocks.translate).not.toHaveBeenCalled();
  });
  it("returns a committed-looking, validation-screened Korean translation", async () => {
    mocks.translate.mockResolvedValue("제 E-7-1 비자가 아직 승인되지 않았습니다.");
    const response = await POST(request());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.provider).toBe("index");
    expect(payload.output.safeChunks).toHaveLength(1);
    expect(payload.output.safeChunks[0].text).toContain("E-7-1");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("will not voice an omitted code and reversed negation", async () => {
    mocks.translate.mockResolvedValue("제 비자가 승인됐습니다.");
    const payload = await (await POST(request())).json();
    expect(payload.provider).toBe("index-abstained");
    expect(payload.output.safeChunks).toEqual([]);
    expect(payload.output.confidence).toBe("low");
  });
  it("will not voice network errors", async () => {
    mocks.translate.mockRejectedValue(new Error("Public API unavailable."));
    const payload = await (await POST(request())).json();
    expect(payload.output.safeChunks).toEqual([]);
    expect(payload.degraded).toBe(true);
  });
  it("blocks unsupported language pairs before calling Index", async () => {
    mocks.guard.mockResolvedValueOnce({ ok: true, body: { ...input, target: "en-US" } });
    expect((await POST(request())).status).toBe(400);
    expect(mocks.translate).not.toHaveBeenCalled();
  });
});
