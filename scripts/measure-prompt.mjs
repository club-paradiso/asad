/**
 * npm run measure:prompt
 *
 * Reports both full and ultra-compact live system prompts. The system prompt is
 * a recurring cost on every interpretation call, so the production hot-path
 * size must be directly measurable rather than inferred from source length.
 */
import { buildLiveUserPrompt, systemPromptFor } from "../src/interpreter/prompts/live.ts";
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

/**
 * What a code-switched turn costs on top of a monolingual one.
 *
 * The steer that tells the model to carry English spans through unchanged is
 * emitted only when there ARE English spans, so an ordinary Korean sermon pays
 * nothing for it. That claim is worth measuring rather than asserting: the live
 * path dispatches ~11 times a minute for the length of a service.
 */
const emptyHistory = {
  recentKorean: [],
  recentEnglish: [],
  glossary: [],
  entities: [],
  scripture: [],
  corrections: [],
};
const turn = (pending) =>
  buildLiveUserPrompt({
    context: "lecture",
    source: "ko-KR",
    target: "en-US",
    lag: "balanced",
    pending,
    history: emptyHistory,
    continuesPrevious: false,
    allowAnticipation: false,
  });

console.log("\nPer-turn user prompt, by what the speaker actually said\n");
console.log("  kind                     chars   ~tokens");
const SAMPLES = [
  ["monolingual Korean", "오늘 우리가 함께 살펴볼 내용을 정리하겠습니다."],
  ["Korean + English noun", "이번 quarter의 conversion rate가 낮습니다."],
  ["Korean + technical phrase", "오늘은 retrieval augmented generation, 그러니까 RAG 구조를 보겠습니다."],
  ["a quoted English sentence", "I don't think this is going to work."],
];
let monolingual = 0;
for (const [label, pending] of SAMPLES) {
  const prompt = turn(pending);
  const tokens = estimateTokens(prompt);
  if (!monolingual) monolingual = tokens;
  const delta = tokens - monolingual;
  console.log(
    `  ${label.padEnd(24)} ${String(prompt.length).padStart(5)}   ${String(tokens).padStart(7)}` +
      (delta ? `   (+${delta} vs monolingual)` : "   (baseline)"),
  );
}
console.log("");
