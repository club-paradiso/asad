import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Counter routing: Gateway first, router chain as hedge and fallback,
 * translation memory for repeated staff phrases, sensitive profiles pinned.
 */

const gateway = vi.hoisted(() => ({
  available: true,
  complete: vi.fn(),
}));
const general = vi.hoisted(() => ({
  wouldReach: vi.fn<(prefer?: unknown) => string | null>(() => "openrouter"),
  complete: vi.fn(),
}));
const sensitiveRouter = vi.hoisted(() => ({
  wouldReach: vi.fn<(prefer?: unknown) => string | null>(() => "openrouter"),
  complete: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/providers/llm/vercel-gateway", () => ({
  VERCEL_GATEWAY_MODEL: "google/test-flash",
  vercelGatewayAvailable: () => gateway.available,
  completeViaVercelGateway: gateway.complete,
}));
vi.mock("@/providers/llm", () => ({ llmRouter: () => general }));
vi.mock("@/providers/llm/router", () => ({
  OPEN_WEIGHT: () => true,
  LlmRouter: class {
    wouldReach = sensitiveRouter.wouldReach;
    complete = sensitiveRouter.complete;
  },
}));
vi.mock("@/lib/env", () => ({
  appEnv: () => ({
    llm: {
      counterPreferOpen: true,
      providers: { openrouter: { configured: true } },
      openrouter: { policy: { dataCollection: "deny" } },
    },
  }),
}));

import {
  COUNTER_HEDGE_MS,
  __resetCounterTranslationState,
  translateForCounter,
} from "./translate";

const json = (translation: string, confidence = "high") =>
  JSON.stringify({ translation, confidence });

/** A promise you resolve or reject later, plus a record of the abort signal. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const base = {
  sourceLang: "ko-KR",
  targetLang: "en-US",
  from: "host" as const,
  profileId: "immigration" as const,
};

beforeEach(() => {
  __resetCounterTranslationState();
  gateway.available = true;
  gateway.complete.mockReset();
  general.complete.mockReset();
  general.wouldReach.mockReset().mockReturnValue("openrouter");
  sensitiveRouter.complete.mockReset();
  delete process.env.COUNTER_TRANSLATION_ROUTE;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("gateway-first counter translation", () => {
  it("answers from the Gateway without touching the free router when it is fast", async () => {
    gateway.complete.mockResolvedValue({ text: json("Please wait a moment."), latencyMs: 400 });

    const result = await translateForCounter({ ...base, text: "잠시만 기다려 주세요." });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("vercel-gateway");
    expect(result.output?.translation).toBe("Please wait a moment.");
    expect(general.complete).not.toHaveBeenCalled();
  });

  it("falls straight to the router when the Gateway fails, and remembers the failure", async () => {
    gateway.complete.mockRejectedValue(Object.assign(new Error("insufficient credit"), { status: 402 }));
    general.complete.mockResolvedValue({
      provider: "openrouter",
      model: "free-model",
      response: { text: json("Please show me your passport."), latencyMs: 900 },
    });

    const first = await translateForCounter({ ...base, text: "여권 보여 주세요." });
    expect(first.ok).toBe(true);
    expect(first.provider).toBe("openrouter");

    // Cooldown: the next turn does not pay for another doomed Gateway call.
    general.complete.mockResolvedValue({
      provider: "openrouter",
      model: "free-model",
      response: { text: json("Sign here.", "medium"), latencyMs: 900 },
    });
    await translateForCounter({ ...base, text: "여기 서명하세요." });
    expect(gateway.complete).toHaveBeenCalledTimes(1);
  });

  it("hedges a slow Gateway with the router and takes whichever answers first", async () => {
    vi.useFakeTimers();
    const slowGateway = deferred<{ text: string; latencyMs: number }>();
    let gatewaySignal: AbortSignal | undefined;
    gateway.complete.mockImplementation((request: { signal?: AbortSignal }) => {
      gatewaySignal = request.signal;
      return slowGateway.promise;
    });
    general.complete.mockResolvedValue({
      provider: "openrouter",
      model: "free-model",
      response: { text: json("Next, please."), latencyMs: 300 },
    });

    const pending = translateForCounter({ ...base, text: "다음 분 오세요." });
    await vi.advanceTimersByTimeAsync(COUNTER_HEDGE_MS - 1);
    expect(general.complete).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(general.complete).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("openrouter");
    expect(result.output?.translation).toBe("Next, please.");
    // The losing Gateway request is cancelled, not left running.
    expect(gatewaySignal?.aborted).toBe(true);
  });

  it("does not hedge with nothing to hedge to", async () => {
    general.wouldReach.mockReturnValue(null);
    gateway.complete.mockRejectedValue(new Error("upstream down"));

    const result = await translateForCounter({ ...base, text: "안녕하세요." });

    expect(result.ok).toBe(false);
    expect(general.complete).not.toHaveBeenCalled();
  });

  it("keeps the old order when router-first is configured", async () => {
    process.env.COUNTER_TRANSLATION_ROUTE = "router-first";
    general.complete.mockResolvedValue({
      provider: "openrouter",
      model: "free-model",
      response: { text: json("Hello."), latencyMs: 300 },
    });

    const result = await translateForCounter({ ...base, text: "안녕하세요." });

    expect(result.provider).toBe("openrouter");
    expect(gateway.complete).not.toHaveBeenCalled();
  });
});

describe("translation memory", () => {
  it("answers a repeated staff phrase without a model call", async () => {
    gateway.complete.mockResolvedValue({ text: json("Please wait a moment."), latencyMs: 400 });

    await translateForCounter({ ...base, text: "잠시만 기다려 주세요." });
    const again = await translateForCounter({ ...base, text: "  잠시만   기다려 주세요. " });

    expect(again.ok).toBe(true);
    expect(again.provider).toBe("memory");
    expect(again.output?.translation).toBe("Please wait a moment.");
    expect(gateway.complete).toHaveBeenCalledTimes(1);
  });

  it("never stores what a visitor said", async () => {
    gateway.complete.mockResolvedValue({ text: json("잠시만요."), latencyMs: 400 });
    const visitor = { ...base, from: "guest" as const, sourceLang: "en-US", targetLang: "ko-KR" };

    await translateForCounter({ ...visitor, text: "One moment." });
    await translateForCounter({ ...visitor, text: "One moment." });

    expect(gateway.complete).toHaveBeenCalledTimes(2);
  });

  it("never stores a line carrying numbers, names or other details", async () => {
    gateway.complete.mockResolvedValue({ text: json("Come back at 3 PM."), latencyMs: 400 });

    await translateForCounter({ ...base, text: "오후 3시에 다시 오세요." });
    await translateForCounter({ ...base, text: "오후 3시에 다시 오세요." });

    expect(gateway.complete).toHaveBeenCalledTimes(2);
  });

  it("never stores an uncertain translation or a simplify request", async () => {
    gateway.complete.mockResolvedValue({ text: json("Maybe this.", "medium"), latencyMs: 400 });
    await translateForCounter({ ...base, text: "그거 해 주세요." });
    await translateForCounter({ ...base, text: "그거 해 주세요." });
    expect(gateway.complete).toHaveBeenCalledTimes(2);

    gateway.complete.mockResolvedValue({ text: json("Wait, please."), latencyMs: 400 });
    await translateForCounter({ ...base, text: "기다리세요.", action: "simplify" });
    await translateForCounter({ ...base, text: "기다리세요.", action: "simplify" });
    expect(gateway.complete).toHaveBeenCalledTimes(4);
  });
});

describe("sensitive profiles stay pinned", () => {
  it("never uses the Gateway or translation memory for a refugee session", async () => {
    sensitiveRouter.complete.mockResolvedValue({
      provider: "openrouter",
      model: "protected",
      response: { text: json("Please wait."), latencyMs: 500 },
    });

    const turn = { ...base, profileId: "refugee" as const, text: "잠시만 기다려 주세요." };
    const first = await translateForCounter(turn);
    const second = await translateForCounter(turn);

    expect(first.provider).toBe("openrouter");
    expect(second.provider).toBe("openrouter");
    expect(gateway.complete).not.toHaveBeenCalled();
    expect(sensitiveRouter.complete).toHaveBeenCalledTimes(2);
  });
});
