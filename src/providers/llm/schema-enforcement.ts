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
 * For a direct provider, provider-level schema support is enough. OpenRouter is
 * different because the configured model determines whether the gateway can
 * actually send `response_format: json_schema`. Read the configured model id
 * when it is available; otherwise fail conservative and retain the prose
 * contract. This keeps Live and Rescue in sync without making either route
 * duplicate model-capability logic.
 */
export function promptCapabilitiesFor(
  provider: LlmProviderId,
  openRouterPrimaryModel: string | undefined =
    process.env.OPENROUTER_PRIMARY_MODEL?.trim() ||
    process.env.OPENROUTER_LLM_MODEL?.trim() ||
    undefined,
) {
  const caps = providerCapabilitiesFor(provider);
  if (provider !== "openrouter") return caps;
  return {
    ...caps,
    structuredOutput: enforcesJsonSchema("openrouter", openRouterPrimaryModel),
  };
}
