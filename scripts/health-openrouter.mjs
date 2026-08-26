/**
 * npm run health:openrouter
 *
 * The deployment smoke test for the gateway. Answers, with evidence rather
 * than configuration-reading, the four questions that look identical from the
 * outside right up until a service starts:
 *
 *   1. Is a key present and still valid?
 *   2. Does the configured model slug actually resolve?
 *   3. Does the routing policy leave any upstream eligible?
 *   4. Does a structured request come back as valid JSON?
 *
 * Exits non-zero when the gateway is configured and unhealthy, so it can gate
 * a deploy. Exits ZERO when nothing is configured — an unconfigured
 * deployment is a choice, not a failure, and this must be safe to run in CI.
 *
 * Never prints the API key.
 */
import { parseEnv } from "../src/lib/env.ts";
import { capabilitiesForModel, liveSuitabilityProblem } from "../src/providers/llm/models.ts";
import { OpenRouterLlmProvider, describePolicy } from "../src/providers/llm/openrouter.ts";
import { toLlmError } from "../src/providers/llm/errors.ts";

const env = parseEnv(process.env);
const config = env.llm.providers.openrouter;
const { policy, primaryModel, qualityModel, qualityEscalation } = env.llm.openrouter;

console.log("\ntong-yuck — OpenRouter gateway health\n");
console.log(`  model      ${primaryModel}`);
console.log(`  routing    sort=${policy.sort} · ${describePolicy(policy)}`);
console.log(`  fallbacks  ${policy.allowFallbacks ? "allowed (same model, other upstream)" : "off"}`);
if (qualityEscalation) console.log(`  escalation ${qualityModel}`);

const caps = capabilitiesForModel(primaryModel);
console.log(
  `  capability ${caps.family} · ${caps.structuredOutput} · sampling ${caps.sampling} · ${caps.source}`,
);
const warning = liveSuitabilityProblem(caps);
if (warning) console.log(`  ⚠ ${warning}`);

if (!config.apiKey) {
  console.log("\n  OPENROUTER_API_KEY is not set — nothing to check.");
  console.log("  This is not a failure. Set the key to run a live check.\n");
  process.exit(0);
}

const provider = new OpenRouterLlmProvider({
  apiKey: config.apiKey,
  model: primaryModel,
  policy,
});

const started = Date.now();
try {
  const response = await provider.complete({
    system: 'Reply with JSON only: {"ok":true,"language":"ko"}',
    user: "Health check.",
    maxOutputTokens: 64,
    temperature: 0,
    jsonSchema: {
      type: "object",
      properties: { ok: { type: "boolean" }, language: { type: "string" } },
      required: ["ok", "language"],
      additionalProperties: false,
    },
    thinking: "none",
  });

  const elapsed = Date.now() - started;
  const start = response.text.indexOf("{");
  const end = response.text.lastIndexOf("}");
  let parsed = null;
  if (start !== -1 && end > start) {
    try {
      parsed = JSON.parse(response.text.slice(start, end + 1));
    } catch {
      parsed = null;
    }
  }

  console.log(`\n  served     ${response.model ?? primaryModel}`);
  if (provider.lastTurn?.upstream) console.log(`  upstream   ${provider.lastTurn.upstream}`);
  console.log(`  latency    ${elapsed}ms`);
  if (response.usage?.totalTokens) console.log(`  tokens     ${response.usage.totalTokens}`);
  if (provider.lastTurn?.costUsd !== undefined) {
    console.log(`  cost       $${provider.lastTurn.costUsd}`);
  }

  if (parsed && typeof parsed.ok === "boolean") {
    console.log("\n  ✓ Gateway healthy: structured output validated.\n");
    process.exit(0);
  }

  // A 200 that is not JSON is the failure mode the live path cannot absorb,
  // and it is invisible to any check that only looks at the status code.
  console.log("\n  ✗ The model answered but did not honour the schema.");
  console.log(`    ${response.text.slice(0, 200).replace(/\n/g, " ")}\n`);
  process.exit(1);
} catch (error) {
  const llmError = toLlmError(error);
  console.log(`\n  ✗ ${llmError.kind}: ${llmError.message}\n`);
  process.exit(1);
}
