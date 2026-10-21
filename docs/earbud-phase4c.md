# ASAD Earbud Mode: Phase 4C · Korean Source / English Output (Preview)

## Why this is more than a dropdown

The old Earbud Mode hid Korean from the source list and hardcoded `ko-KR`
as the target in the UI, Gemini prompt, Index API request, Azure REST URL,
deterministic candidate gate and Safari TTS playback. Restoring only the source
option would create an invalid same-language pair and misleading audio.

## Behavior

- **Source** now includes **한국어 (ko-KR)** using the existing native Web Speech
  API recognizer capability. Selecting Korean automatically changes a
  conflicting Korean output into English.
- **Output** can be selected separately: **한국어 (ko-KR)** or
  **English (en-US)**. The Start gate refuses identical source and target
  languages, as well as unsupported output codes.
- Existing foreign-language-to-Korean sessions keep their Korean target.
  Any supported foreign-language input can also target English, subject to
  the browser's source-language STT capability.
- Existing Index, Azure and free-only Gemini translation routes now use the
  requested output language. Deterministic validation checks output script/
  English words, source identifiers and numbers, plus known Korean and
  English negation cues. It **cannot certify semantic accuracy**.
- Safari browser TTS uses the chosen locale and a best-match voice. The
  optional cloud Gemini TTS route is currently **Korean only** and must not
  silently voice an English translation as Korean.
- The target-language voice test and result labels track the chosen output.
  Language changes require re-confirming the device audio check and provider
  privacy consent.
- `source=target` is invalid, including `ko-KR→ko-KR`, because repeating
  the original speech would not test translation.
- The existing Preview provider gates and per-request rate controls stay
  enforced. No production secret or main-branch modifications are needed.

## Scope of global rollout

The **first global-facing output** is English, not a false claim of every
target language/voice already being tested on iPhone Safari. The underlying
language registry already contains many incoming source languages, but STT
support varies by browser. Mongolian/Uzbek browser recognition remains
unavailable in the current free-only Web Speech integration even though the
text translation benchmark covers those languages. Add further *spoken target*
languages only after validating voices, output scripts, provider availability,
latency, and privacy for each pair. International UI localization also remains
a separate workstream.

## Regression coverage and live tests

- `src/features/earbud/language-pairs.test.ts` checks same-language blocking
  and both Korean→English and foreign→Korean pairs.
- `src/features/earbud/ensemble/providers.test.ts` checks Index
  `en-US` output instruction and Azure v3 `from=ko&to=en`.
- `src/features/earbud/ensemble/runner.test.ts` checks Korean→English
  entity/negation retention, wrong-language rejection and consensus.
- `src/app/api/earbud/index/index-api.test.ts` checks Korean→English output
  and same-language rejection.
- `benchmarks/earbud/synthetic-ko.json` includes four invented Korean
  practice sentences, including negative approval status, passport expiry,
  10:30 and E-7-1 classification, for a total of 42 fixtures.
- Phase 4C Index live CI smoke is expanded to **9 source languages** with
  one Korean→English utterance. A successful smoke only establishes API
  availability and basic format screening; it is not proof of spoken accuracy.

## On-device acceptance

1. Open the **Draft PR Preview** on iPhone Safari with AirPods Pro 2 paired.
2. Select source Korean, confirm output auto-switches to English.
3. Run **output-route test** and **English voice test**, listening in one AirPod.
4. Select free Index-only provider and accept synthetic data/privacy notices.
5. Speak this entirely fictional Korean sentence:
   "제 체류기간 연장 신청은 아직 승인되지 않았습니다."
6. Verify recognized Korean source, an English translation preserving
   **not / hasn't**, and **audible English** after microphone activation.
7. Repeat with source English and target Korean to check no regression.
8. Do not use actual applicant information or legal decisions in these tests.

This branch remains experimental; the closed PR #142 is historical. Track
Phase 4C in **Draft PR #145** and do not automatically promote to production.
