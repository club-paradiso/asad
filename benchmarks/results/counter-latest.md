# Counter Mode offline benchmark — 2026-11-09T15:52:36.422Z

Offline benchmark. Validator results are exact over the synthetic corpus. Latency figures are a MODEL over stated parameters (one Redis round trip, one provider response, one poll interval) and the measured round-trip structure of the route; they are not provider or network measurements.

## Translation-quality validators

| Metric | Value |
| --- | --- |
| Cases | 44 |
| Faithful renderings verified | 67 / 67 (false-positive rate 0.0%) |
| Corruptions caught | 62 / 62 (false-negative rate 0.0%) |

| Defect | Caught |
| --- | --- |
| date | 8 / 8 |
| identifier | 3 / 3 |
| invented-value | 5 / 5 |
| money | 5 / 5 |
| negation | 20 / 20 |
| number | 9 / 9 |
| status-code | 7 / 7 |
| time | 5 / 5 |

| Pair | Faithful FP | Corrupted FN |
| --- | --- | --- |
| ar-SA→ko-KR | 0 / 1 | 0 / 1 |
| en-US→ko-KR | 0 / 8 | 0 / 9 |
| hi-IN→ko-KR | 0 / 1 | 0 / 1 |
| ko-KR→ar-SA | 0 / 2 | 0 / 2 |
| ko-KR→en-US | 0 / 33 | 0 / 29 |
| ko-KR→hi-IN | 0 / 2 | 0 / 1 |
| ko-KR→id-ID | 0 / 1 | 0 / 2 |
| ko-KR→ja-JP | 0 / 3 | 0 / 2 |
| ko-KR→mn-MN | 0 / 1 | 0 / 1 |
| ko-KR→ru-RU | 0 / 1 | 0 / 2 |
| ko-KR→th-TH | 0 / 1 | 0 / 1 |
| ko-KR→uz-UZ | 0 / 2 | 0 / 1 |
| ko-KR→vi-VN | 0 / 2 | 0 / 2 |
| ko-KR→zh-CN | 0 / 2 | 0 / 2 |
| ko-KR→zh-TW | 0 / 1 | 0 / 1 |
| ru-RU→ko-KR | 0 / 1 | 0 / 1 |
| th-TH→ko-KR | 0 / 1 | 0 / 1 |
| vi-VN→ko-KR | 0 / 3 | 0 / 2 |
| zh-CN→ko-KR | 0 / 1 | 0 / 1 |

Negation check available: ar-SA, en-US, hi-IN, id-ID, ja-JP, ko-KR, mn-MN, ru-RU, th-TH, vi-VN, zh-CN, zh-TW.
Negation check knowingly absent: uz-UZ.

## Administrative meaning layer (synthetic, offline)

Deterministic components only. These numbers describe the matcher, the ambiguity rules and the semantic validator on a small synthetic corpus written by the same author as the rules. They are NOT a measure of translation quality and NOT external validation.

| Component | Metric | Result |
| --- | --- | --- |
| Terminology | exact concept+kind match | 36/38 = 94.7% (95% CI 82.7–98.5%) |
| Ambiguity | recall on ambiguous utterances | 19/20 = 95.0% (95% CI 76.4–99.1%) |
| Ambiguity | false-positive rate on clear utterances | 0/15 = 0.0% (95% CI 0.0–20.4%) |
| Semantic | critical corruptions blocked | 21/21 = 100.0% (95% CI 84.5–100.0%) |
| Semantic | all corruptions flagged as mismatch | 28/28 = 100.0% (95% CI 87.9–100.0%) |
| Semantic | expected check named | 28/28 = 100.0% (95% CI 87.9–100.0%) |
| Semantic | faithful renderings flagged (false alarm) | 1/51 = 2.0% (95% CI 0.3–10.3%) |
| Semantic (development set, tuned against) | faithful renderings flagged | 0/55 = 0.0% (95% CI 0.0–6.5%); 12 renderings in unsupported pairs skipped |

| Language | Terminology exact |
| --- | --- |
| en-US | 6/6 = 100.0% (95% CI 61.0–100.0%) |
| id-ID | 2/3 = 66.7% (95% CI 20.8–93.9%) |
| ko-KR | 8/8 = 100.0% (95% CI 67.6–100.0%) |
| mn-MN | 2/2 = 100.0% (95% CI 34.2–100.0%) |
| ru-RU | 3/3 = 100.0% (95% CI 43.8–100.0%) |
| th-TH | 2/2 = 100.0% (95% CI 34.2–100.0%) |
| uz-UZ | 2/2 = 100.0% (95% CI 34.2–100.0%) |
| vi-VN | 3/4 = 75.0% (95% CI 30.1–95.4%) |
| zh-CN | 6/6 = 100.0% (95% CI 61.0–100.0%) |
| zh-TW | 2/2 = 100.0% (95% CI 34.2–100.0%) |

| Pair | Faithful flagged | Corrupted caught |
| --- | --- | --- |
| en-US→ko-KR | 0/6 | 3/3 |
| ko-KR→en-US | 0/20 | 12/12 |
| ko-KR→id-ID | 0/4 | 2/2 |
| ko-KR→ru-RU | 1/4 | 2/2 |
| ko-KR→th-TH | 0/2 | 1/1 |
| ko-KR→vi-VN | 0/6 | 3/3 |
| ko-KR→zh-CN | 0/5 | 3/3 |
| vi-VN→ko-KR | 0/2 | 1/1 |
| zh-CN→ko-KR | 0/2 | 1/1 |

Failures:
- t-id-3: expected [card-reissuance:colloquial] got [residence-card:colloquial]
- t-mix-1: expected [card-reissuance:colloquial] got [residence-card:term]
- a-en-6: expected [deadline-type] got []
- s-ko-ru-2 faithful flagged (blocked): "Ваше заявление принято к рассмотрению, решение ещё не принято." — negation:added

## Server round trips per ordinary turn

| | Redis round trips | Recipient poll interval |
| --- | --- | --- |
| Before (main 2e57a0a) | 7 | 1200 ms |
| After (this branch, asserted against the route) | 4 | 500 ms while live |

## Latency model (deterministic arithmetic)

| Scenario | Sender visible before → after | Recipient mean before → after | Recipient worst before → after |
| --- | --- | --- | --- |
| same-region Redis, fast free model | 1691 → 1646 ms | 2331 → 1936 ms | 2931 → 2186 ms |
| cross-region Redis, fast free model | 2466 → 2106 ms | 3126 → 2416 ms | 3726 → 2666 ms |
| same-region Redis, slow model | 3691 → 3646 ms | 4331 → 3936 ms | 4931 → 4186 ms |
| cross-region Redis, slow model, mobile data | 4586 → 4226 ms | 5306 → 4596 ms | 5906 → 4846 ms |

## Recipient delivery, Monte Carlo over jittered inputs (5,000 turns, seeded)

| Scenario | p50 before → after | p95 before → after | p99 before → after |
| --- | --- | --- | --- |
| same-region Redis, fast free model | 2425 → 1999 ms (18%) | 4186 → 3721 ms (11%) | 5452 → 4934 ms (10%) |
| cross-region Redis, fast free model | 3346 → 2562 ms (23%) | 5152 → 4283 ms (17%) | 6431 → 5498 ms (15%) |
| same-region Redis, slow model | 4412 → 4005 ms (9%) | 8431 → 8052 ms (4%) | 11198 → 10779 ms (4%) |
| cross-region Redis, slow model, mobile data | 5587 → 4816 ms (14%) | 9578 → 8839 ms (8%) | 12496 → 11580 ms (7%) |
