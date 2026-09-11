/**
 * The browser's contextual lane, without React or a network.
 *
 * The quota-bypass and fallback rules used to live inside `useLiveSession` and
 * could only be exercised end-to-end. These tests pin the rules directly.
 */
import { describe, expect, it, vi } from "vitest";
import type { InterpretRequest } from "@/lib/schema";
import type { BrowserTranslatorSession } from "@/providers/llm/browser-translator";
import { ClientLatencyQueue } from "./client-latency";
import { createCloudLane, INTERPRET_RETRY_DELAYS_MS } from "./cloud-lane";
import { SESSION_QUOTA_BYPASS_MS, TEMPORARY_RATE_LIMIT_BYPASS_MS } from "./cloud-degradation";

const request: InterpretRequest = {
  mode: "sermon",
  lag: "fast",
  pending: "오늘 우리는 서로를 사랑해야 합니다.",
  context: { recentKorean: [], recentEnglish: [], glossary: [], entities: [], scripture: [], corrections: [] },
  continuesPrevious: false,
  allowAnticipation: false,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const cloudOk = () =>
  json({
    output: { safeChunks: [{ text: "We should love one another today.", confidence: "high" }], confidence: "high" },
    provider: "openrouter",
    model: "free-model",
  });

const quotaDead = () =>
  json({
    output: { safeChunks: [{ text: "오늘 우리는 서로를 사랑해야 합니다.", confidence: "medium" }], confidence: "medium" },
    provider: "local",
    model: "deterministic",
    degraded: true,
    reason: "OpenRouter rate limit exceeded: free-models-per-day quota exhausted",
  });

function lane(options: { translator?: boolean; responses: Array<() => Response> }) {
  let now = 1_000_000;
  const fetchImpl = vi.fn(async () => {
    const next = options.responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next();
  });
  const translate = vi.fn(async (input: string) => `EN(${input})`);
  const translator: BrowserTranslatorSession | null =
    options.translator === false ? null : { translate, destroy() {} };
  const providers: Array<string | undefined> = [];
  const created = createCloudLane({
    fetchImpl,
    browserTranslator: () => translator,
    local: () => ({ safeChunks: [{ text: "[local]", confidence: "low" }], confidence: "low" }),
    telemetry: new ClientLatencyQueue("t"),
    onProvider: (provider) => providers.push(provider),
    now: () => now,
    sleep: async () => {},
  });
  return {
    ...created,
    fetchImpl,
    translate,
    providers,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const turn = (covered: boolean) => ({ turnIds: [1], provisionalSettled: () => Promise.resolve(covered) });

describe("cloud lane", () => {
  it("returns the cloud answer and clears any bypass on success", async () => {
    const l = lane({ responses: [cloudOk] });
    const result = await l.interpret(request, new AbortController().signal, turn(false));
    expect(result.provider).toBe("openrouter");
    expect(result.output.safeChunks[0].text).toBe("We should love one another today.");
    expect(result.clientDispatchedAt).toBeDefined();
    expect(l.bypassUntil()).toBe(0);
  });

  it("stops calling a quota-dead cloud for the rest of the window when Chrome can translate", async () => {
    const l = lane({ responses: [quotaDead, cloudOk] });
    const first = await l.interpret(request, new AbortController().signal, turn(false));
    expect(first.provider).toBe("browser-on-device");
    expect(l.translate).toHaveBeenCalledTimes(1);
    expect(l.fetchImpl).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i += 1) {
      l.advance(60_000);
      const next = await l.interpret(request, new AbortController().signal, turn(false));
      expect(next.provider).toBe("browser-on-device");
    }
    expect(l.fetchImpl).toHaveBeenCalledTimes(1);

    l.advance(SESSION_QUOTA_BYPASS_MS);
    const after = await l.interpret(request, new AbortController().signal, turn(false));
    expect(after.provider).toBe("openrouter");
    expect(l.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses the short cooldown for a bare HTTP 429 and does not retry it in-turn", async () => {
    const l = lane({ responses: [() => new Response("", { status: 429 }), cloudOk] });
    const result = await l.interpret(request, new AbortController().signal, turn(false));
    expect(result.provider).toBe("browser-on-device");
    expect(l.fetchImpl).toHaveBeenCalledTimes(1);
    l.advance(TEMPORARY_RATE_LIMIT_BYPASS_MS - 1);
    await l.interpret(request, new AbortController().signal, turn(false));
    expect(l.fetchImpl).toHaveBeenCalledTimes(1);
    l.advance(2);
    await l.interpret(request, new AbortController().signal, turn(false));
    expect(l.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not translate a second time when the fast lane already covered the turn", async () => {
    const l = lane({ responses: [quotaDead] });
    const result = await l.interpret(request, new AbortController().signal, turn(true));
    expect(result.provider).toBe("browser-on-device");
    expect(result.output.safeChunks).toEqual([]);
    expect(result.degraded).toBe(true);
    expect(l.translate).not.toHaveBeenCalled();
    expect(l.bypassUntil()).toBeGreaterThan(0);

    // While bypassed and covered, the lane costs no network and no translation.
    const skipped = await l.interpret(request, new AbortController().signal, turn(true));
    expect(skipped.provider).toBe("browser-on-device");
    expect(l.fetchImpl).toHaveBeenCalledTimes(1);
    expect(l.translate).not.toHaveBeenCalled();
  });

  it("stays cloud-first with no translator: no bypass, retries, then the deterministic floor", async () => {
    const l = lane({ translator: false, responses: [quotaDead, quotaDead] });
    const first = await l.interpret(request, new AbortController().signal, turn(false));
    expect(first.provider).toBe("local");
    expect(first.output.safeChunks[0].text).toBe("[local]");
    expect(l.bypassUntil()).toBe(0);

    const second = await l.interpret(request, new AbortController().signal, turn(false));
    expect(second.provider).toBe("local");
    expect(l.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries recoverable server failures and then falls back without suppressing cloud", async () => {
    const l = lane({
      responses: Array.from({ length: INTERPRET_RETRY_DELAYS_MS.length }, () => () => new Response("", { status: 503 })),
    });
    const result = await l.interpret(request, new AbortController().signal, turn(false));
    expect(result.provider).toBe("browser-on-device");
    expect(l.fetchImpl).toHaveBeenCalledTimes(INTERPRET_RETRY_DELAYS_MS.length);
    expect(l.bypassUntil()).toBe(0);
  });

  it("propagates an abort instead of falling back", async () => {
    const controller = new AbortController();
    const l = lane({
      responses: [
        () => {
          controller.abort();
          throw new DOMException("aborted", "AbortError");
        },
      ],
    });
    await expect(l.interpret(request, controller.signal, turn(false))).rejects.toThrow();
    expect(l.translate).not.toHaveBeenCalled();
  });
});
