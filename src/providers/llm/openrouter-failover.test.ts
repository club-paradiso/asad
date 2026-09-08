import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FailoverOpenRouterLlmProvider,
  OPENROUTER_FREE_MODEL_FALLBACKS,
  freeOpenRouterFallbackModels,
} from "./openrouter-failover";
import { DEFAULT_ROUTING_POLICY } from "./openrouter";

const PRIMARY = "google/gemma-4-26b-a4b-it:free";
const KEY = "x".repeat(24);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("free OpenRouter model failover", () => {
  it("offers only zero-cost recovery for an explicitly free primary", () => {
    expect(freeOpenRouterFallbackModels(PRIMARY)).toEqual([
      "nvidia/nemotron-3-super-120b-a12b:free",
      "openrouter/free",
    ]);
    expect(freeOpenRouterFallbackModels("google/gemini-3.7-flash")).toEqual([]);
    expect(OPENROUTER_FREE_MODEL_FALLBACKS).not.toContain(PRIMARY);
  });

  it("moves to the concrete free fallback when the primary shared pool returns 429", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "Provider returned error",
              metadata: { raw: `${PRIMARY} is temporarily rate-limited upstream.` },
            },
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: "nvidia/nemotron-3-super-120b-a12b:free",
            provider: "NVIDIA",
            choices: [{ message: { content: '{"ok":true,"language":"ko"}' } }],
            usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18, cost: 0 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new FailoverOpenRouterLlmProvider(
      { apiKey: KEY, model: PRIMARY, policy: DEFAULT_ROUTING_POLICY },
      freeOpenRouterFallbackModels(PRIMARY),
    );

    const response = await provider.complete({
      system: "Return JSON.",
      user: "Health check.",
      maxOutputTokens: 64,
      temperature: 0,
      thinking: "none",
    });

    expect(response.model).toBe("nvidia/nemotron-3-super-120b-a12b:free");
    expect(provider.lastModel).toBe("nvidia/nemotron-3-super-120b-a12b:free");
    expect(provider.lastTurn?.upstream).toBe("NVIDIA");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody.model).toBe(PRIMARY);
    expect(secondBody.model).toBe("nvidia/nemotron-3-super-120b-a12b:free");
    expect(secondBody.provider).toMatchObject({ data_collection: "deny" });
  });

  it("does not hide an authentication failure behind model retries", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("unauthorised", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new FailoverOpenRouterLlmProvider(
      { apiKey: KEY, model: PRIMARY, policy: DEFAULT_ROUTING_POLICY },
      freeOpenRouterFallbackModels(PRIMARY),
    );

    await expect(
      provider.complete({ system: "system", user: "user", maxOutputTokens: 32 }),
    ).rejects.toMatchObject({ kind: "auth" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
