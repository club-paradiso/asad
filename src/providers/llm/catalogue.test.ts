import { describe, expect, it } from "vitest";
import {
  VERIFIED_FALLBACK,
  freeOpenWeightModels,
  toSuggestion,
} from "./catalogue";

/**
 * A catalogue entry shaped like OpenRouter's, with only the fields this module
 * reads. Everything else the upstream sends is deliberately ignored.
 */
const entry = (over: Record<string, unknown> = {}) => ({
  id: "meta-llama/llama-3.3-70b-instruct:free",
  name: "Llama 3.3 70B Instruct",
  context_length: 131_072,
  pricing: { prompt: "0", completion: "0" },
  supported_parameters: ["response_format", "structured_outputs", "temperature"],
  ...over,
});

const catalogue = (models: unknown[]) =>
  (async () =>
    new Response(JSON.stringify({ data: models }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

describe("filtering OpenRouter's catalogue", () => {
  it("accepts a free, open-weight, schema-capable model", () => {
    expect(toSuggestion(entry())?.id).toBe("meta-llama/llama-3.3-70b-instruct:free");
  });

  it("rejects anything that costs money", () => {
    // The whole point of the list is models a deployment can run for nothing.
    expect(toSuggestion(entry({ pricing: { prompt: "0.0000005", completion: "0" } }))).toBeNull();
    expect(toSuggestion(entry({ pricing: undefined }))).toBeNull();
  });

  it("reads zero however the upstream spells it", () => {
    expect(toSuggestion(entry({ pricing: { prompt: 0, completion: 0 } }))).not.toBeNull();
    expect(toSuggestion(entry({ pricing: { prompt: "0.0", completion: "0.0" } }))).not.toBeNull();
  });

  it("rejects proprietary models however cheap", () => {
    // "Free" is not the requirement being served here; open weights is.
    expect(toSuggestion(entry({ id: "google/gemini-3.7-flash" }))).toBeNull();
  });

  it("rejects a model that cannot be asked for JSON", () => {
    // Every turn in this application is a schema-validated object. A model
    // that can only chat fails the first live turn, not the tenth.
    expect(toSuggestion(entry({ supported_parameters: ["temperature"] }))).toBeNull();
    expect(toSuggestion(entry({ supported_parameters: undefined }))).toBeNull();
  });

  it("rejects a model that reasons before every answer", () => {
    // Live suitability is judged by the same rule the router uses, so the list
    // can never recommend something the launcher would refuse to drive.
    expect(toSuggestion(entry({ id: "deepseek/deepseek-r1:free" }))).toBeNull();
  });

  it("ignores junk entries instead of failing the whole read", () => {
    expect(toSuggestion({ nonsense: true })).toBeNull();
    expect(toSuggestion(null)).toBeNull();
  });
});

describe("reading the catalogue", () => {
  it("returns the qualifying models, widest context first", async () => {
    const result = await freeOpenWeightModels({
      fetchImpl: catalogue([
        entry({ id: "qwen/qwen3-32b:free", context_length: 32_768 }),
        entry({ id: "meta-llama/llama-3.3-70b-instruct:free", context_length: 131_072 }),
        entry({ id: "openai/gpt-4.1-mini", pricing: { prompt: "1", completion: "1" } }),
      ]),
    });

    expect(result.ok).toBe(true);
    expect(result.models.map((m) => m.id)).toEqual([
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen3-32b:free",
    ]);
  });

  it("falls back to verified slugs when the catalogue cannot be read", async () => {
    // "We could not check" and "there is nothing" are different answers and
    // must not look alike — the deployer still gets something to pin.
    const result = await freeOpenWeightModels({
      fetchImpl: (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.models).toEqual(VERIFIED_FALLBACK);
    if (!result.ok) expect(result.reason).toMatch(/503/);
  });

  it("falls back when the payload is not the shape we expect", async () => {
    const result = await freeOpenWeightModels({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ unexpected: true }), { status: 200 })) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.models).toEqual(VERIFIED_FALLBACK);
  });

  it("falls back when nothing in a readable catalogue qualifies", async () => {
    const result = await freeOpenWeightModels({
      fetchImpl: catalogue([entry({ pricing: { prompt: "9", completion: "9" } })]),
    });
    expect(result.ok).toBe(false);
    expect(result.models).toEqual(VERIFIED_FALLBACK);
    if (!result.ok) expect(result.reason).toMatch(/no free open-weight/i);
  });

  it("never suggests a slug it has not seen or verified", async () => {
    // The failure this module exists to prevent: a plausible-looking model id
    // that 404s the first time a service starts.
    const result = await freeOpenWeightModels({
      fetchImpl: catalogue([entry()]),
    });
    for (const model of result.models) {
      expect(model.id).toBe("meta-llama/llama-3.3-70b-instruct:free");
    }
  });
});
