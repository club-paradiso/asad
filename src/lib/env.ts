/**
 * Centralised environment parsing.
 *
 * Two rules drive the design:
 *
 *  1. **A misconfigured optional provider must never take the site down.**
 *     Someone typing `GROQ_LLM_MODEL` with a stray space should get a warning
 *     on the diagnostics page, not a 500 in the middle of a service. So this
 *     never throws — it returns a config plus a list of problems.
 *
 *  2. **Backwards compatibility with Phase 1.** Deployments configured with
 *     `LLM_PROVIDER` / `LLM_API_KEY` keep working, and the migration path is
 *     reported as an informational notice rather than a breaking change.
 */
import { z } from "zod";
import {
  LLM_PROVIDER_IDS,
  normaliseProviderId,
  type LlmProviderId,
} from "@/providers/llm/types";
import { NATIVE_DEFAULT_MODELS, OPENAI_COMPATIBLE_VENDORS } from "@/providers/llm/vendors";
import {
  DEFAULT_ROUTING_POLICY,
  OPENROUTER_DEFAULT_PRIMARY_MODEL,
  type DataCollectionPolicy,
  type OpenRouterRoutingPolicy,
  type ProviderSort,
} from "@/providers/llm/openrouter";
import { capabilitiesForModel, liveSuitabilityProblem } from "@/providers/llm/models";

/**
 * Default quality-escalation model.
 *
 * Never used unless `OPENROUTER_QUALITY_ESCALATION` is explicitly on, because
 * escalation costs latency and money and neither should start by surprise.
 */
const DEFAULT_QUALITY_MODEL = "anthropic/claude-sonnet-5";

const PROVIDER_SORTS = ["latency", "throughput", "price"] as const;

/* -------------------------------------------------------------------------- */
/* Routing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How the router picks a provider.
 *
 * - `local`     — never call a cloud model at all.
 * - `auto-free` — prefer verified free tiers, degrade to local. NEVER escalates
 *                 to a paid provider unless the deployer explicitly opted in.
 * - `pinned`    — always the configured provider; fall back only to local.
 * - `reliable`  — prefer the configured paid provider.
 */
export const ROUTING_MODES = ["local", "auto-free", "pinned", "reliable"] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];

/** Whether a provider is allowed to be one that may train on submitted content. */
export const PRIVACY_MODES = ["standard", "strict"] as const;
export type PrivacyMode = (typeof PRIVACY_MODES)[number];

/* -------------------------------------------------------------------------- */
/* Schema                                                                      */
/* -------------------------------------------------------------------------- */

/** A model id we are willing to put in a URL or a JSON body. */
const modelId = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._\-/:]+$/, "model ids may only contain letters, digits and . _ - / :");

const optionalKey = z
  .string()
  .trim()
  .min(8, "looks too short to be an API key")
  .optional()
  .or(z.literal("").transform(() => undefined));

const rawEnvSchema = z.object({
  STT_PROVIDER: z.string().trim().toLowerCase().optional(),
  DEEPGRAM_API_KEY: optionalKey,
  DEEPGRAM_PROJECT_ID: z.string().trim().optional(),
  DEEPGRAM_STT_MODEL: z.string().trim().optional(),
  OPENAI_STT_MODEL: z.string().trim().optional(),
  // Server-only optional Counter fallback. Do not use HUGGINGFACE_API_TOKEN:
  // one name prevents silent deployment drift and accidental client exposure.
  HF_TOKEN: optionalKey,
  HF_STT_MODEL: modelId.optional(),

  LLM_ROUTING_MODE: z.string().trim().toLowerCase().optional(),
  LLM_PRIVACY_MODE: z.string().trim().toLowerCase().optional(),
  LLM_ALLOW_PAID_FALLBACK: z.string().trim().toLowerCase().optional(),
  LLM_COUNTER_PREFER_OPEN: z.string().trim().toLowerCase().optional(),
  LLM_PAID_TIER: z.string().trim().toLowerCase().optional(),

  // Phase 1 compatibility.
  LLM_PROVIDER: z.string().trim().toLowerCase().optional(),
  LLM_API_KEY: optionalKey,

  GEMINI_API_KEY: optionalKey,
  GROQ_API_KEY: optionalKey,
  OPENROUTER_API_KEY: optionalKey,
  OPENAI_API_KEY: optionalKey,
  ANTHROPIC_API_KEY: optionalKey,

  GEMINI_LLM_MODEL: modelId.optional(),
  GROQ_LLM_MODEL: modelId.optional(),
  OPENROUTER_LLM_MODEL: modelId.optional(),
  OPENAI_LLM_MODEL: modelId.optional(),
  ANTHROPIC_LLM_MODEL: modelId.optional(),

  // OpenRouter as the production gateway. `OPENROUTER_PRIMARY_MODEL` is the
  // name the deployment documentation uses; `OPENROUTER_LLM_MODEL` is the
  // Phase 2 spelling and still wins nothing — whichever is set is used, with
  // the newer name taking precedence when both are.
  OPENROUTER_PRIMARY_MODEL: modelId.optional(),
  OPENROUTER_QUALITY_MODEL: modelId.optional(),
  OPENROUTER_QUALITY_ESCALATION: z.string().trim().toLowerCase().optional(),
  OPENROUTER_PROVIDER_SORT: z.string().trim().toLowerCase().optional(),
  OPENROUTER_DATA_COLLECTION: z.string().trim().toLowerCase().optional(),
  OPENROUTER_ZDR: z.string().trim().toLowerCase().optional(),
  OPENROUTER_ALLOW_PROVIDER_FALLBACKS: z.string().trim().toLowerCase().optional(),
  OPENROUTER_REQUIRE_PARAMETERS: z.string().trim().toLowerCase().optional(),
  OPENROUTER_PROVIDER_ONLY: z.string().trim().optional(),
  OPENROUTER_PROVIDER_IGNORE: z.string().trim().optional(),

  // Optional gate for a private deployment. Absent means no gate.
  APP_ACCESS_KEY: z.string().trim().min(8, "too short to be a useful access key").optional(),
  // Signing key for session tokens. Only matters on a multi-instance
  // deployment; see `sessionEnforcement` in src/lib/guard.ts.
  SESSION_SECRET: z.string().trim().min(16, "too short to sign session tokens").optional(),

  BIBLE_PROVIDER: z.string().trim().toLowerCase().optional(),
  BIBLE_API_KEY: optionalKey,
  BIBLE_ID: z.string().trim().optional(),
  BIBLE_TRANSLATION: z.string().trim().optional(),
});

/* -------------------------------------------------------------------------- */
/* Parsed shape                                                                */
/* -------------------------------------------------------------------------- */

export interface ProviderConfig {
  id: LlmProviderId;
  /** Present only when a usable key was supplied. */
  apiKey?: string;
  model: string;
  configured: boolean;
}

export interface EnvProblem {
  level: "error" | "warning" | "info";
  field: string;
  message: string;
}

export interface AppEnv {
  stt: {
    provider: "demo" | "webspeech" | "deepgram" | "openai";
    deepgramKey?: string;
    deepgramProjectId?: string;
    deepgramModel: string;
    openaiKey?: string;
    openaiModel: string;
    hfToken?: string;
    hfModel: string;
  };
  llm: {
    routingMode: RoutingMode;
    privacyMode: PrivacyMode;
    /** AUTO-FREE never spends money unless this is explicitly true. */
    allowPaidFallback: boolean;
    /**
     * Counter Mode routes to open-weight models first. On by default: it is
     * the stated requirement for the counter, and the providers serving open
     * weights also happen to have the better data-use posture on a free tier.
     */
    counterPreferOpen: boolean;
    /**
     * Providers the deployer declares are on a billed plan.
     *
     * This cannot be detected — an API key looks identical either way — so it
     * is a declaration, and it is trusted. Two things change for a provider
     * listed here:
     *
     *   1. Its free-tier quota stops being used as a local ceiling. Otherwise
     *      a paid key is throttled against limits it does not have, and the
     *      router benches it as "quota nearly exhausted" while the account has
     *      plenty left.
     *   2. Its PAID data-use posture applies. Gemini does not train on paid
     *      API data, so `LLM_PRIVACY_MODE=strict` should admit it — which it
     *      cannot do while every provider is judged by its free tier.
     *
     * Declaring a provider paid when it is not sends content to a
     * training-capable tier while the interface says otherwise, so the default
     * is empty and the value is echoed on /diagnostics.
     */
    paidTier: ReadonlySet<LlmProviderId>;
    /** Explicit provider for `pinned` / `reliable`. */
    pinned?: LlmProviderId;
    providers: Record<LlmProviderId, ProviderConfig>;
    /**
     * OpenRouter-specific configuration.
     *
     * Present whether or not OpenRouter is the active provider — the
     * diagnostics page reports the policy a deployer configured even when
     * something else is currently serving turns.
     */
    openrouter: {
      /** Pinned for the session. Model roulette costs terminology consistency. */
      primaryModel: string;
      /** Reached only on explicit escalation, never by default. */
      qualityModel: string;
      /** Whether escalation is permitted at all. */
      qualityEscalation: boolean;
      policy: OpenRouterRoutingPolicy;
    };
  };
  /**
   * Optional shared-secret gate for a private deployment.
   *
   * Not an identity system. It exists so that a deployment carrying a billed
   * OpenRouter key is not a public endpoint anyone can drain.
   */
  access: {
    key?: string;
    enabled: boolean;
    /**
     * A secret that is identical on every instance of this deployment.
     *
     * Session tokens are signed with it. Without one they are signed with a
     * per-process random key, which works on a single server and fails on
     * anything that scales out — see `sessionEnforcement`.
     */
    sessionSecret?: string;
  };
  bible: {
    provider: "reference-only" | "public-domain" | "api-bible";
    apiKey?: string;
    bibleId?: string;
    translation: string;
  };
  problems: EnvProblem[];
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

const BOOLEAN_TRUE = new Set(["1", "true", "yes", "on"]);
const BOOLEAN_FALSE = new Set(["0", "false", "no", "off"]);

/**
 * Parse process.env into a validated config. Never throws.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const problems: EnvProblem[] = [];
  const parsed = rawEnvSchema.safeParse(source);

  // A field that fails validation is dropped and reported, rather than taking
  // the whole configuration down with it.
  const raw: z.infer<typeof rawEnvSchema> = parsed.success ? parsed.data : {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push({
        level: "error",
        field: String(issue.path[0] ?? "env"),
        message: issue.message,
      });
    }
    // Re-parse leniently so the valid fields still take effect.
    const lenient = rawEnvSchema.partial().safeParse(
      Object.fromEntries(
        Object.entries(source).filter(
          ([key]) => !parsed.error.issues.some((issue) => issue.path[0] === key),
        ),
      ),
    );
    if (lenient.success) Object.assign(raw, lenient.data);
  }

  /* --- STT -------------------------------------------------------------- */
  const sttRequested = raw.STT_PROVIDER ?? "demo";
  const sttValid = ["demo", "webspeech", "deepgram", "openai"] as const;
  let sttProvider: AppEnv["stt"]["provider"] = "demo";
  if ((sttValid as readonly string[]).includes(sttRequested)) {
    sttProvider = sttRequested as AppEnv["stt"]["provider"];
  } else if (raw.STT_PROVIDER) {
    problems.push({
      level: "error",
      field: "STT_PROVIDER",
      message: `Unknown value "${sttRequested}". Falling back to demo. Valid: ${sttValid.join(", ")}.`,
    });
  }

  if (sttProvider === "deepgram" && !raw.DEEPGRAM_API_KEY) {
    problems.push({
      level: "error",
      field: "DEEPGRAM_API_KEY",
      message: "STT_PROVIDER is deepgram but no key is set — the console will run in demo mode.",
    });
  }
  if (sttProvider === "deepgram" && raw.DEEPGRAM_API_KEY && !raw.DEEPGRAM_PROJECT_ID) {
    problems.push({
      level: "warning",
      field: "DEEPGRAM_PROJECT_ID",
      message:
        "Not set, so short-lived browser keys cannot be minted and the configured key is passed to the browser instead. See docs/privacy.md.",
    });
  }
  if (sttProvider === "openai" && !raw.OPENAI_API_KEY) {
    problems.push({
      level: "error",
      field: "OPENAI_API_KEY",
      message: "STT_PROVIDER is openai but no key is set — the console will run in demo mode.",
    });
  }
  /* --- LLM routing ------------------------------------------------------ */
  let routingMode: RoutingMode = "auto-free";
  if (raw.LLM_ROUTING_MODE) {
    if ((ROUTING_MODES as readonly string[]).includes(raw.LLM_ROUTING_MODE)) {
      routingMode = raw.LLM_ROUTING_MODE as RoutingMode;
    } else {
      problems.push({
        level: "error",
        field: "LLM_ROUTING_MODE",
        message: `Unknown mode "${raw.LLM_ROUTING_MODE}". Using auto-free. Valid: ${ROUTING_MODES.join(", ")}.`,
      });
    }
  }

  let privacyMode: PrivacyMode = "standard";
  if (raw.LLM_PRIVACY_MODE) {
    if ((PRIVACY_MODES as readonly string[]).includes(raw.LLM_PRIVACY_MODE)) {
      privacyMode = raw.LLM_PRIVACY_MODE as PrivacyMode;
    } else {
      problems.push({
        level: "error",
        field: "LLM_PRIVACY_MODE",
        message: `Unknown mode "${raw.LLM_PRIVACY_MODE}". Using standard. Valid: ${PRIVACY_MODES.join(", ")}.`,
      });
    }
  }

  const allowPaidFallback = BOOLEAN_TRUE.has(raw.LLM_ALLOW_PAID_FALLBACK ?? "");
  // Defaults ON, unlike the other flags: the counter is the one surface where
  // open weights were asked for by name.
  const counterPreferOpen = !BOOLEAN_FALSE.has(raw.LLM_COUNTER_PREFER_OPEN ?? "");

  const paidTier = new Set<LlmProviderId>();
  for (const entry of (raw.LLM_PAID_TIER ?? "").split(",")) {
    const name = entry.trim();
    if (!name) continue;
    const id = normaliseProviderId(name);
    if (!id || id === "local") {
      problems.push({
        level: "error",
        field: "LLM_PAID_TIER",
        message: `Unknown provider "${name}". Valid: ${LLM_PROVIDER_IDS.filter((p) => p !== "local").join(", ")}.`,
      });
      continue;
    }
    paidTier.add(id);
  }

  /* --- Per-provider keys, with Phase 1 migration ------------------------ */
  let pinned: LlmProviderId | undefined;
  if (raw.LLM_PROVIDER) {
    const legacy = normaliseProviderId(raw.LLM_PROVIDER);
    if (!legacy) {
      problems.push({
        level: "error",
        field: "LLM_PROVIDER",
        message: `Unknown provider "${raw.LLM_PROVIDER}". Valid: ${LLM_PROVIDER_IDS.join(", ")}.`,
      });
    } else {
      pinned = legacy;
      // Phase 1 semantics: LLM_PROVIDER meant "always use this one".
      if (!raw.LLM_ROUTING_MODE) {
        routingMode = legacy === "local" ? "local" : "pinned";
        problems.push({
          level: "info",
          field: "LLM_PROVIDER",
          message: `Phase 1 configuration detected — routing mode set to "${routingMode}". Set LLM_ROUTING_MODE explicitly to use free-tier routing.`,
        });
      }
    }
  }

  const keyFor = (id: LlmProviderId): string | undefined => {
    const explicit = {
      local: undefined,
      gemini: raw.GEMINI_API_KEY,
      groq: raw.GROQ_API_KEY,
      openrouter: raw.OPENROUTER_API_KEY,
      openai: raw.OPENAI_API_KEY,
      anthropic: raw.ANTHROPIC_API_KEY,
    }[id];
    if (explicit) return explicit;
    // Phase 1 fallback: LLM_API_KEY belonged to whatever LLM_PROVIDER named.
    if (pinned === id && raw.LLM_API_KEY) return raw.LLM_API_KEY;
    return undefined;
  };

  const modelFor = (id: LlmProviderId): string => {
    switch (id) {
      case "gemini":
        return raw.GEMINI_LLM_MODEL ?? NATIVE_DEFAULT_MODELS.gemini;
      case "anthropic":
        return raw.ANTHROPIC_LLM_MODEL ?? NATIVE_DEFAULT_MODELS.anthropic;
      case "groq":
        return raw.GROQ_LLM_MODEL ?? OPENAI_COMPATIBLE_VENDORS.groq.defaultModel;
      case "openrouter":
        return (
          raw.OPENROUTER_PRIMARY_MODEL ??
          raw.OPENROUTER_LLM_MODEL ??
          OPENROUTER_DEFAULT_PRIMARY_MODEL
        );
      case "openai":
        return raw.OPENAI_LLM_MODEL ?? OPENAI_COMPATIBLE_VENDORS.openai.defaultModel;
      case "local":
        return "deterministic";
    }
  };

  const providers = Object.fromEntries(
    LLM_PROVIDER_IDS.map((id) => {
      const apiKey = keyFor(id);
      return [
        id,
        {
          id,
          apiKey,
          model: modelFor(id),
          configured: id === "local" || !!apiKey,
        } satisfies ProviderConfig,
      ];
    }),
  ) as Record<LlmProviderId, ProviderConfig>;

  if (raw.LLM_API_KEY && !pinned) {
    problems.push({
      level: "warning",
      field: "LLM_API_KEY",
      message:
        "Set without LLM_PROVIDER, so it cannot be assigned to a provider. Use GEMINI_API_KEY / GROQ_API_KEY / etc.",
    });
  }

  if (pinned && pinned !== "local" && !providers[pinned].configured) {
    problems.push({
      level: "error",
      field: "LLM_PROVIDER",
      message: `Pinned to "${pinned}" but no API key is configured for it — the local interpreter will be used.`,
    });
  }

  if (routingMode === "auto-free") {
    const free = (["gemini", "groq", "openrouter"] as const).filter(
      (id) => providers[id].configured,
    );
    if (free.length === 0) {
      problems.push({
        level: "warning",
        field: "LLM_ROUTING_MODE",
        message:
          "auto-free is selected but no free-tier key is configured. Set GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY, or English assistance will be rule-based only.",
      });
    }
  }

  /* --- OpenRouter gateway ----------------------------------------------- */
  const openrouterPolicy = parseRoutingPolicy(raw, privacyMode, problems);

  const primaryModel =
    raw.OPENROUTER_PRIMARY_MODEL ??
    raw.OPENROUTER_LLM_MODEL ??
    OPENROUTER_DEFAULT_PRIMARY_MODEL;
  const qualityModel = raw.OPENROUTER_QUALITY_MODEL ?? DEFAULT_QUALITY_MODEL;
  const qualityEscalation = BOOLEAN_TRUE.has(raw.OPENROUTER_QUALITY_ESCALATION ?? "");

  if (qualityEscalation && !providers.openrouter.configured) {
    problems.push({
      level: "warning",
      field: "OPENROUTER_QUALITY_ESCALATION",
      message: "Quality escalation is on but no OPENROUTER_API_KEY is set, so it can never fire.",
    });
  }

  // A model that reasons before answering cannot serve a live turn, and
  // discovering that from timeouts during a service is the wrong way to learn
  // it. Say so at configuration time.
  const primaryCaps = capabilitiesForModel(primaryModel);
  const primaryProblem = liveSuitabilityProblem(primaryCaps);
  if (providers.openrouter.configured && primaryProblem) {
    problems.push({
      level: "warning",
      field: "OPENROUTER_PRIMARY_MODEL",
      message: `${primaryModel} is a poor fit for the live path: ${primaryProblem}`,
    });
  }

  /* --- Bible ------------------------------------------------------------ */
  const bibleRequested = raw.BIBLE_PROVIDER ?? "reference-only";
  const bibleValid = ["reference-only", "public-domain", "api-bible"] as const;
  let bibleProvider: AppEnv["bible"]["provider"] = "reference-only";
  if ((bibleValid as readonly string[]).includes(bibleRequested)) {
    bibleProvider = bibleRequested as AppEnv["bible"]["provider"];
  } else if (raw.BIBLE_PROVIDER) {
    problems.push({
      level: "error",
      field: "BIBLE_PROVIDER",
      message: `Unknown value "${bibleRequested}". Using reference-only. Valid: ${bibleValid.join(", ")}.`,
    });
  }
  if (bibleProvider === "api-bible" && (!raw.BIBLE_API_KEY || !raw.BIBLE_ID)) {
    problems.push({
      level: "error",
      field: "BIBLE_ID",
      message: "api-bible needs both BIBLE_API_KEY and BIBLE_ID — showing references only.",
    });
    bibleProvider = "reference-only";
  }

  return {
    stt: {
      provider: sttProvider,
      deepgramKey: raw.DEEPGRAM_API_KEY,
      deepgramProjectId: raw.DEEPGRAM_PROJECT_ID,
      deepgramModel: raw.DEEPGRAM_STT_MODEL ?? "nova-3",
      openaiKey: raw.OPENAI_API_KEY,
      openaiModel: raw.OPENAI_STT_MODEL ?? "gpt-live-transcribe",
      hfToken: raw.HF_TOKEN,
      hfModel: raw.HF_STT_MODEL ?? "openai/whisper-large-v3-turbo",
    },
    llm: {
      routingMode,
      privacyMode,
      allowPaidFallback,
      counterPreferOpen,
      paidTier,
      pinned,
      providers,
      openrouter: {
        primaryModel,
        qualityModel,
        qualityEscalation,
        policy: openrouterPolicy,
      },
    },
    access: {
      key: raw.APP_ACCESS_KEY,
      enabled: !!raw.APP_ACCESS_KEY,
      // APP_ACCESS_KEY doubles as the signing key when it is set, so a gated
      // deployment needs nothing further.
      sessionSecret: raw.SESSION_SECRET ?? raw.APP_ACCESS_KEY,
    },
    bible: {
      provider: bibleProvider,
      apiKey: raw.BIBLE_API_KEY,
      bibleId: raw.BIBLE_ID,
      translation: raw.BIBLE_TRANSLATION ?? "WEB",
    },
    problems,
  };
}

/**
 * Parse the OpenRouter provider-routing policy.
 *
 * The one rule that matters: `LLM_PRIVACY_MODE=strict` is a floor, not a
 * suggestion. It forces `data_collection: deny`, and a deployment that tried
 * to set `allow` alongside it is told that the stricter value won rather than
 * being quietly given the looser one. Nothing here can relax a constraint the
 * deployer asked for.
 */
function parseRoutingPolicy(
  raw: z.infer<typeof rawEnvSchema>,
  privacyMode: PrivacyMode,
  problems: EnvProblem[],
): OpenRouterRoutingPolicy {
  let sort: ProviderSort = DEFAULT_ROUTING_POLICY.sort;
  if (raw.OPENROUTER_PROVIDER_SORT) {
    if ((PROVIDER_SORTS as readonly string[]).includes(raw.OPENROUTER_PROVIDER_SORT)) {
      sort = raw.OPENROUTER_PROVIDER_SORT as ProviderSort;
    } else {
      problems.push({
        level: "error",
        field: "OPENROUTER_PROVIDER_SORT",
        message: `Unknown value "${raw.OPENROUTER_PROVIDER_SORT}". Using ${sort}. Valid: ${PROVIDER_SORTS.join(", ")}.`,
      });
    }
  }

  let dataCollection: DataCollectionPolicy = DEFAULT_ROUTING_POLICY.dataCollection;
  if (raw.OPENROUTER_DATA_COLLECTION) {
    if (raw.OPENROUTER_DATA_COLLECTION === "deny" || raw.OPENROUTER_DATA_COLLECTION === "allow") {
      dataCollection = raw.OPENROUTER_DATA_COLLECTION;
    } else {
      problems.push({
        level: "error",
        field: "OPENROUTER_DATA_COLLECTION",
        message: `Unknown value "${raw.OPENROUTER_DATA_COLLECTION}". Using deny. Valid: deny, allow.`,
      });
    }
  }

  // Strict privacy outranks a looser explicit setting, and says so.
  if (privacyMode === "strict" && dataCollection !== "deny") {
    problems.push({
      level: "warning",
      field: "OPENROUTER_DATA_COLLECTION",
      message:
        "LLM_PRIVACY_MODE=strict overrides OPENROUTER_DATA_COLLECTION=allow — routing will deny data collection.",
    });
    dataCollection = "deny";
  }

  const list = (value: string | undefined): string[] | undefined => {
    const items = (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return items.length ? items : undefined;
  };

  return {
    sort,
    dataCollection,
    zdr: BOOLEAN_TRUE.has(raw.OPENROUTER_ZDR ?? ""),
    allowFallbacks: !BOOLEAN_FALSE.has(raw.OPENROUTER_ALLOW_PROVIDER_FALLBACKS ?? ""),
    requireParameters: !BOOLEAN_FALSE.has(raw.OPENROUTER_REQUIRE_PARAMETERS ?? ""),
    only: list(raw.OPENROUTER_PROVIDER_ONLY),
    ignore: list(raw.OPENROUTER_PROVIDER_IGNORE),
  };
}

/** Cached per-process. Environment does not change under a running server. */
let cached: AppEnv | null = null;
export const appEnv = (): AppEnv => (cached ??= parseEnv());
/** Test seam. */
export const __resetEnvCache = () => {
  cached = null;
};
