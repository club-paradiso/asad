/**
 * LLM entry point. Server-side only — API keys never reach the browser.
 */
import "server-only";
import { appEnv } from "@/lib/env";
import { LlmRouter } from "./router";
import { restorePublicFreeOpenRouter } from "./public-free";

export * from "./types";
export * from "./capabilities";
export { enforcesJsonSchema } from "./schema-enforcement";
export { LlmRouter } from "./router";
export type { ProviderHealth, RouteResult, RouteAttempt } from "./router";
export { deadlineFor, turnBudgetFor } from "./deadlines";

/**
 * Process-wide router.
 *
 * Held across requests on purpose: circuit-breaker and quota state are only
 * useful if they survive from one live turn to the next. A serverless cold
 * start resets them, which is harmless — the breaker simply relearns.
 *
 * Resolve the environment when the router is created, not when this module is
 * imported. Tests and diagnostics deliberately reset the environment cache;
 * capturing it at module load makes every later router reuse stale provider
 * state. `restorePublicFreeOpenRouter` mutates the cached environment only for
 * the narrow public `:free` OpenRouter exception, so every route reading
 * `appEnv()` after this call sees the same effective configuration.
 */
let router: LlmRouter | null = null;

export function llmRouter(): LlmRouter {
  return (router ??= new LlmRouter(restorePublicFreeOpenRouter(appEnv())));
}

/** Test seam. */
export const __resetRouter = () => {
  router = null;
};
