import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiLlmProvider } from "./gemini";

const TEST_CREDENTIAL = "testcredentialvalue0000";

const respond = () =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"translation":"hello"}' }] } }],
      modelVersion: "gemma-4-26b-a4b-it",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("Gemma 4 through the Gemini API", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(respond());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses thinkingLevel=minimal instead of the legacy thinkingBudget", async () => {
    await new GeminiLlmProvider({ apiKey: TEST_CREDENTIAL, model: "gemma-4-26b-a4b-it" }).complete({
      system: "Translate accurately.",
      user: "안녕하세요",
      thinking: "none",
      jsonSchema: { type: "object" },
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBeUndefined();
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema).toEqual({ type: "object" });
  });

  it("maps generic medium thinking to Gemma 4 high", async () => {
    await new GeminiLlmProvider({ apiKey: TEST_CREDENTIAL, model: "gemma-4-31b-it" }).complete({
      system: "s",
      user: "u",
      thinking: "medium",
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "high" });
  });
});
