# ASAD Earbud Mode · Phase 4B Live Provider Validation

Date: 2026-10-19. Scope: `feat/earbud-listen-mvp` Draft PR #142.
This report deliberately distinguishes **live provider calls**, CI mocks,
actual Azure billing status, and on-device iPhone/AirPods quality.

## Activation performed

- Vercel branch-scoped **Preview**: created a strong `APP_ACCESS_KEY` as a
  `sensitive` secret. The key is not committed or shown in logs.
- `ASAD_INDEX_TRANSLATE_PUBLIC=1`: public Index adapter permitted to run
  in the protected preview, using invented phrases only.
- `ASAD_EARBUD_ENSEMBLE=0`,
  `ASAD_AZURE_F0_CONFIRMED=0`,
  `ASAD_EARBUD_GEMINI_JUDGE=0`: hard off until free-provider ownership,
  billing tier and independent privacy conditions are verified.
- `ASAD_AZURE_F0_MONTHLY_CAP=200000`: preconfigured conservative cap, only
  meaningful after genuine F0 activation. Redis must exist or ensemble rejects
  before contacting any vendor.
- Production Vercel variables, deployment and default branch unchanged.

The linked tool set does **not** have an authenticated Azure Resource Manager
connection and does not permit creating or verifying the owner's Azure
subscription resources. Therefore **Azure F0 resource creation and
`AZURE_TRANSLATOR_KEY` registration have not occurred.** Do not mistake a
preview flag for a confirmed Azure free-tier account.

## Initial actual Index-Translate evidence

GitHub Actions run **#452** exercised the official
`https://index-translate.bilibili.com/v1/chat/completions` endpoint,
using `Index-Translate-35B-A3B`, from the hosted CI runner.

**Not mocks**: Three real synthetic-language translations,
`en-US`, `zh-CN`, and `ja-JP`, were received.

| Metric | Initial actual run |
| --- | ---: |
| Live API responses | 3/3 |
| Timeouts / transport failures | 0 |
| P50 live request latency | 413 ms |
| P95 live request latency | 618 ms |
| Deterministic screening passes | 3/3 |
| Source identifier retention | 3/3 |
| Average Korean reference word overlap | 0.414 (weak lexical proxy) |

These are **3 invented utterances**, not a statistical performance sample.
A Korean paraphrase can have low literal word overlap while retaining the
meaning, and a wrong translation can have high overlap. No human linguistic
accuracy scores exist for these 3 API results. These latencies exclude Web
Speech recognition, application queueing, TTS, Bluetooth routing, and device
playback and are **not ear-to-ear latency**.

Subsequent CI runs expand live Index testing to **8 source languages**
(English, simplified Chinese, Japanese, Vietnamese, Indonesian, Mongolian,
Uzbek and Russian). Check latest PR CI logs for factual run numbers and
results; do not substitute this initial sample for a later run.

## Protected real-provider test without Azure

Added `POST /api/earbud/index`, guarded by the private access-session
cookie and existing per-session/address rate limiting, and returning the same
`InterpreterOutput` shape as the existing ASAD engine. Fails shut on Index
errors, unsafe/missing identifiers, lost negation or an unsupported pair.
Only `confidence:medium` validated text can enter the voice queue.

The `/listen` view now offers:
1. Gemini-only reference,
2. Index-Translate-only real public API evaluation,
3. Index+Azure Smart Ensemble (remains unavailable until F0 verified).

Every mode requires a synthetic-only checkbox and provider-specific consent.
The index-only route exists specifically to validate Index while Azure access
remains blocked. **Never interpret a successful output as a certified legal
translation.**

## Azure F0 account-owner action (not performed)

Official Microsoft documentation:
- https://learn.microsoft.com/en-us/azure/cognitive-services/translator/how-to-create-translator-resource
- https://azure.microsoft.com/en-us/pricing/details/translator/

Once signed in to the owner's Azure subscription, create a **single-service
Translator** resource, select the explicitly displayed **F0** tier (not S1 or a
Foundry LLM deployment), and use the Keys and Endpoint tab to obtain a private
API key. An F0 resource is limited to one per subscription, per Microsoft
guidance. F0 standard translation has a free allowance of 2 million
characters per month. Do not create an S1 fallback.

Enter `AZURE_TRANSLATOR_KEY` and optional
`AZURE_TRANSLATOR_REGION` directly in Vercel project `asad`, protected
**Preview** target bound only to `feat/earbud-listen-mvp`. After verifying the
resource tier and account-wide billing/usage settings, change
`ASAD_AZURE_F0_CONFIRMED` and `ASAD_EARBUD_ENSEMBLE` to `1` and deploy a
new preview. Never share a subscription key in a GitHub PR, chat message or
public log. The 200k monthly reservation ledger covers ASAD traffic only, not
other services using the same Azure subscription.

## Remaining Phase 4B release gates

- [x] Private branch-only Preview gate created
- [x] Index-only live provider path and consent UI
- [x] Initial 3 synthetic live Index API results received, timed, and screened
- [ ] 8-language live smoke and final CI status verified
- [ ] Azure Translator F0 provisioned, credentials held in Vercel, billing checked
- [ ] Protected Azure live synthetic provider smoke with preflight Redis guard
- [ ] True simultaneous Index+Azure+optional Gemini disagreement evaluation
- [ ] Human-reviewed 100–200 synthetic utterances covering omission, dates,
      codes, negation, dialect, numbers, hallucination and transcription faults
- [ ] Actual iPhone 15 AirPods Pro 2 microphone+audio routing and speech playback
- [ ] Privacy/legal assessment before any identifiable immigration dialogue

Until all acceptance gates pass, retain the Draft PR; do not merge, promote or
use in government-service operations.
