# Ultimate prompt for Claude Code: ASAD Live two-lane interpretation engine

You are working in the GitHub repository `club-paradiso/asad`.

Your task is to perform the next major architectural performance intervention for ASAD's Live Korean→English interpretation feature. Do not merely analyze or propose. Inspect the current repository state, implement the work, test it rigorously, and leave the repository in a merge-ready state with a concise report of measurements, remaining risks, and exact files changed.

## First: synchronize and inspect

1. Start from the latest `main`. Do not assume any branch state from an earlier session.
2. Read these files before changing code:
   - `docs/claude-live-two-lane-handoff.md`
   - `benchmarks/results/live-compact-prompt-2026-09-10.md`
   - `src/features/live/useLiveSession.ts`
   - `src/features/live/cloud-degradation.ts`
   - `src/providers/llm/browser-translator.ts`
   - `src/interpreter/engine/session.ts`
   - `src/interpreter/engine/chunks.ts`
   - `src/interpreter/engine/stabiliser.ts`
   - `src/interpreter/engine/lag.ts`
   - `src/app/api/interpret/route.ts`
   - `src/interpreter/prompts/compact.ts`
   - `benchmarks/live-harness.ts`
   - `.github/workflows/ci.yml`
3. Inspect current open PRs/branches enough to avoid overwriting concurrent work. If `main` moved, rebase your work conceptually on the actual current main rather than reverting newer changes.
4. Run the existing test suite and establish the current baseline before architecture changes. Record exact counts and any pre-existing warnings separately from regressions.

## Context you must preserve

ASAD is a live copilot for a human simultaneous interpreter. The interpreter may already be speaking a chunk while the system is processing the next Korean unit. Therefore text stability is a product-safety requirement.

The current chunk lifecycle is:

`anticipated → current → committed`

Committed chunks are immutable. Once the interpreter may have spoken a chunk, the UI must not rewrite it.

The current Live engine is intentionally framework-agnostic and single-flight. `useLiveSession.ts` owns browser APIs, speech providers and network calls. `InterpretationEngine` owns stabilization, context construction, interpretation application and chunk state. Keep that separation unless there is overwhelming evidence that a small interface extension is required.

Recent performance work already completed:

- quota-dead cloud turns are bypassed after a recognized quota/rate-limit failure when Chrome's real on-device Korean→English Translator is ready;
- unsupported browsers/mobile do not pretend to have true local translation;
- the production `ultra-compact` context path uses a compact system prompt;
- the 5-minute harness measured 55 calls / 5 min and reduced estimated tokens/call from a previous p50 1,535 / p95 1,619 to p50 850 / p95 934;
- shared latency telemetry exists and is transcript-free;
- current production cloud capacity may still be free-tier constrained. You are NOT authorized to enable paid-capable provider routes, buy OpenRouter credits, add billing, or change a user's paid settings.

## Primary objective

Remove the cloud completion from the first-English critical path on browsers where a real on-device Chrome Translator session is ready, without sacrificing temporal locking or contextual cloud quality.

Implement a bounded two-lane Live architecture:

### Lane A: fast provisional lane

When and only when a real `BrowserTranslatorSession` is already ready:

- translate the flushed stabilized Korean unit immediately with the on-device translator;
- render that English as explicitly provisional/editable output as quickly as possible;
- do not wait for cloud completion before first useful English appears;
- do not use the deterministic local helper as if it were English translation;
- do not wait for a language-pack download in the middle of a turn.

### Lane B: contextual cloud lane

For the same logical turn, start the normal contextual `/api/interpret` cloud request asynchronously with the existing safety prompt, glossary, Scripture, context, quota logic and telemetry.

When the cloud result arrives:

- it may replace/refine provisional output only if it belongs to the same logical turn and the provisional chunk(s) are still editable;
- it must never rewrite committed chunks;
- it must never let an older/stale cloud result overwrite a later turn;
- if the provisional output has already committed, prefer dropping a merely stylistic refinement rather than appending noise;
- use the existing discreet correction semantics only for a genuinely material correction where that behavior is already appropriate and testable;
- preserve duplicate suppression and rhetorical repetition semantics.

## Turn identity and race safety

Introduce the smallest explicit coordination primitive that makes races provably safe. A recommended design is a monotonically increasing logical turn id/generation attached to every flushed unit and every provisional/cloud result.

Requirements:

- every network/on-device result must know which turn it belongs to;
- stale cloud results are dropped deterministically;
- ending/stopping a session invalidates outstanding work;
- changing mode/lag or starting a new session must not allow old results to leak into the new state;
- AbortController behavior remains correct;
- concurrency is bounded. Target at most one active cloud interpretation request per session unless measurements justify a very small explicit bound. Do not create an unbounded queue;
- newer Korean must not disappear simply because an earlier cloud request is still running. If you retain single-cloud-flight, design a coalesced pending queue or equivalent so the cloud lane cannot permanently starve later turns.

Do not solve races by removing temporal locking.

## Engine/chunk API design

Prefer extending the existing engine with explicit provisional/refinement operations rather than bypassing it from React.

Good direction, subject to repository reality:

- engine flush creates/returns a turn identity;
- provisional lane can apply provisional safe chunks for that turn;
- chunk metadata records enough provenance to decide whether a cloud refinement is still legal;
- a refinement helper replaces only current provisional chunks belonging to that same turn;
- committed chunks remain byte-stable;
- engine state remains deterministic and unit-testable without DOM/browser globals.

Do not mutate chunk arrays from `useLiveSession.ts` directly.

If you need a new chunk state, justify it carefully. Prefer metadata such as `provisional`, `turnId`, or provenance while retaining existing anticipated/current/committed temporal meaning, because those states already encode what the interpreter may have spoken.

## Behavior when Browser Translator is unavailable

The architecture must gracefully reduce to current cloud-first behavior.

- Desktop Chrome with Translator ready: two-lane provisional + cloud refinement.
- Translator supported but still downloading/preparing: do not wait mid-turn; use existing cloud-first path until ready.
- Translator unavailable/failed/mobile/unsupported: existing cloud-first path.
- Cloud quota exhausted with Translator ready: keep existing quota bypass and continue on-device translation without repeatedly paying doomed cloud latency.
- Cloud quota exhausted without Translator: preserve the current deterministic fallback/degraded behavior. Do not claim it is real translation.

## Do not break domain quality

Preserve all current interpretation safety behavior:

- semantic fidelity outranks naturalness and latency;
- zero hallucination;
- delayed Korean predicate scaffolding;
- never invent unresolved payload;
- names/numbers/dates/references are not guessed;
- unseen quotations/Scripture wording is not invented;
- settled names, glossary and corrections remain consistent;
- Scripture references are normalized safely;
- theological technical vocabulary remains technical;
- sermon relational language remains natural;
- deliberate rhetorical repetition is preserved;
- anticipation remains bounded and never predicts names/numbers/references/quotations;
- wordplay/cultural handling remains intact.

Do not weaken these prompts just to produce prettier latency numbers.

## Telemetry and measurable success

Extend the existing transcript-free telemetry with only non-content metadata needed to measure the two-lane behavior. Do not persist Korean or English transcript text.

Add, if absent, measurements for:

- stable Korean → provisional English applied;
- stable Korean → provisional English rendered;
- stable Korean → final/refined safe English;
- cloud refinement latency;
- stale cloud results dropped;
- provisional results that committed before cloud refinement;
- provisional results successfully refined;
- max concurrent cloud calls;
- call rate per minute.

Use IDs, durations, booleans, provider/model labels and token counts only.

Performance target on a supported desktop Chrome path:

- provisional first useful English should generally appear substantially before the current cloud result;
- target provisional stable→render p50 under 1,000 ms and p95 under 1,800 ms in deterministic browser tests where the mocked Translator itself is fast;
- preserve existing final `stable_to_render` SLO targets unless real measurements justify changing them;
- no regression in 45-minute bounded growth;
- no unbounded request accumulation.

Do not report mocked/local provider timings as evidence of real cloud latency. Clearly label simulated measurements.

## Required tests

Add focused unit tests for at least these races:

1. provisional chunk appears before cloud completion;
2. same-turn cloud result refines an editable provisional chunk;
3. cloud result arriving after provisional commit does not rewrite the committed chunk;
4. stale cloud result from turn N cannot overwrite turn N+1;
5. session stop/end invalidates late results;
6. quota bypass still prevents repeated doomed cloud calls;
7. browser Translator failure falls back cleanly without losing Korean;
8. browser Translator unavailable preserves cloud-first behavior;
9. cloud failure after provisional success leaves useful provisional English on screen;
10. later stable Korean is not lost while a prior cloud request is in flight;
11. duplicate suppression does not delete intentional repetition within a turn;
12. corrections/Scripture/glossary memory still update only from trusted final/contextual output where appropriate.

## Required browser/E2E coverage

Preserve and run existing E2Es, including browser fallback and quota-bypass.

Add a dedicated two-lane Playwright regression that mocks `window.Translator` and delayed `/api/interpret` responses and proves, through the real `/live` UI:

- provisional English appears before the delayed cloud response;
- cloud refinement updates only the still-current provisional generation;
- a deliberately stale delayed response is ignored;
- committed output is not rewritten;
- no page errors occur;
- request count remains bounded.

CI may mock the Translator API, but your final report MUST explicitly state that this is not physical validation of Chrome's downloadable Korean-English language pack.

## Soak and build validation

Before declaring the work complete, run:

- `npm ci`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run smoke:llm`
- existing 5-minute soak/benchmark
- existing browser fallback E2E
- existing quota-bypass E2E
- new two-lane E2E
- a simulated 45-minute two-lane soak with realistic delayed cloud responses and bounded state

For the 45-minute simulation record at least:

- calls/minute;
- provisional renders;
- refinements;
- stale drops;
- max concurrent cloud requests;
- final chunk count;
- peak retained context/tokens;
- any rate-limit loop events;
- process memory trend if the current harness supports it.

Do not claim a real 45-minute microphone/provider validation unless you actually ran one.

## Production/provider constraints

Do NOT:

- purchase credits;
- enable paid OpenRouter fallbacks;
- add a paid provider as a silent default;
- expose API secrets;
- delete or weaken rate limits/session guards;
- send transcripts into analytics/telemetry;
- remove the current quota-degradation bypass;
- merge an experimental dependency/toolchain migration merely because it is nearby;
- rewrite unrelated UI/product areas.

Keep the change focused on Live interpretation latency/reliability.

## Working style

Do not stop after writing a plan. Inspect, implement, run tests, debug failures, and iterate until the branch is merge-ready or a genuine external blocker is proven.

When a test fails, determine whether the implementation or test assumption is wrong. Do not weaken assertions merely to get green CI.

Prefer small named modules and explicit state transitions over a giant callback in `useLiveSession.ts`.

Do not introduce a new framework/state library unless clearly necessary.

Preserve TypeScript strictness and existing architecture conventions.

Do not create dead experimental files or temporary workflows in the final diff.

## Final deliverable

When finished, provide:

1. concise root-cause summary;
2. architecture implemented and why;
3. exact files changed;
4. before/after benchmark numbers, clearly separating simulated/on-device/mock/cloud measurements;
5. full test/build/E2E/soak results with exact test counts;
6. known limitations, especially real Chrome language-pack validation and free-tier cloud capacity;
7. any production configuration changes, which should normally be none;
8. the branch name and PR-ready commit SHA;
9. a short manual validation checklist for a real supported desktop Chrome machine.

Do not merge to `main` or change production billing/provider configuration unless the human explicitly instructs you to do so. Your endpoint is a rigorously verified, PR-ready branch.