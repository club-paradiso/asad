/**
 * LLM entry point. Server-side only — API keys never reach the browser.
 */
import "server-only";
import { appEnv } from "@/lib/env";
import { LlmRouter } from "./router";

export * from "./types";
export * from "./capabilities";
export { LlmRouter } from "./router";
export type { ProviderHealth, RouteResult, RouteAttempt } from "./router";
export { deadlineFor, turnBudgetFor } from "./deadlines";

/**
 * Process-wide router.
 *
 * Held across requests on purpose: circuit-breaker and quota state are only
 * useful if they survive from one live turn to the next. A serverless cold
 * start resets them, which is harmless — the breaker simply relearns.
 */
let router: LlmRouter | null = null;

export function llmRouter(): LlmRouter {
  return (router ??= new LlmRouter(appEnv()));
}

/** Test seam. */
export const __resetRouter = () => {
  router = null;
};
