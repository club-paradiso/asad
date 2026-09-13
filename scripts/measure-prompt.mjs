/**
 * npm run measure:prompt
 *
 * Reports both full and ultra-compact live system prompts. The system prompt is
 * a recurring cost on every interpretation call, so the production hot-path
 * size must be directly measurable rather than inferred from source length.
 */
import { systemPromptFor } from "../src/interpreter/prompts/live.ts";
import { CORE_CONTRACT } from "../src/interpreter/prompts/shared.ts";
import { RESOLVED_CONTEXTS } from "../src/interpreter/context/context-mode.ts";
import { estimateTokens } from "../src/lib/telemetry.ts";

console.log("\nLive system prompt size, by resolved context\n");
console.log("  context       profile          schema-enforced   chars   ~tokens");
for (const context of RESOLVED_CONTEXTS) {
  for (const profile of ["full", "ultra-compact"]) {
    for (const enforced of [false, true]) {
      const prompt = systemPromptFor(context, {
        schemaEnforced: enforced,
        ultraCompact: profile === "ultra-compact",
      });
      console.log(
        `  ${context.padEnd(13)} ${profile.padEnd(16)} ${String(enforced).padEnd(17)} ${String(
          prompt.length,
        ).padStart(5)}   ${String(estimateTokens(prompt)).padStart(7)}`,
      );
    }
  }
}

// The shared prefix is what a provider's prompt cache can hit, and it is the
// reason the six contexts cost roughly the same as the two modes did.
const shared = estimateTokens(CORE_CONTRACT);
const full = estimateTokens(systemPromptFor("worship", { schemaEnforced: true }));
console.log(
  `\n  shared cacheable core: ${shared} tokens (${Math.round((shared / full) * 100)}% of the worship prompt)`,
);

console.log("\nA non-default language pair\n");
console.log("  pair            context       chars   ~tokens");
for (const [source, target] of [
  ["ko-KR", "en-US"],
  ["ko-KR", "zh-TW"],
  ["ja-JP", "en-US"],
  ["es-ES", "ko-KR"],
]) {
  for (const context of ["worship", "generic"]) {
    const prompt = systemPromptFor(context, {
      schemaEnforced: true,
      languages: { source, target },
    });
    console.log(
      `  ${`${source}→${target}`.padEnd(15)} ${context.padEnd(13)} ${String(prompt.length).padStart(5)}   ${String(
        estimateTokens(prompt),
      ).padStart(7)}`,
    );
  }
}
console.log("");
