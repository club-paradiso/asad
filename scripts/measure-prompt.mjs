/**
 * npm run measure:prompt
 *
 * Reports both full and ultra-compact live system prompts. The system prompt is
 * a recurring cost on every interpretation call, so the production hot-path
 * size must be directly measurable rather than inferred from source length.
 */
import { systemPromptFor } from "../src/interpreter/prompts/live.ts";
import { estimateTokens } from "../src/lib/telemetry.ts";

console.log("\nLive system prompt size\n");
console.log("  mode      profile          schema-enforced   chars   ~tokens");
for (const mode of ["sermon", "general"]) {
  for (const profile of ["full", "ultra-compact"]) {
    for (const enforced of [false, true]) {
      const prompt = systemPromptFor(mode, {
        schemaEnforced: enforced,
        ultraCompact: profile === "ultra-compact",
      });
      console.log(
        `  ${mode.padEnd(9)} ${profile.padEnd(16)} ${String(enforced).padEnd(17)} ${String(
          prompt.length,
        ).padStart(5)}   ${String(estimateTokens(prompt)).padStart(7)}`,
      );
    }
  }
}
console.log("");
