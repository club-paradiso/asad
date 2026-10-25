# Counter Mode architecture audit

Branch `feat/counter-mode-overhaul`, from `main` at `2e57a0a`. Performed in a
cloud container with no provider credentials, no Redis and no spend. Every
observation below was checked against the code as it stood on `main`; where a
claim was verified by a test or a measurement the section says which.

Companion documents: [latency baseline](latency-baseline.md), [translation
quality benchmark](translation-quality-benchmark.md), [reliability and
security](reliability-and-security-audit.md), [UX audit](ux-ui-audit.md),
[before/after](before-after-results.md), [validation](validation-report.md),
[release readiness](release-readiness.md).

## 1. End-to-end map, as found

```
VISITOR / STAFF DEVICE
  speech ─► CounterSpeechController (counter-speech.ts)
            credential prefetch → Deepgram | OpenAI realtime | WebSpeech | HF batch
            stable text + trailing-silence wait (1.5–1.9 s by language) → transcript
  transcript / typed text ─► Composer (edit before send; risk read-back prompt)
  Composer ─► useCounterSession.send
            ordered queue · idempotency key · retry [0, 400, 1100] ms · no timeout
            POST /api/counter/message
SERVER (Next 16 route handler, Node runtime, Vercel Functions)
  guardInferenceRoute: access gate · same-origin · session cookie · local limiter
                       · shared Redis limiter (1 round trip) · body cap 16 KB
  zod parse ─► store.get (Redis GET)                                        [RTT 2]
  participant from capability token · duplicate check · action validation
  detectCounterProfile on a snapshot, then store.update to persist profile    [RTT 3,4]
  translateForCounter ─► LlmRouter.complete (per-provider deadline 6 s, no turn budget)
                        sensitive profiles pinned to OpenRouter data_collection=deny
                        gateway recovery for general profiles
  risks · extractCriticalValues · validateTranslationIntegrity · review flags
  persistOnce: store.update (Redis GET + EVAL CAS)                            [RTT 5,6]
  recordLearningCandidate (Redis EVAL) — AWAITED before the response         [RTT 7]
  JSON response ─► sender merges message
OTHER DEVICE
  GET /api/counter/session?since=cursor every 1 200 ms (8 000 ms hidden) ─► render
```

Average recipient delivery on `main` is therefore:

> network + 6–7 Redis round trips + provider + half a poll interval (600 ms) + poll round trip.

## 2. Findings, prioritised

| # | Severity | Finding | Root cause | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | High | A visitor who reloads the page is refused as "a second person" and locked out of their own conversation; a desk reload orphans the session | Capability token held only in React state | Code read of `CounterGuestScreen`/`CounterHostScreen`; join route returns 409 for a token-less re-join once a guest exists | Per-tab `sessionStorage` resume (code, token, language), 401 handled as its own terminal state; E2E reload check |
| 2 | High | Integrity warning fires on correct translations: "3 PM", "50,000 won", "6만 원", "three documents", "15th of March", Vietnamese yes/no questions, "Alien Registration Card", CJK digits glued to words | Extractors were Korean/English-digit centric; negation tables did not know question particles | Synthetic corpus: 31 of 67 faithful renderings flagged on `main` (46%) | Validator overhaul; 0 of 67 flagged, 0 of 62 corruptions missed; see quality benchmark |
| 3 | High | No whole-turn deadline: three providers × 6 s plus a 6 s gateway recovery can hold two people for ~24 s | `translateForCounter` set only `deadlineMs` | Code read of `translate.ts` and `LlmRouter.complete` | `turnDeadlineMs` 10 s, `minAttemptMs` 1.2 s, gateway bounded by remaining budget |
| 4 | High | Hung send blocks the queue forever | `guardedFetch` had no timeout; retries only on error | Code read of `useCounterSession.send` | 20 s abort + idempotent retry; tested |
| 5 | Medium | Three avoidable serial Redis round trips per turn (second GET, profile EVAL, awaited vault write) | Profile persisted before translation with its own GET+EVAL; vault write awaited | Route read; counted with an instrumented store (test) | Conditional-write `store.update`, single admission read, vault write via `after()` → 7 → 4 round trips |
| 6 | Medium | Fixed 1.2 s poll adds 600 ms mean / 1.2 s worst delivery delay regardless of activity | Constant interval | Code read | Adaptive cadence 500 ms live / 1.2 s / 2.5 s idle / 8 s hidden |
| 7 | Medium | Sender sees nothing for the whole translation; sent, processing, translated and failed states look alike until the response | No optimistic state | UI read | Local pending bubble, persistent failed bubble with resend/discard |
| 8 | Medium | Join endpoint has no rate limit; a script can occupy a waiting session before the real visitor; poll endpoint has none either | None configured | Route read | 20 joins/min per address; 240 polls/min per capability; tested |
| 9 | Medium | Trailing-silence wait 1.5–1.9 s applies even after the recogniser punctuated the sentence closed; transcript waits for AudioContext teardown | Single `stableDelayMs` per language; `finally` awaited stop/disconnect | `counter-speech.ts` read | Punctuation-aware shortening to 0.6× (≥ 900 ms); teardown no longer blocks the transcript |
| 10 | Medium | Accidental End: one tap on "종료" or the visitor's × ends the conversation for both | No confirmation | UI read | Two-tap confirm within 4 s, in the reader's language (26 languages) |
| 11 | Low | Every poll re-renders the whole screen even when nothing changed | `setSession` on each tick | Hook read | Skip when the view is unchanged; tested |
| 12 | Low | `docs/counter-mode.md` token figure (~400/call) is stale: the system prompt alone is ~1 100 tokens | Prompt grew | Prompt length | Documented; prompt left unchanged (fidelity first) |
| 13 | Info | `forceSensitiveRouting` is computed and passed but ignored by `translateForCounter` (compatibility field); it still gates the Learning Vault | Historical | Code read | Left as is; comment corrected |
| 14 | Info | Header controls on the desk were 30 px tall | Styling | UI read | 44 px minimum |

## 3. What was deliberately not changed

- **The translation prompt.** Every rule in `COUNTER_SYSTEM_PROMPT` is a
  fidelity rule. Trimming it for latency without a real-provider quality
  evaluation would be exactly the trade this mission forbids.
- **The per-provider 6 s deadline.** There is no production latency
  distribution available here to tune it against. A whole-turn budget now
  bounds the worst case instead.
- **Sensitive-profile routing.** Still pinned to OpenRouter with
  `data_collection=deny`, still fails closed, still never recovers through the
  gateway. The route restructure keeps profile detection inside the atomic
  mutation on the freshest copy of the session (see
  `counter-api.test.ts`, "writes the profile only when a turn changes it").
- **The transport.** Polling stays. See [latency-baseline.md](latency-baseline.md)
  §4 for the SSE/WebSocket/long-poll comparison and why adaptive polling won.

## 4. Verification

- `npm run lint`, `npm run typecheck`: clean.
- `npm test`: 149 files / 1 711 tests (baseline 144 / 1 631).
- `npm run bench:counter`: quality corpus and round-trip assertions, report in
  `benchmarks/results/counter-latest.md`.
- `npm run e2e:counter` against a production build with no provider: see
  [validation-report.md](validation-report.md).
