# ASAD Earbud Phase 4A: Provider Activation & Benchmark Infrastructure (2026-10-20)

## Status: infrastructure present, provider activation only partial

This document captures configuration evidence obtained by listing **variable
names and scopes only**, never decrypting secrets, in the connected Vercel
project `club-paradiso/asad`.

| Requirement | Observed / action |
| --- | --- |
| Private Preview access | `APP_ACCESS_KEY` exists, scoped to the current `feat/earbud-global-ko-en` Preview |
| Index public API switch | `ASAD_INDEX_TRANSLATE_PUBLIC` is configured for the current Preview |
| Azure Translator F0 credential | `AZURE_TRANSLATOR_KEY` **not found** in the linked Vercel project |
| Azure F0 tier verification | **Not verified**; no Azure Resource Manager connection available |
| Cross-instance Redis reservation | Upstash REST URL and token variable **names** found; actual Redis connectivity not checked |
| Default Preview ensemble | `ASAD_EARBUD_ENSEMBLE=0` and `ASAD_AZURE_F0_CONFIRMED=0` in branch Preview |
| Optional Gemini judge | `ASAD_EARBUD_GEMINI_JUDGE=0`; cannot assume Gemini usage is unbilled |
| Azure preview character cap | 200,000 configured; unused because Azure disabled |

**No key, token, or personally identifying content should be committed, shown
in CI logs or placed in this document.** The app's Redis cap cannot prevent
billing if other applications also use the Azure subscription. Do not enable
Azure or increase its pricing tier without owner verification.

## Official Index API

Upstream repository and exact free public API contract:
- https://github.com/bilibili/Index-Translate
- https://github.com/bilibili/Index-Translate/blob/main/inference/llm/call_api.py

The official script confirms `/v1/chat/completions`, the public model
`Index-Translate-35B-A3B`, `enable_thinking:false` and the standard
`User-Agent`. Public free API availability, region filtering, rate limits,
data retention and latency are **not guaranteed**.

### What we actually observed

- On 2026-10-19, prior smoke tests received 3/3 responses (P50 413ms, P95
  618ms); later 8/8 responded on a different CI run.
- On 2026-10-20, CI #462 returned 0/9 within the 4.5-second client deadline,
  including Korean→English. This **is an unverified external provider**,
  not a successful 9-language translation quality result.
- These samples are too small to establish production availability,
  semantic correctness or ear-to-ear latency.

## Phase 4A hardening completed on this branch

1. Benchmark command `npm run bench:earbud` remains entirely offline and
   deterministic by default; it calls no paid or public inference endpoints.
2. Real public calls require explicit
   `--index-live --confirm-synthetic-only`.
3. `--sources en-US,ko-KR` and `--timeout-ms 5000` allow a reproducible,
   bounded two-way probe. Legal range: 1–20 seconds per call.
4. `--output path.json` produces a sanitized result artifact including only
   fixture IDs, source/target language codes, error category, status, time
   and coarse validation metrics. It never contains actual prompts or output.
5. A response-free run returns **UNAVAILABLE**, mixed results **DEGRADED**,
   and an entirely screened run **RESPONDING_WITH_BASIC_CHECKS**; the latter is
   **not** semantic accuracy verification.
6. Missing output has `sourceTokenRetention:null`, not a deceptively positive
   `true`. Unscreened output counts as a failed probe.
7. Core PR CI runs only two synthetic samples so community API outages do
   not dominate every code change. A prominent GitHub Step Summary warns if
   the provider fails. The external check is nonblocking; green core CI does
   **not** mean the external provider is online.
8. `.github/workflows/earbud-provider-diagnostics.yml` provides a
   manually triggered complete diagnostic, optional up-to-nine language codes,
   configurable timeout, and a 7-day artifact. It uses no Azure credentials.

### Commands

```bash
# Offline. Runs all 42 current synthetic fixtures; no cloud cost.
npm run bench:earbud

# Live Index only, with no real personal data and an explicit 5s deadline.
npm run bench:earbud -- --index-live --confirm-synthetic-only \
  --sources ko-KR,en-US --limit 2 --timeout-ms 5000 \
  --output ./earbud-index-check.json

# Diagnose whether the official free API is simply slower than the
# production-like deadline. Never interpret 12s latency as realtime.
npm run bench:earbud -- --index-live --confirm-synthetic-only \
  --sources ko-KR --limit 1 --timeout-ms 12000
```

Alternatively, use GitHub → Actions → Earbud Provider Diagnostics →
Run workflow. These are **synthetic only** and intentionally run manually
to avoid abusing a public zero-cost service.

## Activation still blocked by account access

Microsoft documents Translator resource creation and service pricing at:
- https://learn.microsoft.com/en-us/azure/ai-services/translator/how-to-create-translator-resource
- https://azure.microsoft.com/en-us/pricing/details/translator/

A genuine Azure Translator **F0** free resource must first be verified on
the account owner's authenticated Azure subscription. Set
`AZURE_TRANSLATOR_KEY` and its optional region **only** in the Vercel
branch-scoped Preview. Do not create S1 or a paid fallback. Observe account-
wide quota and free-tier usage independently from ASAD's Redis reservation.

Only after the provider resource is confirmed should the operator set
`ASAD_AZURE_F0_CONFIRMED=1` and `ASAD_EARBUD_ENSEMBLE=1`, deploy a
new Preview, and conduct parallel runs on invented sentences. Both are still
disabled at the time of this report. Actual AirPods audio routing and
independent human translation quality review remain release gates.

**No production merge/promotion authorised by this checklist.**
