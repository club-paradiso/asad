import { capabilitiesFor } from "./capabilities";
import { capabilitiesForModel } from "./models";
import type { LlmProviderId } from "./types";

/**
 * Whether the response schema is actually enforced by the wire request.
 *
 * Provider-level structured-output support is not enough for OpenRouter: the
 * gateway can serve models that range from strict `json_schema` support to mere
 * `json_object` mode. Dropping the prompt's field-level contract for the latter
 * turns "valid JSON" into "valid InterpreterOutput" by wishful thinking.
 *
 * For direct providers the provider capability is the contract. For OpenRouter
 * the pinned primary model decides which response_format we can safely send;
 * model-level fallbacks inherit that request shape.
 */
export function enforcesJsonSchema(
  provider: LlmProviderId,
  openRouterPrimaryModel?: string,
): boolean {
  const providerCaps = capabilitiesFor(provider);
  if (!providerCaps.structuredOutput) return false;

  if (provider !== "openrouter") return true;
  if (!openRouterPrimaryModel) return false;

  return capabilitiesForModel(openRouterPrimaryModel).structuredOutput === "json_schema";
}
