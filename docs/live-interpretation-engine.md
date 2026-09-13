# ASAD Live — unified interpretation engine

Architecture of record after the realtime upgrade. Supersedes the mode
split described in `sermon-booth.md` and extends `live-two-lane-engine.md`.

## What changed, in one paragraph

Live is one product. The interpreter picks a **source language → target
language** pair and presses Start. There is no Sermon/General choice: a
bounded **Context Engine** infers the room (worship, sermon, lecture,
meeting, conversation, presentation, event, generic) from evidence and
switches the worship/sermon intelligence on when — and only when — the
evidence says so. Every language fact lives in one **registry**. Every
stabilised unit becomes a **turn with an id and a revision**; a result built
on an older revision can never overwrite a newer one. A **fast path**
(validated Translation Memory → remembered rendering → on-device translator)
puts the first useful line on screen without waiting for the cloud; the
**quality path** (rolling context → cloud → Repair Engine → stability gate)
may refine it only while it is still editable and only when the refinement
corrects meaning rather than style.

## Pipeline

```
recogniser partial/stable (+confidence, N-best)
   │
   ▼
normaliseTranscript(language)        presentation only; raw text kept
   │
   ▼
Repair Engine · source               entity surface resolution, N-best,
   │   high band → repair            provider confidence, glossary, recurrence
   │   medium    → hypothesis        (→ prompt as RECOGNITION HYPOTHESES)
   ▼
stabiliser (language-aware boundaries) → LOGICAL TURN {id, revision}
   │
   ├─ fast path
   │    validated TM hit ──────────► screen (origin tm), cloud skipped
   │    remembered rendering ≥0.9 ─► provisional line
   │    on-device translator ──────► provisional line
   │
   └─ quality path (≤1 in flight, coalesced backlog)
        rolling context + domain + routeTier + hypotheses + memory hints
        ──► /api/interpret ──► Repair Engine · target
                                 number/date/negation/script/echo → flag
                                 settled-entity variant → fix
                            ──► revision check ──► stability gate ──► refine | keep | discard
                            ──► absorb knowledge (glossary, entities, TM, topic → Context Engine)
   │
   ▼
chunk store: anticipated → current → committed (never rewritten)
```

## Ownership

| Concern | Module |
| --- | --- |
| Language facts (ids, names, script, direction, STT ids per provider, Chrome Translator tag, aliases) | `src/languages/registry.ts` |
| Boundaries, joining, lengths per language | `src/languages/segmentation.ts` |
| Presentation normalisation, lookup keys, tokens, structured values, negation | `src/languages/normalise.ts` |
| Chinese script detection and punctuation | `src/languages/chinese.ts` |
| Target-writing guidance per language (shared by Live and Counter prompts) | `src/languages/writing-guidance.ts` |
| Context Engine | `src/interpreter/context/engine.ts` |
| Entity Memory (canonical entity ↔ surface forms) | `src/interpreter/memory/entity-memory.ts` |
| Translation Memory (exact → normalised → entity-aware → safe fuzzy) | `src/interpreter/memory/translation-memory.ts` |
| Persistent, user-controlled memory (localStorage) | `src/interpreter/memory/persistent.ts` |
| Repair Engine (source + target assessment, confidence bands) | `src/interpreter/repair/assess.ts`, `gate.ts` |
| Stability gate | `src/interpreter/repair/stability.ts` |
| Adaptive routing tier | `src/interpreter/engine/routing.ts` |
| Turns, revisions, lane statistics | `src/interpreter/engine/turns.ts` |
| The engine | `src/interpreter/engine/session.ts` |
| Browser wiring, audio activity, T0–T7 timings, persistence | `src/features/live/useLiveSession.ts` |

## Invariants the tests enforce

- A committed chunk is byte-for-byte immutable, whatever arrives.
- A contextual result may refine only still-editable provisional chunks of
  its own turn, at the revision it was dispatched for, in the generation it
  was dispatched in.
- A user correction bumps the revision of every affected in-flight turn; the
  stale answer is dropped and the corrected source is re-interpreted.
- A stylistic rewrite never reaches the screen ("Please sign in first." vs
  "First, please log in." is kept); a changed number, date, negation, settled
  entity or a genuinely different sentence does.
- Only a **user/prep**-validated Translation Memory entry may answer a turn
  without the model. A single model rendering is a hint; it becomes a
  supported inference only by recurring.
- The Repair Engine substitutes only known canonical forms, and only at a
  high evidence band. Medium-band candidates travel to the model as
  hypotheses; the model is told never to invent a third reading.
- Korean-only detectors (Scripture, wordplay, sermon lexicon) run only for a
  Korean source. Other sources get the registry's boundaries, the pair-aware
  prompt and the shared memory layers.
- Every optional intelligence (Repair Engine, memory, Context Engine, stability
  gate) is wrapped: if it throws, the turn proceeds as it would have before
  the upgrade. The fast path is the reliability floor.

## Confidence bands

| Band | Source | Action |
| --- | --- | --- |
| low | < 0.65 combined evidence | keep as heard |
| medium | 0.65–0.85 | hypothesis to the model, no rewrite |
| high | ≥ 0.85 with a user/prep entity, ≥ 0.9 otherwise | repair (substitute canonical form) |
| very-high / repeated | repeated high | reinforce memory |
| user | interpreter confirmed | highest; persists when allowed |

Combined evidence weighs provider confidence, N-best agreement, entity
surface similarity (jamo-level for Korean), entity provenance and recency.
A model's self-reported probability is never treated as calibrated.

## Trust order for memory

user-confirmed › prep sheet › curated glossary › repeated supported inference
› single model answer. A lower-trust entry never overwrites a higher one; a
different rendering at equal or higher trust supersedes and the old entry is
marked `supersededBy`. Invalidated entries are never served again.

## Persistence and privacy

Only user-confirmed corrections and entity bindings, and memory entries that
are user/prep or strongly repeated, are written to `asad:memory:v1` in the
browser — and only when "다음 세션에도 기억" is on. No transcript, no audio, no
single model answer. Telemetry stages carry durations and labels, never text.

## Latency timeline (browser-measured, transcript-free)

| Stage | Meaning |
| --- | --- |
| `speech_to_first_partial` | T0→T1, only where raw audio is available (PCM providers) |
| `partial_to_stable` | T1→T2 |
| `stable_to_client_dispatch` | T2→T3 |
| `stable_to_first_useful` | T2→T4, first target content from any path |
| `stable_to_render` | T2→T5 |
| `quality_repair_start` | T2→T6 |
| `quality_repair_rendered` | T2→T7 |
| `stable_to_memory_hit` | a validated memory answer, no model |

Lane statistics (`InterpretationEngine.laneStats()`) add memory hits, misses,
cloud calls skipped, glossary hits, repair attempts/accepted, hypotheses,
target flags/fixes, stylistic rewrites suppressed and revision-stale drops.

## Deterministic quality harness

`npm run bench:quality` scores the model-free quality path against
`benchmarks/quality-fixtures.ts` (repair success, unnecessary repairs,
target-check recall and false alarms, stability agreement, domain
classification). `tests/quality-harness.test.ts` asserts the thresholds.
Provider-dependent quality still needs `npm run bench:llm` with credentials.
