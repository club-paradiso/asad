# Counter Mode offline benchmark — 2026-10-25T04:54:49.267Z

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
