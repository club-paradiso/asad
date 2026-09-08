import type { AppEnv, EnvProblem } from "@/lib/env";

/**
 * Verified free/open-weight recovery floor for the public Counter deployment.
 *
 * Keep this deliberately short. These are not quality-escalation models and
 * they are never used by paid-capable deployments. OpenRouter tries them only
 * after the configured primary model errors (for example, an upstream 429).
 */
export const PUBLIC_FREE_OPENROUTER_FALLBACK_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
] as const;

function isSafePublicFreeConfiguration(
  env: AppEnv,
  source: NodeJS.ProcessEnv,
  key: string | undefined,
): boolean {
  const model = env.llm.openrouter.primaryModel;
  return (
    source.VERCEL === "1" &&
    !env.access.enabled &&
    !!key &&
    key.length >= 8 &&
    env.llm.pinned === "openrouter" &&
    model.endsWith(":free") &&
    !env.llm.allowPaidFallback &&
    !env.llm.openrouter.qualityEscalation &&
    !env.llm.paidTier.has("openrouter") &&
    env.llm.openrouter.policy.dataCollection === "deny"
  );
}

/**
 * Return the model-level fallback chain for the exact public/free exception.
 *
 * Every candidate remains an explicit `:free` open-weight model. This is
 * intentionally separate from provider-level failover: OpenRouter first tries
 * another upstream for the same model, then may advance through this list if
 * the model itself is unavailable or rate-limited.
 */
export function publicFreeOpenRouterFallbackModels(
  env: AppEnv,
  source: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const key = env.llm.providers.openrouter.apiKey ?? source.OPENROUTER_API_KEY?.trim();
  if (!isSafePublicFreeConfiguration(env, source, key)) return [];

  const primary = env.llm.openrouter.primaryModel;
  return PUBLIC_FREE_OPENROUTER_FALLBACK_MODELS.filter((model) => model !== primary);
}

/**
 * Restore one deliberately narrow public-deployment exception.
 *
 * The general rule remains: a public Vercel deployment must not expose a
 * credential that can spend money. Counter Mode currently pins OpenRouter to
 * an explicit `:free` model, with paid fallback and quality escalation off.
 * That configuration cannot incur model charges, so disabling the key makes
 * the product unusable without buying us the protection the gate was designed
 * to provide.
 *
 * This helper therefore admits only that exact shape. Any paid-capable model,
 * escalation path, collection-allowing policy, non-OpenRouter pin, or private
 * deployment falls back to the normal fail-closed environment policy.
 */
export function restorePublicFreeOpenRouter(
  env: AppEnv,
  source: NodeJS.ProcessEnv = process.env,
): AppEnv {
  const key = source.OPENROUTER_API_KEY?.trim();
  const model = env.llm.openrouter.primaryModel;
  const safePublicFreeConfiguration = isSafePublicFreeConfiguration(env, source, key);

  if (!safePublicFreeConfiguration || env.llm.providers.openrouter.configured) {
    return env;
  }

  env.llm.providers.openrouter = {
    ...env.llm.providers.openrouter,
    apiKey: key,
    model,
    configured: true,
  };

  // The original parser quite correctly complained that cloud credentials were
  // disabled. Keep that fact visible, but downgrade it now that exactly one
  // non-billable provider is intentionally restored. Other cloud credentials
  // remain disabled on a public deployment.
  env.problems = env.problems
    .filter(
      (problem) =>
        !(
          problem.field === "LLM_PROVIDER" &&
          problem.message.includes('Pinned to "openrouter" but no API key')
        ),
    )
    .map((problem): EnvProblem => {
      if (problem.field !== "APP_ACCESS_KEY") return problem;
      return {
        level: "warning",
        field: "APP_ACCESS_KEY",
        message:
          "Public deployment: only explicit :free OpenRouter models are enabled without an app access gate; paid-capable cloud credentials remain disabled.",
      };
    });

  return env;
}
