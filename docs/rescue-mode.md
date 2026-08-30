# Sermon Mode: Rescue semantics

## Why Rescue exists

A simultaneous interpreter occasionally loses the thread: a name is missed, a Korean predicate resolves unexpectedly, the speaker accelerates, or the interpreter spends too long repairing an earlier sentence.

The correct recovery behaviour is **not** to replay or retranslate everything missed. That would increase lag precisely when the operator needs to shed it.

Rescue is an emergency catch-up action whose only job is:

> Give the human interpreter the smallest safe English bridge into the speaker's latest resolved idea so they can resume now.

## Time window

The foundation module in `src/interpreter/engine/rescue.ts` selects only stable Korean from the most recent 12 seconds by default.

Rules:

- no unstable partial transcript;
- no fallback to stale material after a long pause;
- newest resolved content wins when the request would exceed the character budget;
- payload is capped at 1,200 Korean characters;
- clipping preserves the end of the newest text, because that is the likely resume point.

These defaults are deliberately conservative. They can be tuned after booth data exists, but the feature must remain bounded.

## Model contract

`src/interpreter/prompts/rescue.ts` defines a separate Rescue user-turn contract while retaining the normal structured `InterpreterOutput` shape.

A Rescue turn must:

- normally produce one `safeChunk`, never more than two;
- prefer the latest meaningful resolved point over completeness;
- never summarise the whole recent window;
- never repeat English that rolling context says was already delivered;
- never backfill examples or earlier clauses just because they are present in the window;
- never invent names, numbers, quotations or Scripture wording;
- never produce `anticipatedChunks`;
- return low-confidence empty `safeChunks` when there is no safe current bridge.

Sermon Mode still preserves theological precision and Scripture-reference safety during Rescue.

## Server isolation

`POST /api/rescue` is a separate inference path rather than a special flag on `/api/interpret`.

That separation is intentional. A Rescue request must not drain, commit, cancel or reorder the normal interpretation engine's pending queue. The ordinary speech-recognition and interpretation pipeline can therefore continue listening while the emergency request is in flight.

The Rescue endpoint:

- is protected by the same session, origin, body-size and live rate-limit boundaries as paid interpretation calls;
- accepts at most the already-bounded 1,200-character recent Korean window plus the normal rolling context;
- uses the deployment's existing LLM router and structured `InterpreterOutput` schema;
- runs with FAST-style context/deadline pressure, no extended reasoning and a small output budget;
- performs no quality escalation, because a late beautiful answer is useless during catch-up;
- strips every `anticipatedChunk` even if a provider ignores the prompt;
- hard-caps returned Rescue speech to two `safeChunks`;
- fails closed to an empty low-confidence Rescue when no cloud model is available or output is malformed.

Importantly, the local deterministic live interpreter is **not** used to fake a Rescue translation of the whole window. If a model cannot perform the dedicated recovery task, no Rescue cue is safer than a semantically wrong one.

## UI contract for a future implementation

The eventual live control should be intentionally simple:

- a large `RESCUE` action and keyboard shortcut `R`;
- one temporary, visually distinct recovery cue;
- no mutation of already committed interpretation chunks;
- no rewriting of the normal transcript;
- no automatic speech or congregation-facing output;
- the normal live pipeline continues listening while Rescue is being generated;
- a Rescue failure must disappear harmlessly and leave normal interpreting untouched.

The recovery cue should expire quickly once the interpreter resumes. Rescue is a transient aid, not a second interpretation timeline.

## Why this is separate from the normal live prompt

The normal interpreter prompt tries to preserve the content of a newly stabilised thought. A Rescue window is different: some unknown portion may already have been interpreted, and completeness is actively harmful because it keeps the interpreter behind.

Therefore implementing Rescue as `pending = last 12 seconds` through the ordinary live path is incorrect even if the output looks fluent. The dedicated prompt contract exists specifically to prevent that failure mode.

## Current implementation status

Implemented and tested:

- bounded recent-Korean selection;
- deterministic stale-window behaviour;
- a dedicated Rescue prompt contract;
- isolated `/api/rescue` inference path;
- server-side output narrowing (no anticipation, maximum two recovery chunks);
- fail-closed behaviour when Rescue inference is unavailable;
- regression tests locking those semantics and request bounds.

Still intentionally not wired into the live cockpit:

- the `RESCUE` / `R` interaction;
- transient recovery-cue presentation and expiry;
- client request lifecycle that guarantees normal live listening continues untouched.

Those are UI/session orchestration changes, not prompt work, and should be wired only after the isolated endpoint is stable.
