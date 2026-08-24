/**
 * npm run smoke:llm
 *
 * Sends one tiny fixture to each configured provider and checks that a valid
 * structured response comes back. Skips cleanly when no key is present, so it
 * is safe to run anywhere — including in CI, where it will simply report that
 * nothing was configured.
 *
 * Never prints API keys.
 */
import { availableProviders, requestFor } from "../benchmarks/runner.ts";
import { BENCH_CASES } from "../benchmarks/dataset.ts";
import { buildLiveUserPrompt, systemPromptFor } from "../src/interpreter/prompts/live.ts";
import { INTERPRETER_JSON_SCHEMA } from "../src/interpreter/prompts/json-schema.ts";
import { parseInterpreterOutput } from "../src/lib/schema.ts";

// The Scripture acceptance case: small, and exercises the whole contract.
const fixture = BENCH_CASES.find((c) => c.id === "b06");
const request = requestFor(fixture);
const system = systemPromptFor(fixture.mode);
const user = buildLiveUserPrompt(request);

const { available, skipped } = availableProviders();

console.log(`\ntong-yuck LLM smoke test`);
console.log(`Fixture: ${fixture.korean}\n`);

let failures = 0;
let ran = 0;

for (const { id, provider } of available) {
  const started = Date.now();
  try {
    const response = await provider.complete({
      system,
      user,
      maxOutputTokens: 700,
      temperature: 0.2,
      jsonSchema: INTERPRETER_JSON_SCHEMA,
      thinking: "none",
    });
    const elapsed = Date.now() - started;
    const output = parseInterpreterOutput(response.text);
    ran += 1;

    if (!output) {
      failures += 1;
      console.log(`✗ ${id.padEnd(11)} ${String(elapsed).padStart(6)}ms  schema FAILED`);
      console.log(`    ${response.text.slice(0, 160).replace(/\n/g, " ")}`);
      continue;
    }

    const scripture = (output.bibleReferences ?? []).map((r) => r.display).join(", ") || "none";
    console.log(
      `✓ ${id.padEnd(11)} ${String(elapsed).padStart(6)}ms  ${response.model ?? provider.model}`,
    );
    console.log(`    chunks: ${output.safeChunks.map((c) => `"${c.text}"`).join(" / ")}`);
    console.log(`    scripture: ${scripture}`);
    if (response.usage?.totalTokens) console.log(`    tokens: ${response.usage.totalTokens}`);
  } catch (error) {
    failures += 1;
    ran += 1;
    console.log(`✗ ${id.padEnd(11)} ${String(Date.now() - started).padStart(6)}ms  ${error.message}`);
  }
}

if (skipped.length) {
  console.log(`\nSkipped (no credentials): ${skipped.map((s) => s.provider).join(", ")}`);
}

console.log(`\n${ran - failures}/${ran} provider(s) responded with valid structured output.`);
if (available.length === 1) {
  console.log("Only the local interpreter was available — no cloud provider was verified.");
}
process.exit(failures > 0 ? 1 : 0);
