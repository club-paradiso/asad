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

  LLM_ROUTING_MODE: z.string().trim().toLowerCase().optional(),
  LLM_PRIVACY_MODE: z.string().trim().toLowerCase().optional(),
  LLM_ALLOW_PAID_FALLBACK: z.string().trim().toLowerCase().optional(),
  LLM_COUNTER_PREFER_OPEN: z.string().trim().toLowerCase().optional(),

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
    /** Explicit provider for `pinned` / `reliable`. */
    pinned?: LlmProviderId;
    providers: Record<LlmProviderId, ProviderConfig>;
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
        return raw.OPENROUTER_LLM_MODEL ?? OPENAI_COMPATIBLE_VENDORS.openrouter.defaultModel;
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
    },
    llm: {
      routingMode,
      privacyMode,
      allowPaidFallback,
      counterPreferOpen,
      pinned,
      providers,
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

/** Cached per-process. Environment does not change under a running server. */
let cached: AppEnv | null = null;
export const appEnv = (): AppEnv => (cached ??= parseEnv());
/** Test seam. */
export const __resetEnvCache = () => {
  cached = null;
};
