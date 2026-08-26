/**
 * OpenRouter as a first-class production gateway.
 *
 * OpenRouter speaks the OpenAI chat-completions wire format, which is why it
 * previously shared the generic adapter. That was a mistake of category: the
 * wire format is the least interesting thing about it. OpenRouter is a
 * *router*, and the decisions that matter for live interpretation — which
 * upstream serves the request, whether that upstream may retain the sermon,
 * whether it supports the parameters the turn depends on, how long it may take
 * — are all expressed in an `provider` block the generic adapter had no way to
 * send.
 *
 * Three invariants:
 *
 *  1. **Privacy never relaxes silently.** `data_collection: "deny"` and ZDR are
 *     sent when configured, and if strict routing leaves no eligible upstream
 *     the turn FAILS and says so. It does not quietly widen the policy and
 *     succeed.
 *  2. **Only model-compatible parameters are emitted.** The capability registry
 *     decides; the body is assembled from it. This matters more here than
 *     anywhere else, because `require_parameters: true` asks OpenRouter to
 *     exclude upstreams that do not support what we sent — so sending a
 *     parameter the model cannot take does not merely 400, it can empty the
 *     candidate pool.
 *  3. **The model is pinned per session.** Provider-level failover for the same
 *     model is fine and desirable. Model-family roulette between sentences is
 *     not: terminology and register drift, and the interpreter is the one who
 *     has to absorb it mid-sentence.
 */
import { LlmError } from "./errors";
import { postJson } from "./http";
import { capabilitiesForModel, type ModelCapabilities } from "./models";
import type { LlmProvider, LlmRequest, LlmResponse, LlmUsage } from "./types";

/* -------------------------------------------------------------------------- */
/* Routing policy                                                              */
/* -------------------------------------------------------------------------- */

/** How OpenRouter should order candidate upstreams. */
export type ProviderSort = "latency" | "throughput" | "price";

/** Whether upstreams that may retain prompts are acceptable. */
export type DataCollectionPolicy = "deny" | "allow";

/**
 * The routing policy, as configuration rather than as JSON scattered through
 * route handlers.
 */
export interface OpenRouterRoutingPolicy {
  /**
   * Ordering preference. `latency` for the live path — a perfect answer that
   * arrives after the interpreter has moved on is worth nothing.
   */
  sort: ProviderSort;
  /**
   * Whether a failed upstream may be retried on another upstream serving the
   * SAME model. This is not model roulette and does not threaten terminology
   * consistency, so it defaults on.
   */
  allowFallbacks: boolean;
  /** Refuse upstreams that may retain or train on submitted content. */
  dataCollection: DataCollectionPolicy;
  /**
   * Zero-data-retention. Stricter than `data_collection: deny`: it excludes
   * upstreams that retain content even transiently for abuse monitoring.
   */
  zdr: boolean;
  /**
   * Exclude upstreams that do not support every parameter we sent, rather than
   * letting them silently drop `response_format` and return prose.
   */
  requireParameters: boolean;
  /** Explicit allow-list of upstream names, when a deployer insists. */
  only?: readonly string[];
  /** Explicit deny-list of upstream names. */
  ignore?: readonly string[];
}

/**
 * Default primary model for the live path.
 *
 * A DEFAULT, not a constant: every model id in this application is
 * overrideable by environment variable, because models are deprecated on their
 * own schedule and that must never require a code change. What the code
 * guarantees is not that this slug exists forever — it is that whatever slug is
 * configured has its capabilities resolved before a request is built, and that
 * `npm run health:openrouter` will tell a deployer whether the configured slug
 * actually resolves and returns valid structured output.
 *
 * Chosen for the live path because interpretation is latency-bound: a fast
 * Flash-class model that answers in under a second beats a stronger model that
 * answers after the interpreter has already spoken.
 */
export const OPENROUTER_DEFAULT_PRIMARY_MODEL = "google/gemini-3.7-flash";

export const DEFAULT_ROUTING_POLICY: OpenRouterRoutingPolicy = {
  sort: "latency",
  allowFallbacks: true,
  dataCollection: "deny",
  zdr: false,
  requireParameters: true,
};

/**
 * Whether a policy is strict enough that failing it must be visible.
 *
 * Used by the router: a turn that could only have succeeded by relaxing one of
 * these degrades loudly instead.
 */
export const isStrictPolicy = (policy: OpenRouterRoutingPolicy): boolean =>
  policy.zdr || policy.dataCollection === "deny";

/** The `provider` block OpenRouter expects. Exported for tests. */
export function providerRoutingBlock(
  policy: OpenRouterRoutingPolicy,
): Record<string, unknown> {
  const block: Record<string, unknown> = {
    sort: policy.sort,
    allow_fallbacks: policy.allowFallbacks,
    data_collection: policy.dataCollection,
    require_parameters: policy.requireParameters,
  };
  if (policy.zdr) block.zdr = true;
  if (policy.only?.length) block.only = [...policy.only];
  if (policy.ignore?.length) block.ignore = [...policy.ignore];
  return block;
}

/* -------------------------------------------------------------------------- */
/* Request construction                                                        */
/* -------------------------------------------------------------------------- */

export interface OpenRouterBodyInput {
  model: string;
  request: LlmRequest;
  policy: OpenRouterRoutingPolicy;
  /** Resolved once by the caller so tests can inject. */
  capabilities?: ModelCapabilities;
}

/**
 * Assemble the request body, emitting only what the model can accept.
 *
 * Pure and exported because this is the function that has to be *right*, and
 * "we sent a legal body" is a claim worth asserting in a test rather than
 * discovering from a 400 during a service.
 */
export function buildOpenRouterBody(input: OpenRouterBodyInput): Record<string, unknown> {
  const { request, policy } = input;
  const caps = input.capabilities ?? capabilitiesForModel(input.model);

  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
    // Never above what the model will actually produce: a ceiling higher than
    // the model's own truncates mid-JSON, which reads as a hallucination.
    max_tokens: Math.min(request.maxOutputTokens ?? caps.maxOutputTokens, caps.maxOutputTokens),
    provider: providerRoutingBlock(policy),
    // Ask for token accounting back. Without it "is the system prompt being
    // re-billed every turn?" is unanswerable, and that is the single largest
    // line in this workload.
    usage: { include: true },
  };

  // Sampling is not universal. Reasoning-first models reject it outright, and
  // with require_parameters on, sending it to one would empty the pool.
  if (caps.sampling === "supported" && request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  // Structured output, at the strongest level the model actually supports.
  if (request.jsonSchema && caps.structuredOutput === "json_schema") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "interpreter_output",
        strict: true,
        schema: request.jsonSchema,
      },
    };
  } else if (caps.structuredOutput !== "none") {
    body.response_format = { type: "json_object" };
  }

  // Live interpretation never wants extended reasoning. Where the control
  // exists, turn it to its floor; where it does not, say nothing.
  if (request.thinking !== undefined && !caps.reasoningAlwaysOn) {
    if (caps.reasoning === "reasoning_effort") {
      body.reasoning_effort = request.thinking === "none" ? "low" : request.thinking;
    } else if (caps.reasoning === "reasoning") {
      body.reasoning =
        request.thinking === "none" ? { exclude: true, enabled: false } : { effort: request.thinking };
    }
  }

  return body;
}

/* -------------------------------------------------------------------------- */
/* Adapter                                                                     */
/* -------------------------------------------------------------------------- */

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  policy: OpenRouterRoutingPolicy;
  baseUrl?: string;
  /** Attribution headers. OpenRouter surfaces these on the account dashboard. */
  referer?: string;
  title?: string;
}

interface OpenRouterChoice {
  message?: { content?: string | null };
  finish_reason?: string;
  native_finish_reason?: string;
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  model?: string;
  /** The upstream that actually served the request. */
  provider?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; code?: number | string; metadata?: unknown };
}

/** What OpenRouter told us about this specific turn, beyond the text. */
export interface OpenRouterTurnDetail {
  /** Upstream name, e.g. "Google AI Studio". Never a key. */
  upstream?: string;
  /** Reported cost in USD, when accounting was returned. */
  costUsd?: number;
  /** Why generation stopped. `length` here means the answer was truncated. */
  finishReason?: string;
}

const NO_UPSTREAM_HINTS = [
  "no allowed providers",
  "no endpoints found",
  "no providers available",
  "no eligible providers",
];

export class OpenRouterLlmProvider implements LlmProvider {
  readonly id = "openrouter" as const;
  readonly model: string;
  readonly capabilities: ModelCapabilities;
  /** Detail from the most recent turn, for diagnostics. Counts only. */
  lastTurn?: OpenRouterTurnDetail;

  constructor(private readonly config: OpenRouterConfig) {
    this.model = config.model;
    this.capabilities = capabilitiesForModel(config.model);
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const body = buildOpenRouterBody({
      model: this.config.model,
      request,
      policy: this.config.policy,
      capabilities: this.capabilities,
    });

    const { json, rateLimit, latencyMs } = await postJson({
      url: `${(this.config.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "")}/chat/completions`,
      body,
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "HTTP-Referer": this.config.referer ?? "https://github.com/lucanomics/tong-yuck",
        "X-Title": this.config.title ?? "tong-yuck",
      },
      // Belt and braces above the router's own deadline signal.
      timeoutMs: request.signal ? 30_000 : 10_000,
      label: "OpenRouter",
      signal: request.signal,
    });

    const data = json as OpenRouterResponse;

    // A 200 carrying an error body is OpenRouter's way of reporting that
    // routing itself failed — most importantly, that the privacy policy
    // excluded every upstream. That must surface as a failure, never as a
    // silent relaxation.
    if (data.error?.message) {
      throw new LlmError(
        strictExclusion(data.error.message)
          ? `OpenRouter found no provider meeting the configured privacy policy (${describePolicy(this.config.policy)}). ${data.error.message}`
          : `OpenRouter: ${data.error.message}`,
        strictExclusion(data.error.message) ? "bad_request" : "server_error",
      );
    }

    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    if (!content) {
      throw new LlmError("OpenRouter returned no content.", "malformed_output");
    }

    this.lastTurn = {
      upstream: data.provider,
      costUsd: data.usage?.cost,
      finishReason: choice?.finish_reason ?? choice?.native_finish_reason,
    };

    return {
      text: content,
      model: data.model ?? this.config.model,
      usage: mapUsage(data.usage),
      rateLimit,
      latencyMs,
    };
  }
}

/** Whether an error message means the routing policy excluded everything. */
export const strictExclusion = (message: string): boolean => {
  const text = message.toLowerCase();
  return NO_UPSTREAM_HINTS.some((hint) => text.includes(hint));
};

/** One line naming the constraints in force, for an error a human will read. */
export const describePolicy = (policy: OpenRouterRoutingPolicy): string =>
  [
    policy.zdr ? "zero data retention" : null,
    policy.dataCollection === "deny" ? "no data collection" : null,
    policy.requireParameters ? "full parameter support" : null,
  ]
    .filter(Boolean)
    .join(", ") || "no constraints";

const mapUsage = (usage: OpenRouterResponse["usage"]): LlmUsage | undefined =>
  usage
    ? {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        cachedInputTokens: usage.prompt_tokens_details?.cached_tokens,
      }
    : undefined;
