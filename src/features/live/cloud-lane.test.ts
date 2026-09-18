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
import {
  clientTurnBudgetMs,
  createCloudLane,
  INTERPRET_RETRY_DELAYS_MS,
} from "./cloud-lane";
import { SESSION_QUOTA_BYPASS_MS, TEMPORARY_RATE_LIMIT_BYPASS_MS } from "./cloud-degradation";

const request: InterpretRequest = {
  context: "worship",
  source: "ko-KR",
  target: "en-US",
  lag: "fast",
  pending: "오늘 우리는 서로를 사랑해야 합니다.",
  history: { recentKorean: [], recentEnglish: [], glossary: [], entities: [], scripture: [], corrections: [] },
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

function lane(options: {
  translator?: boolean;
  responses: Array<() => Response>;
  /** Wall-clock the mocked transport burns on every attempt. */
  elapsePerCall?: number;
}) {
  let now = 1_000_000;
  const fetchImpl = vi.fn(async () => {
    const next = options.responses.shift();
    if (!next) throw new Error("unexpected fetch");
    // Responses may move the clock, which is how the turn-budget rules are
    // exercised without real timers.
    now += options.elapsePerCall ?? 0;
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

/**
 * The turn budget.
 *
 * Three attempts, each able to burn a full server turn, was roughly seventeen
 * seconds of one sentence — and the fetch itself had no deadline at all, so a
 * connection that opened and then stalled held this lane open indefinitely and
 * nothing else dispatched behind it.
 */
describe("the turn budget", () => {
  const serverError = () => new Response("", { status: 503 });

  it("stops retrying once the answer could no longer be read in time", async () => {
    const l = lane({
      responses: Array.from({ length: INTERPRET_RETRY_DELAYS_MS.length }, () => serverError),
      // Each attempt eats most of this turn, leaving no room for a third.
      elapsePerCall: clientTurnBudgetMs(request.lag) * 0.45,
    });
    const result = await l.interpret(request, new AbortController().signal, turn(false));
    expect(result.provider).toBe("browser-on-device");
    // One retry, not two: after the second attempt there is no useful budget
    // left, so the lane takes what it can get rather than spending the rest of
    // the turn proving the server is still broken.
    expect(l.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("still uses its full ladder when attempts are cheap", async () => {
    const l = lane({
      responses: Array.from({ length: INTERPRET_RETRY_DELAYS_MS.length }, () => serverError),
      elapsePerCall: 50,
    });
    await l.interpret(request, new AbortController().signal, turn(false));
    expect(l.fetchImpl).toHaveBeenCalledTimes(INTERPRET_RETRY_DELAYS_MS.length);
  });

  it("falls back rather than waiting out a transport that never answers", async () => {
    // A stalled connection: the request is accepted and then nothing happens
    // until something aborts it. Before the deadline existed nothing did, so
    // the contextual lane stayed occupied for the rest of the session and the
    // console simply stopped producing English.
    vi.useFakeTimers();
    try {
      const translate = vi.fn(async (input: string) => `EN(${input})`);
      const stalled = createCloudLane({
        fetchImpl: (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
        browserTranslator: () => ({ translate, destroy() {} }),
        local: () => ({ safeChunks: [{ text: "[local]", confidence: "low" }], confidence: "low" }),
        telemetry: new ClientLatencyQueue("t"),
      });

      const pending = stalled.interpret(request, new AbortController().signal, turn(false));
      await vi.advanceTimersByTimeAsync(clientTurnBudgetMs(request.lag) + 10);
      const result = await pending;

      expect(result.provider).toBe("browser-on-device");
      expect(result.reason).toContain("did not answer inside this turn");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a safer lag profile a longer budget than a faster one", () => {
    expect(clientTurnBudgetMs("safe")).toBeGreaterThan(clientTurnBudgetMs("balanced"));
    expect(clientTurnBudgetMs("balanced")).toBeGreaterThan(clientTurnBudgetMs("fast"));
  });
});
