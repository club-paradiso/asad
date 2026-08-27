/**
 * OpenRouter request construction.
 *
 * These assertions are about a body that must be LEGAL, not merely plausible.
 * The failure they exist to prevent is a 400 discovered during a service:
 * `require_parameters: true` asks OpenRouter to exclude upstreams that do not
 * support what we sent, so a parameter the model cannot accept does not just
 * error — it can empty the candidate pool and take the turn with it.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUTING_POLICY,
  buildOpenRouterBody,
  describePolicy,
  isStrictPolicy,
  providerRoutingBlock,
  strictExclusion,
  type OpenRouterRoutingPolicy,
} from "./openrouter";
import { capabilitiesForModel } from "./models";
import { INTERPRETER_JSON_SCHEMA } from "@/interpreter/prompts/json-schema";
import type { LlmRequest } from "./types";

const request = (overrides: Partial<LlmRequest> = {}): LlmRequest => ({
  system: "system",
  user: "user",
  maxOutputTokens: 700,
  temperature: 0.2,
  jsonSchema: INTERPRETER_JSON_SCHEMA,
  thinking: "none",
  ...overrides,
});

const build = (model: string, overrides: Partial<LlmRequest> = {}, policy = DEFAULT_ROUTING_POLICY) =>
  buildOpenRouterBody({ model, request: request(overrides), policy });

describe("provider routing block", () => {
  it("sends the latency-oriented live defaults", () => {
    expect(providerRoutingBlock(DEFAULT_ROUTING_POLICY)).toEqual({
      sort: "latency",
      allow_fallbacks: true,
      data_collection: "deny",
      require_parameters: true,
    });
  });

  it("adds zdr only when it is asked for", () => {
    expect(providerRoutingBlock(DEFAULT_ROUTING_POLICY).zdr).toBeUndefined();
    expect(
      providerRoutingBlock({ ...DEFAULT_ROUTING_POLICY, zdr: true }).zdr,
    ).toBe(true);
  });

  it("carries explicit upstream allow and deny lists", () => {
    const block = providerRoutingBlock({
      ...DEFAULT_ROUTING_POLICY,
      only: ["Google AI Studio"],
      ignore: ["SomeUpstream"],
    });
    expect(block.only).toEqual(["Google AI Studio"]);
    expect(block.ignore).toEqual(["SomeUpstream"]);
  });

  it("treats deny and zdr as strict, and an open policy as not", () => {
    expect(isStrictPolicy(DEFAULT_ROUTING_POLICY)).toBe(true);
    expect(isStrictPolicy({ ...DEFAULT_ROUTING_POLICY, zdr: true })).toBe(true);
    const open: OpenRouterRoutingPolicy = {
      ...DEFAULT_ROUTING_POLICY,
      dataCollection: "allow",
    };
    expect(isStrictPolicy(open)).toBe(false);
  });

  it("describes the constraints in force for a human-readable failure", () => {
    expect(describePolicy(DEFAULT_ROUTING_POLICY)).toContain("no data collection");
    expect(describePolicy({ ...DEFAULT_ROUTING_POLICY, zdr: true })).toContain(
      "zero data retention",
    );
  });
});

describe("model-compatible parameter emission", () => {
  it("sends temperature to a model that accepts sampling", () => {
    expect(build("google/gemini-3.7-flash").temperature).toBe(0.2);
  });

  it("omits temperature for a model that rejects sampling", () => {
    // The whole point of the capability registry: this body would 400, and
    // with require_parameters on it could exclude every upstream first.
    const body = build("openai/o3-mini");
    expect(body.temperature).toBeUndefined();
    expect(capabilitiesForModel("openai/o3-mini").sampling).toBe("rejected");
  });

  it("requests json_schema where the model enforces schemas", () => {
    const body = build("google/gemini-3.7-flash");
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "interpreter_output", strict: true },
    });
  });

  it("falls back to json_object where the model has no schema mode", () => {
    expect(build("anthropic/claude-sonnet-5").response_format).toEqual({
      type: "json_object",
    });
  });

  it("never asks for more output tokens than the model will produce", () => {
    const caps = capabilitiesForModel("google/gemini-3.7-flash");
    const body = build("google/gemini-3.7-flash", { maxOutputTokens: 100_000 });
    expect(body.max_tokens).toBe(caps.maxOutputTokens);
  });

  it("turns reasoning down using the field the family actually exposes", () => {
    expect(build("openai/gpt-oss-120b").reasoning_effort).toBe("low");
    expect(build("google/gemini-3.7-flash").reasoning).toEqual({
      exclude: true,
      enabled: false,
    });
    // No control exposed means no field, not a guess.
    expect(build("meta-llama/llama-3.3-70b-instruct").reasoning).toBeUndefined();
    expect(build("meta-llama/llama-3.3-70b-instruct").reasoning_effort).toBeUndefined();
  });

  it("does not try to disable reasoning on a model that cannot disable it", () => {
    const body = build("openai/o3-mini");
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it("always asks for usage accounting", () => {
    // Without this, "is the system prompt being re-billed every turn?" — the
    // largest single line in this workload — cannot be answered.
    expect(build("google/gemini-3.7-flash").usage).toEqual({ include: true });
  });

  it("carries the routing policy on every request", () => {
    const body = build("google/gemini-3.7-flash", {}, { ...DEFAULT_ROUTING_POLICY, zdr: true });
    expect(body.provider).toMatchObject({ zdr: true, data_collection: "deny" });
  });
});

describe("strict-routing exclusion", () => {
  it("recognises the messages that mean the policy excluded everything", () => {
    expect(strictExclusion("No allowed providers are available for the selected model.")).toBe(true);
    expect(strictExclusion("No endpoints found matching your data policy")).toBe(true);
    // A generic upstream failure is not a privacy exclusion and must not be
    // reported as one.
    expect(strictExclusion("Upstream returned 502")).toBe(false);
  });
});
