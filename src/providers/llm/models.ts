/**
 * Model capability registry.
 *
 * The assumption this file exists to kill: *every OpenAI-compatible model
 * accepts the same generation parameters*. It does not. Sending
 * `temperature` to a model that rejects sampling is a 400; sending
 * `response_format: json_schema` to one that only knows `json_object` is a
 * 400; asking for eight hundred output tokens from a model capped at five
 * hundred truncates mid-JSON and looks exactly like a hallucination.
 *
 * On a live path that dispatches ~11 times a minute, each of those is a turn
 * the interpreter does not get.
 *
 * Two layers, in order:
 *
 *   1. **Explicit entries** for the model families tong-yuck is actually
 *      deployed against. Hand-checked, and the only place a claim is asserted.
 *   2. **Pattern inference** for everything else, because a deployer may pin
 *      any slug OpenRouter serves and a code change must never be required to
 *      do so. Inference is deliberately CONSERVATIVE: when unsure it claims
 *      less capability, not more, because the cost of under-claiming is a
 *      slightly larger prompt and the cost of over-claiming is a failed turn.
 *
 * Nothing here is a trust boundary. Zod still validates every response.
 */

/** How a model wants structured output requested. */
export type StructuredOutputSupport =
  /** `response_format: { type: "json_schema", json_schema: {...} }`. */
  | "json_schema"
  /** `response_format: { type: "json_object" }` — JSON, but unconstrained. */
  | "json_object"
  /** Nothing supported; the prompt is the only lever. */
  | "none";

/**
 * Whether sampling parameters (`temperature`, `top_p`) may be sent.
 *
 * Reasoning-first models reject them outright rather than ignoring them.
 */
export type SamplingSupport = "supported" | "rejected";

/** The vendor field name for turning reasoning down, where one exists. */
export type ReasoningControl = "reasoning_effort" | "reasoning" | "none";

/**
 * Rough dispatch-to-last-token expectation for a short live turn.
 *
 * Not a measurement — a routing hint. Real numbers come from telemetry, and
 * telemetry outranks this the moment it has samples.
 */
export type LatencyClass = "fast" | "standard" | "slow";

export interface ModelCapabilities {
  /** The slug as configured. */
  id: string;
  /** Human-facing family name, for diagnostics. */
  family: string;
  structuredOutput: StructuredOutputSupport;
  sampling: SamplingSupport;
  reasoning: ReasoningControl;
  /**
   * True when the model reasons regardless of what it is asked.
   *
   * Disqualifying for the live path: an unbounded thinking phase in front of
   * every turn is precisely the failure mode simultaneous interpretation
   * cannot absorb.
   */
  reasoningAlwaysOn: boolean;
  /** Ceiling we are willing to request for a live turn. */
  maxOutputTokens: number;
  contextTokens?: number;
  latencyClass: LatencyClass;
  /** Whether this model is fit to drive a live simultaneous session. */
  liveSuitable: boolean;
  /** Whether the provider serves the unchanging system prompt from cache. */
  promptCaching: boolean;
  /** Open weights, which is a privacy and portability property. */
  openWeights: boolean;
  /** How this record was arrived at. Surfaced in diagnostics. */
  source: "registry" | "inferred";
  /** Why inference landed where it did, when it was inference. */
  note?: string;
}

/** Everything except `id`/`source`, which are filled in by the resolver. */
type CapabilityShape = Omit<ModelCapabilities, "id" | "source">;

/**
 * The conservative floor.
 *
 * An unrecognised slug gets this: JSON object mode rather than schema mode,
 * sampling allowed (near-universal), no reasoning control, and a modest output
 * ceiling. It is usable, and nothing it claims is likely to 400.
 */
const CONSERVATIVE: CapabilityShape = {
  family: "unknown",
  structuredOutput: "json_object",
  sampling: "supported",
  reasoning: "none",
  reasoningAlwaysOn: false,
  maxOutputTokens: 700,
  latencyClass: "standard",
  liveSuitable: true,
  promptCaching: false,
  openWeights: false,
  note: "Unrecognised model id — conservative defaults applied.",
};

/**
 * Pattern table, evaluated in order; first match wins.
 *
 * Ordering matters: the reasoning-model patterns must precede their family's
 * general pattern, or a reasoning variant inherits the chat variant's claim
 * that sampling is legal.
 */
const PATTERNS: ReadonlyArray<{ match: RegExp; caps: CapabilityShape }> = [
  /* --- OpenRouter pool routers ------------------------------------------ */
  {
    // `openrouter/free` and friends are not models; they select one per call
    // from a pool, filtered by the capabilities the request requires. That is
    // genuinely resilient — an individual free model being retired does not
    // take the deployment with it — and it is the right default for evaluation.
    //
    // It is NOT right for a live sermon, and the reason is the one thing a
    // pool cannot give: model identity varies between calls, so terminology
    // and register drift mid-session and the interpreter absorbs it. Pin a
    // model for a service; use the pool to try things out.
    //
    // Claiming json_schema here is safe specifically because
    // `require_parameters: true` makes OpenRouter exclude pool members that
    // cannot honour it.
    match: /^openrouter\/(free|auto)$/i,
    caps: {
      family: "OpenRouter pool",
      structuredOutput: "json_schema",
      sampling: "supported",
      reasoning: "none",
      reasoningAlwaysOn: false,
      maxOutputTokens: 700,
      latencyClass: "standard",
      liveSuitable: false,
      promptCaching: false,
      openWeights: false,
      note: "Selects a different model per call, so terminology and register drift within a session. Good for evaluation, wrong for a live service — pin a model instead.",
    },
  },

  /* --- Reasoning-first models: not for the live path -------------------- */
  {
    // OpenAI o-series and the GPT-5 reasoning tier reject temperature.
    match: /(^|\/)(o[1-9](-|$)|gpt-5(\.\d+)?(-|$))/i,
    caps: {
      family: "OpenAI reasoning",
      structuredOutput: "json_schema",
      sampling: "rejected",
      reasoning: "reasoning_effort",
      reasoningAlwaysOn: true,
      maxOutputTokens: 2000,
      contextTokens: 200_000,
      latencyClass: "slow",
      liveSuitable: false,
      promptCaching: true,
      openWeights: false,
      note: "Reasoning-first: rejects sampling parameters and cannot skip the thinking phase.",
    },
  },
  {
    match: /deepseek-r\d|qwq|thinking|reasoner/i,
    caps: {
      family: "Reasoning",
      structuredOutput: "json_object",
      sampling: "supported",
      reasoning: "reasoning",
      reasoningAlwaysOn: true,
      maxOutputTokens: 2000,
      latencyClass: "slow",
      liveSuitable: false,
      promptCaching: false,
      openWeights: true,
      note: "Reasoning-first: unbounded thinking phase in front of every turn.",
    },
  },

  /* --- Gemini ------------------------------------------------------------ */
  {
    match: /gemini-[\d.]+-flash-lite/i,
    caps: {
      family: "Gemini Flash Lite",
      structuredOutput: "json_schema",
      sampling: "supported",
      reasoning: "reasoning",
      reasoningAlwaysOn: false,
      maxOutputTokens: 900,
      contextTokens: 1_000_000,
      latencyClass: "fast",
      liveSuitable: true,
      promptCaching: true,
      openWeights: false,
    },
  },
  {
    match: /gemini-[\d.]+-flash/i,
    caps: {
      family: "Gemini Flash",
      structuredOutput: "json_schema",
      sampling: "supported",
      reasoning: "reasoning",
      reasoningAlwaysOn: false,
      maxOutputTokens: 1200,
      contextTokens: 1_000_000,
      latencyClass: "fast",
      liveSuitable: true,
      promptCaching: true,
      openWeights: false,
    },
  },
  {
    match: /gemini-[\d.]+-pro/i,
    caps: {
      family: "Gemini Pro",
      structuredOutput: "json_schema",
      sampling: "supported",
      reasoning: "reasoning",
      reasoningAlwaysOn: false,
      maxOutputTokens: 1600,
      contextTokens: 1_000_000,
      latencyClass: "slow",
      liveSuitable: false,
      promptCaching: true,
      openWeights: false,
      note: "Quality tier — too slow to drive the live path, suitable for escalation.",
    },
  },
  {
    match: /gemma/i,
    caps: {
      family: "Gemma",
      structuredOutput: "json_object",
      sampling: "supported",
      reasoning: "none",
      reasoningAlwaysOn: false,
      maxOutputTokens: 800,
      latencyClass: "fast",
      liveSuitable: true,
      promptCaching: false,
      openWeights: true,
    },
  },

  /* --- Anthropic --------------------------------------------------------- */
  {
    match: /claude-.*haiku/i,
    caps: {
      family: "Claude Haiku",
      structuredOutput: "json_object",
      sampling: "supported",
      reasoning: "none",
      reasoningAlwaysOn: false,
      maxOutputTokens: 1000,
      contextTokens: 200_000,
      latencyClass: "fast",
      liveSuitable: true,
      promptCaching: true,
      openWeights: false,
    },
  },
  {
    match: /claude-/i,
    caps: {
      family: "Claude",
      // Claude enforces tool schemas rather than an OpenAI-style
      // `json_schema` response_format. Asking for the latter through a
      // normalising gateway is a coin flip, so we ask for JSON and let Zod be
      // the contract — which it is regardless.
      structuredOutput: "json_object",
      sampling: "supported",
      reasoning: "none",
      reasoningAlwaysOn: false,
      maxOutputTokens: 1600,
      contextTokens: 200_000,
      latencyClass: "standard",
      liveSuitable: true,
      promptCaching: true,
      openWeights: false,
      note: "Quality tier — strong on idiom and wordplay, priced and paced for escalation rather than every turn.",
    },
  },

  /* --- OpenAI chat ------------------------------------------------------- */
  {
    match: /gpt-oss/i,
    caps: {
      family: "GPT-OSS",
      structuredOutput: "json_schema",
      sampling: "supported",
      reasoning: "reasoning_effort",
      reasoningAlwaysOn: false,
      maxOutputTokens: 900,
      contextTokens: 131_072,
      latencyClass: "fast",
      liveSuitable: true,
      promptCaching: false,
      openWeights: true,
    },
  },
  {
    match: /gpt-4[.\d]*-?(mini|nano)/i,
    caps: {
      family: "GPT-4 mini",
      structuredOutput: "json_schema",
      sampling: "supported",
      reasoning: "none",
      reasoningAlwaysOn: false,
      maxOutputTokens: 900,
      contextTokens: 128_000,
      latencyClass: "fast",
      liveSuitable: true,
      promptCaching: true,
      openWeights: false,
    },
  },
  {
    match: /gpt-4/i,
    caps: {
      family: "GPT-4",
      structuredOutput: "json_schema",
      sampling: "supported",
      reasoning: "none",
      reasoningAlwaysOn: false,
      maxOutputTokens: 1200,
      contextTokens: 128_000,
      latencyClass: "standard",
      liveSuitable: true,
      promptCaching: true,
      openWeights: false,
    },
  },

  /* --- Open-weight chat families ----------------------------------------- */
  {
    match: /llama|qwen(?!.*qwq)|mi(s|x)tral|ministral|deepseek|kimi|\bglm-|nemotron|command-?r|exaone|solar-|olmo|aya-|falcon|\bphi-\d/i,
    caps: {
      family: "Open weights",
      structuredOutput: "json_schema",
      sampling: "supported",
      reasoning: "none",
      reasoningAlwaysOn: false,
      maxOutputTokens: 800,
      contextTokens: 131_072,
      latencyClass: "standard",
      liveSuitable: true,
      promptCaching: false,
      openWeights: true,
    },
  },
];

/** In-process memo. Slugs are fixed for the life of a deployment. */
const cache = new Map<string, ModelCapabilities>();

/**
 * Resolve what a model id can actually be asked for.
 *
 * Always returns something usable — an unknown slug is not an error, it is a
 * reason to claim less.
 */
export function capabilitiesForModel(modelId: string): ModelCapabilities {
  const id = modelId.trim();
  const cached = cache.get(id);
  if (cached) return cached;

  // OpenRouter slugs are `vendor/model[:variant]`. The variant suffix
  // (`:free`, `:nitro`, `:floor`) selects routing, not a different model, so
  // it must not defeat family matching.
  const withoutVariant = id.split(":")[0];

  const hit = PATTERNS.find((entry) => entry.match.test(withoutVariant));
  const resolved: ModelCapabilities = hit
    ? { ...hit.caps, id, source: "registry" }
    : { ...CONSERVATIVE, id, source: "inferred" };

  cache.set(id, resolved);
  return resolved;
}

/** Test seam — the table is static, but tests mutate ids freely. */
export const __clearModelCapabilityCache = () => cache.clear();

/**
 * Why a model should not be driving the live path, or null when it is fine.
 *
 * Separated from the boolean so the diagnostics page and the launcher can say
 * *what is wrong* rather than showing a red dot.
 */
export function liveSuitabilityProblem(caps: ModelCapabilities): string | null {
  if (caps.reasoningAlwaysOn) {
    return `${caps.family} reasons before every answer, which adds seconds to a path that has under three.`;
  }
  if (caps.latencyClass === "slow") {
    return `${caps.family} is a quality-tier model; expect it to miss the live deadline.`;
  }
  return caps.liveSuitable ? null : `${caps.family} is not suitable for live interpretation.`;
}
