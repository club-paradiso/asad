import "server-only";

/**
 * The live path's last cloud route.
 *
 * WHY THIS EXISTS
 *
 * PR #134 added `vercel-gateway.ts` because Counter Mode went dark: the public
 * OpenRouter account is constrained to free models, the unfunded free allowance
 * cannot carry real traffic, and when it ran out there was no second cloud path.
 * The fix worked, and then stopped at Counter's door — `completeViaVercelGateway`
 * had exactly one caller, `src/counter/translate.ts`.
 *
 * Live has the same failure and worse consequences. A counter visitor sees an
 * error and can try again; an interpreter on a stage sees the English stop
 * arriving while the Korean transcript keeps scrolling, and has no idea whether
 * the room noticed. "The LLM sometimes does not run at all" is that, and the
 * single largest contributor is a deployment whose only configured provider has
 * spent its allowance.
 *
 * WHY IT IS NOT JUST THE COUNTER FUNCTION
 *
 * Live is not Counter. It has a hard per-turn deadline rather than a
 * conversational one, it dispatches ~11 times a minute for an hour instead of
 * once when someone taps a button, and a change of model between two sentences
 * costs terminology and register consistency that an interpreter reads
 * instantly. So the gateway is wired in as a `RouteRecovery`:
 *
 *   - it is reached ONLY after every configured provider has failed or been
 *     benched, never as a preference and never sticky;
 *   - it is given whatever is left of the turn, not a deadline of its own;
 *   - the answer is labelled `vercel-gateway`, so the console, the telemetry
 *     and /diagnostics all say a recovery route served that turn rather than
 *     quietly attributing it to a provider that did not answer.
 *
 * PRIVACY
 *
 * Unchanged from #134 and not negotiable: every request asks the gateway to
 * route only through providers with zero data retention and no prompt training,
 * and fails closed if that cannot be satisfied. A recovery path is not
 * permission to weaken the privacy contract, and this one carries the same
 * sermon and meeting speech the primary path does.
 */
import { appEnv } from "@/lib/env";
import { RECOVERY_PROVIDER } from "./recovery-id";
import type { RouteRecovery } from "./router";
import {
  completeViaVercelGateway,
  vercelGatewayAvailable,
  VERCEL_GATEWAY_MODEL,
} from "./vercel-gateway";

/** The label that reaches telemetry, the response body and /diagnostics. */
export const LIVE_RECOVERY_ID = RECOVERY_PROVIDER;

/**
 * The model the live recovery asks the gateway for.
 *
 * Separately overridable from Counter's, because the two have different
 * budgets: Live wants the fastest model that can still hold the output contract,
 * and a deployer tuning one should not be forced to retune the other.
 */
export const liveRecoveryModel = (): string =>
  process.env.VERCEL_AI_GATEWAY_LIVE_MODEL?.trim() || VERCEL_GATEWAY_MODEL;

/**
 * Whether this deployment may use the recovery route at all.
 *
 * On Vercel the gateway is reachable from an ambient `VERCEL_OIDC_TOKEN` that
 * nobody chose to set. That is exactly what makes it a good recovery path on an
 * ordinary deployment — and exactly what makes it the wrong default under
 * `LLM_PRIVACY_MODE=strict`, where the deployer has said which servers may see
 * this speech and an ambient credential is not their decision.
 *
 * So strict mode requires a deliberate act: an explicit `AI_GATEWAY_API_KEY`.
 * The request's zero-data-retention and no-training pins hold either way; what
 * changes is whether reaching a new set of servers happened by configuration or
 * by hosting.
 */
export function liveRecoveryAllowed(requestToken?: string | null): boolean {
  if (!vercelGatewayAvailable(requestToken)) return false;
  if (appEnv().llm.privacyMode !== "strict") return true;
  return !!process.env.AI_GATEWAY_API_KEY?.trim();
}

/**
 * The recovery route for one live turn, or null when this deployment has no
 * gateway credential it is allowed to use.
 *
 * Returning null rather than a route that always fails matters: the router
 * records an attempt for a route it tries, and a deployment that never
 * configured the gateway should not accumulate a failed gateway attempt on
 * every turn of every session.
 */
export function liveGatewayRecovery(requestToken?: string | null): RouteRecovery | null {
  if (!liveRecoveryAllowed(requestToken)) return null;
  return {
    id: LIVE_RECOVERY_ID,
    available: () => liveRecoveryAllowed(requestToken),
    complete: (request, options) =>
      completeViaVercelGateway(request, {
        timeoutMs: options.timeoutMs,
        model: liveRecoveryModel(),
        token: requestToken,
      }),
  };
}
