/**
 * npm run measure:prompt
 *
 * Reports the size of every live system prompt. The system prompt is the
 * largest recurring line in this workload — it is sent on every one of ~11
 * calls a minute and never changes within a session — so its size is a
 * number worth being able to check rather than estimate.
 */
import { systemPromptFor } from "../src/interpreter/prompts/live.ts";
import { estimateTokens } from "../src/lib/telemetry.ts";

console.log("\nLive system prompt size\n");
console.log("  mode      schema-enforced   chars   ~tokens");
for (const mode of ["sermon", "general"]) {
  for (const enforced of [false, true]) {
    const prompt = systemPromptFor(mode, { schemaEnforced: enforced });
    console.log(
      `  ${mode.padEnd(9)} ${String(enforced).padEnd(17)} ${String(prompt.length).padStart(5)}   ${String(
        estimateTokens(prompt),
      ).padStart(7)}`,
    );
  }
}
console.log("");
