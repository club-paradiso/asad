/**
 * LLM entry point. Server-side only — API keys never reach the browser.
 */
import "server-only";
import { appEnv } from "@/lib/env";
import { LlmRouter } from "./router";
import { restorePublicFreeOpenRouter } from "./public-free";

export * from "./types";
export * from "./capabilities";
export { LlmRouter } from "./router";
export type { ProviderHealth, RouteResult, RouteAttempt } from "./router";
export { deadlineFor, turnBudgetFor } from "./deadlines";

/**
 * Resolve the process environment once at module startup.
 *
 * `parseEnv` still fails closed for public cloud credentials. The one exception
 * is an explicitly non-billable OpenRouter `:free` deployment; restoring it
 * here keeps the parser conservative while making the server-side LLM entry
 * point authoritative for the provider that translation routes actually use.
 * Because `appEnv()` is cached and returns the same object, diagnostics and
 * sensitive Counter routing see the restored provider too after this module is
 * evaluated.
 */
const runtimeEnv = restorePublicFreeOpenRouter(appEnv());

/**
 * Process-wide router.
 *
 * Held across requests on purpose: circuit-breaker and quota state are only
 * useful if they survive from one live turn to the next. A serverless cold
 * start resets them, which is harmless — the breaker simply relearns.
 */
let router: LlmRouter | null = null;

export function llmRouter(): LlmRouter {
  return (router ??= new LlmRouter(runtimeEnv));
}

/** Test seam. */
export const __resetRouter = () => {
  router = null;
};
