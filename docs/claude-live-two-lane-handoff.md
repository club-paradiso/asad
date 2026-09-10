# Claude Code handoff: ASAD Live two-lane engine

This document marks the architectural boundary after the safe incremental latency work. Do not treat it as permission to change billing/provider settings.

## State to inherit

- Live cloud routing remains free-only by default. Do not enable paid-capable providers or purchase credits.
- `perf(live): bypass quota-dead cloud turns` is already in production. Supported desktop Chrome may fall back to its on-device Korean→English Translator after quota/rate-limit failure; unsupported browsers/mobile keep the deterministic fallback.
- The production hot path now has an ultra-compact system prompt when the router selects the `ultra-compact` context profile. The 5-minute local harness measured p50 850 and p95 934 estimated tokens/call versus the prior p50 1,535 and p95 1,619.
- Shared, transcript-free latency telemetry exists. Preserve its privacy boundary.
- The current interpretation engine is deliberately single-flight and its chunk store uses temporal locking: anticipated → current → committed. Committed chunks must never be rewritten.

## Problem left for Claude Code

The remaining user-visible latency is architectural. A cloud completion still sits in the critical path before confirmed English reaches the screen. The next design should split Live into two coordinated lanes:

1. a fast provisional lane using Chrome's on-device Translator only when a real ready session exists;
2. an asynchronous contextual cloud lane that can refine provisional text only while the corresponding chunk is still editable.

The design must degrade cleanly to the existing cloud-first behavior when no true on-device translator is available. Do not pretend the deterministic local helper is translation.

## Non-negotiable invariants

- Never rewrite a committed chunk or anything the interpreter may already have spoken.
- Never let a stale cloud response overwrite a newer turn.
- Preserve Korean transcript continuity on aborts, provider errors, rate limits and session shutdown.
- Preserve Scripture safety, glossary/entity consistency, delayed-predicate handling, anticipation rules and duplicate suppression.
- Keep concurrency bounded. A two-lane design is not permission to create an unbounded request queue.
- Keep all telemetry transcript-free. Durations, ids, provider/model labels and token counts are acceptable; transcript text is not.
- Preserve quota-degradation bypass behavior.
- No paid provider/model/billing changes without explicit user authorization.
- CI mocks the Chrome Translator API. Do not claim the downloadable Korean-English language pack is physically validated unless it is actually exercised on a supported desktop Chrome installation.

## Required validation

At minimum run lint, typecheck, the full unit suite, production build, existing browser fallback E2E, quota-bypass E2E, a new two-lane race/stale-response E2E, 5-minute soak, and a simulated 45-minute bounded-growth soak. Add focused engine tests proving temporal locking and cancellation behavior.

Measure before/after for `stable_to_render`, `stable_to_safe`, provider response, provisional first-paint latency, stale-result drops, max concurrent cloud calls and call rate. Do not report local simulated provider latency as real cloud latency.

## Suggested implementation direction

Prefer a small explicit turn coordinator over rewriting the whole engine. Give each flushed Korean unit a monotonically increasing turn id. If an on-device Translator is ready, render a clearly provisional/current chunk quickly, start or continue the contextual cloud request in parallel, and allow cloud replacement only if that provisional generation is still current/editable and belongs to the same turn. If it has committed, append nothing unless there is a serious correction path already supported by the engine.

The existing `src/interpreter/engine/chunks.ts` temporal-locking semantics are the design constraint, not an inconvenience to delete. The existing `useLiveSession.ts` browser Translator preparation/fallback logic is the integration seam. The existing `InterpretationEngine` should remain framework-agnostic and testable without React.
