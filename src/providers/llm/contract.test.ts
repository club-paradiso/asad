/**
 * Shared provider contract tests.
 *
 * Every adapter must behave identically under failure, because the router's
 * decisions depend on that behaviour being uniform. A provider that reports a
 * 429 as an unknown error would silently defeat the rate-limit routing.
 *
 * These run against a stubbed `fetch`, so they need no credentials and no
 * network — which is what makes them runnable in CI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiLlmProvider } from "./gemini";
import { AnthropicLlmProvider } from "./anthropic";
import { OpenAiCompatibleLlmProvider } from "./openai-compatible";
import { LlmError } from "./errors";
import { parseDuration, readRateLimitHeaders } from "./http";
import type { LlmProvider } from "./types";

const KEY = "test-key-000000000000";

/** One factory per adapter, plus a body shaped the way that vendor answers. */
const ADAPTERS: Array<{
  name: string;
  create: () => LlmProvider;
  successBody: unknown;
  expectedText: string;
}> = [
  {
    name: "gemini",
    create: () => new GeminiLlmProvider({ apiKey: KEY, model: "gemini-3.5-flash-lite" }),
    successBody: {
      candidates: [{ content: { parts: [{ text: '{"safeChunks":[]}' }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 },
      modelVersion: "gemini-3.5-flash-lite",
    },
    expectedText: '{"safeChunks":[]}',
  },
  {
    name: "openai-compatible",
    create: () =>
      new OpenAiCompatibleLlmProvider({
        id: "groq",
        label: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: KEY,
        model: "openai/gpt-oss-120b",
        structuredOutput: "json_schema",
      }),
    successBody: {
      choices: [{ message: { content: '{"safeChunks":[]}' } }],
      model: "openai/gpt-oss-120b",
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    },
    expectedText: '{"safeChunks":[]}',
  },
  {
    name: "anthropic",
    create: () => new AnthropicLlmProvider({ apiKey: KEY, model: "claude-sonnet-5" }),
    successBody: {
      content: [{ type: "text", text: '"safeChunks":[]}' }],
      model: "claude-sonnet-5",
      usage: { input_tokens: 100, output_tokens: 20 },
    },
    // Anthropic prefills `{`, which the adapter restores.
    expectedText: '{"safeChunks":[]}',
  },
];

const respond = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });

/** Await a promise expected to reject with an LlmError, and return it typed. */
async function expectRejection(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LlmError);
    return error as LlmError;
  }
  throw new Error("expected the request to reject, but it resolved");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(ADAPTERS)("$name adapter contract", ({ create, successBody, expectedText }) => {
  const request = { system: "system", user: "user", maxOutputTokens: 700 };

  it("returns text, model and usage on success", async () => {
    fetchMock.mockResolvedValue(respond(successBody));
    const response = await create().complete(request);

    expect(response.text).toBe(expectedText);
    expect(response.model).toBeTruthy();
    expect(response.usage?.inputTokens).toBe(100);
    expect(response.usage?.outputTokens).toBe(20);
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("sends the API key in a header, never in the URL", async () => {
    fetchMock.mockResolvedValue(respond(successBody));
    await create().complete(request);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // A key in a query string ends up in access logs and proxy logs.
    expect(url).not.toContain(KEY);
    expect(JSON.stringify(init.headers)).toContain(KEY);
  });

  it("classifies 401 as permanent auth failure", async () => {
    fetchMock.mockResolvedValue(respond({ error: { message: "bad key" } }, { status: 401 }));
    await expect(create().complete(request)).rejects.toMatchObject({
      kind: "auth",
      retryable: false,
    });
  });

  it("classifies a plain 429 as retryable rate limiting", async () => {
    fetchMock.mockResolvedValue(respond({ error: { message: "slow down" } }, { status: 429 }));
    const error = await expectRejection(create().complete(request));
    expect(error.kind).toBe("rate_limited");
    expect(error.retryable).toBe(true);
  });

  it("distinguishes exhausted quota from a plain 429", async () => {
    fetchMock.mockResolvedValue(
      respond({ error: { message: "quota exceeded for this project" } }, { status: 429 }),
    );
    const error = await expectRejection(create().complete(request));
    // Different cooldown: "too fast" and "you are out" are not the same thing.
    expect(error.kind).toBe("quota_exhausted");
  });

  it("classifies 5xx as a retryable server error", async () => {
    fetchMock.mockResolvedValue(respond({}, { status: 503 }));
    await expect(create().complete(request)).rejects.toMatchObject({
      kind: "server_error",
      retryable: true,
    });
  });

  it("classifies 400 as permanent", async () => {
    fetchMock.mockResolvedValue(respond({ error: { message: "no such model" } }, { status: 400 }));
    await expect(create().complete(request)).rejects.toMatchObject({
      kind: "bad_request",
      retryable: false,
    });
  });

  it("reports missing content as malformed output", async () => {
    fetchMock.mockResolvedValue(respond({}));
    await expect(create().complete(request)).rejects.toMatchObject({ kind: "malformed_output" });
  });

  it("reports a non-JSON body as malformed output", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>gateway error</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(create().complete(request)).rejects.toMatchObject({ kind: "malformed_output" });
  });

  it("maps a network failure onto the network kind", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(create().complete(request)).rejects.toMatchObject({ kind: "network" });
  });

  it("honours Retry-After", async () => {
    fetchMock.mockResolvedValue(
      respond({ error: { message: "slow down" } }, { status: 429, headers: { "retry-after": "42" } }),
    );
    const error = await expectRejection(create().complete(request));
    expect(error.retryAfterSeconds).toBe(42);
  });

  it("aborts when the caller's signal fires", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );

    const promise = create().complete({ ...request, signal: controller.signal });
    controller.abort();

    // Superseded by newer Korean: a timeout, not a provider fault.
    await expect(promise).rejects.toMatchObject({ kind: "timeout" });
  });

  it("propagates an abort signal into fetch", async () => {
    fetchMock.mockResolvedValue(respond(successBody));
    await create().complete(request);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeDefined();
  });
});

describe("structured output requests", () => {
  it("gemini asks for native schema enforcement and disables thinking", async () => {
    fetchMock.mockResolvedValue(respond(ADAPTERS[0].successBody));
    await new GeminiLlmProvider({ apiKey: KEY, model: "m" }).complete({
      system: "s",
      user: "u",
      jsonSchema: { type: "object" },
      thinking: "none",
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig.responseJsonSchema).toEqual({ type: "object" });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    // The single biggest latency lever on Flash-class models.
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
  });

  it("openai-compatible asks for json_schema when the vendor supports it", async () => {
    fetchMock.mockResolvedValue(respond(ADAPTERS[1].successBody));
    await new OpenAiCompatibleLlmProvider({
      id: "groq",
      label: "Groq",
      baseUrl: "https://x/v1",
      apiKey: KEY,
      model: "m",
      structuredOutput: "json_schema",
    }).complete({ system: "s", user: "u", jsonSchema: { type: "object" } });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it("falls back to json_object when the vendor cannot enforce a schema", async () => {
    fetchMock.mockResolvedValue(respond(ADAPTERS[1].successBody));
    await new OpenAiCompatibleLlmProvider({
      id: "openrouter",
      label: "OpenRouter",
      baseUrl: "https://x/v1",
      apiKey: KEY,
      model: "m",
      structuredOutput: "json_object",
    }).complete({ system: "s", user: "u", jsonSchema: { type: "object" } });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.response_format.type).toBe("json_object");
  });
});

describe("rate-limit header parsing", () => {
  it("reads the de-facto standard headers", () => {
    const snapshot = readRateLimitHeaders(
      new Headers({
        "x-ratelimit-remaining-requests": "97",
        "x-ratelimit-remaining-tokens": "4200",
        "x-ratelimit-reset-tokens": "6s",
      }),
    );
    expect(snapshot?.requestsRemaining).toBe(97);
    expect(snapshot?.tokensRemaining).toBe(4200);
    expect(snapshot?.resetAt).toBeGreaterThan(Date.now());
  });

  it("returns undefined when the provider sends none", () => {
    expect(readRateLimitHeaders(new Headers())).toBeUndefined();
  });

  it("parses the duration formats these headers actually use", () => {
    expect(parseDuration("6s")).toBe(6000);
    expect(parseDuration("2m59.56s")).toBeCloseTo(179_560, -1);
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("1h2m")).toBe(3_720_000);
    expect(parseDuration("30")).toBe(30_000);
    expect(parseDuration(null)).toBeUndefined();
    expect(parseDuration("soon")).toBeUndefined();
  });
});
