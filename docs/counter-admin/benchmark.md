# Administrative layer — benchmark record

`npm run bench:counter` runs it offline. It needs no credentials, makes no
network calls and spends nothing. Results are written to
`benchmarks/results/counter-latest.{md,json}`.

## What is and is not measured

| Evaluation | Status |
| --- | --- |
| Terminology normalisation (matcher) | measured, synthetic |
| Ambiguity detection (rules) | measured, synthetic |
| Integrity-validator (semantic) on supplied renderings | measured, synthetic |
| **Translation quality of the live model** | **NOT measured.** It needs a provider key and a paid or rate-limited model. No provider was called. |
| STT accuracy | **NOT measured.** No reference audio exists in the repository. |
| Latency P50/P95 of real turns | NOT measured. The existing latency *model* is unchanged. The layer adds only local CPU work. |
| UX / end-to-end | `npm run e2e` (44/44) and `npm run e2e:counter` (16/16) passed against a local production build with no provider configured. The staff panel was also driven in Chromium at 1024 px and 390 px: no horizontal overflow, no page errors, no staff panel on the visitor device. |

A validator scoring well on renderings written by its own author does **not**
show how often the model mistranslates in production.

## Corpus provenance

`benchmarks/counter/admin-corpus.ts` holds:

- 38 terminology cases in 10 languages
- 35 ambiguity cases (20 ambiguous, 15 clear)
- 26 semantic cases: 51 faithful and 28 corrupted renderings across 9 language
  pairs

It was written after the rules, by the same author, in the same session. No
rule was tuned on it before the **first run**, which is recorded below
unedited. It is not independent of the author's assumptions, and its non-Korean
lines have not been checked by native speakers.

The lexicons *were* tuned against the existing structured-value corpus
(`corpus.ts`, 67 faithful renderings). Before tuning it showed 7 false alarms;
after tuning, 0. It is reported separately as the "development set".

## First run (before any fix)

| Metric | Result |
| --- | --- |
| Terminology exact concept+kind | 35/38 = 92.1% (95% CI 79.2–97.3%) |
| Ambiguity recall | 18/20 = 90.0% (69.9–97.2%) |
| Ambiguity false-positive rate | 0/15 = 0.0% (0.0–20.4%) |
| Critical corruptions blocked | 21/21 = 100% (84.5–100%) |
| All corruptions flagged | 28/28 = 100% (87.9–100%) |
| Faithful renderings falsely flagged | 5/51 = 9.8% (4.3–21.0%) |

## Fixes made after the first run

Each one is a real bug the run exposed. None is a change to a test case to make
it pass.

1. Korean colloquial forms lacked the contracted past "직장 바꿨" → added.
2. The Chinese rejection form "没批" means "not (yet) approved", not
   "rejected". Worse, it shadowed "批准" in "还没批准" → removed.
3. The Vietnamese question-tag mask included "có phải", which hid a real
   obligation ("có phải khai báo không?" = "do I have to report?") → removed.
4. The invented-approval check missed an approval hidden inside a longer match
   ("인도적 체류 허가를 받으셨습니다") → it now searches for the concept
   regardless of overlap.

One **corpus** correction, disclosed: t-en-4 "My application was accepted"
also mentions *application*. Its expectation was wrong, not the matcher.

## Current run

| Metric | Result |
| --- | --- |
| Terminology exact concept+kind | 36/38 = 94.7% (95% CI 82.7–98.5%) |
| Ambiguity recall | 19/20 = 95.0% (76.4–99.1%) |
| Ambiguity false-positive rate | 0/15 = 0.0% (0.0–20.4%) |
| Critical corruptions blocked | 21/21 = 100% (84.5–100%) |
| All corruptions flagged as mismatch | 28/28 = 100% (87.9–100%) |
| Expected check named | 28/28 = 100% (87.9–100%) |
| Faithful renderings falsely flagged | 1/51 = 2.0% (0.3–10.3%) |
| Development set false alarms (tuned against) | 0/55 (12 in unsupported pairs skipped) |

The 100% critical recall is on **21 synthetic corruptions**. Its 95% lower
bound is 84.5%. It is not evidence of the aspirational 99% target. Reaching
that needs a far larger, independently written corpus.

### Remaining failures, kept on purpose

- t-id-3 "Kartu ARC saya hilang": a non-contiguous phrase, read as the card,
  not as a reissuance.
- t-mix-1 "làm lại 외국인등록증": the same limitation, across languages.
- a-en-6 "What is the deadline to leave?": "deadline to leave" is registered as
  a plain-language form of 출국기한, so the rule treats the deadline as
  stated. It is arguable whether this should be flagged.
- s-ko-ru-2 faithful "…решение ещё не принято" flagged by the **pre-existing**
  negation check, which sees a negation the Korean source does not have.

## Regression gates

`counter.bench.test.ts` pins the current results:

- critical blocked = all
- corruptions flagged = all
- faithful false alarms ≤ 1
- development set false alarms = 0
- ambiguity false positives = 0
- ambiguity recall ≥ 19
- terminology ≥ 36

A regression fails the benchmark. An improvement must be recorded by raising
the gate.
