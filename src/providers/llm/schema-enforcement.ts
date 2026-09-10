import { capabilitiesFor as providerCapabilitiesFor } from "./capabilities";
import { capabilitiesForModel } from "./models";
import type { LlmProviderId } from "./types";

/**
 * Whether the response schema is actually enforced by the wire request.
 *
 * Provider-level structured-output support is not enough for OpenRouter: the
 * gateway can serve models that range from strict `json_schema` support to mere
 * `json_object` mode. Dropping the prompt's field-level contract for the latter
 * turns "valid JSON" into "valid InterpreterOutput" by wishful thinking.
 */
export function enforcesJsonSchema(
  provider: LlmProviderId,
  openRouterPrimaryModel?: string,
): boolean {
  const providerCaps = providerCapabilitiesFor(provider);
  if (!providerCaps.structuredOutput) return false;

  if (provider !== "openrouter") return true;
  if (!openRouterPrimaryModel) return false;

  return capabilitiesForModel(openRouterPrimaryModel).structuredOutput === "json_schema";
}

/**
 * Capabilities as consumed by the live prompt builder.
 *
 * Existing live routes ask only for provider-level capabilities and therefore
 * do not have the pinned OpenRouter model at hand. Be conservative there:
 * OpenRouter can request structured output, but the configured model may only
 * support `json_object`, so the prompt must retain its field-level JSON
 * contract. Native model-specific response_format construction still happens
 * independently inside the OpenRouter adapter.
 */
export function promptCapabilitiesFor(provider: LlmProviderId) {
  const caps = providerCapabilitiesFor(provider);
  return provider === "openrouter" ? { ...caps, structuredOutput: false } : caps;
}
