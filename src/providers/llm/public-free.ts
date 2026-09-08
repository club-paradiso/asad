import type { AppEnv, EnvProblem } from "@/lib/env";

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

  const safePublicFreeConfiguration =
    source.VERCEL === "1" &&
    !env.access.enabled &&
    !!key &&
    key.length >= 8 &&
    env.llm.pinned === "openrouter" &&
    model.endsWith(":free") &&
    !env.llm.allowPaidFallback &&
    !env.llm.openrouter.qualityEscalation &&
    !env.llm.paidTier.has("openrouter") &&
    env.llm.openrouter.policy.dataCollection === "deny";

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
          "Public deployment: the explicitly :free OpenRouter model is enabled without an app access gate; all paid-capable cloud credentials remain disabled.",
      };
    });

  return env;
}
