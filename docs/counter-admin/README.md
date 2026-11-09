# Counter Mode — Administrative Interpretation Layer (ASAD 2.0)

This layer sits **beside** Counter Mode translation. It never rewrites the
translation. It adds separate, staff-only information to each turn:

| Output | Field | Who sees it |
| --- | --- | --- |
| Faithful translation | `CounterMessage.translatedText` (unchanged) | both |
| Value + meaning checks, one verdict | `integrity` (`issues`, `semantic`, `assessment`) | both see a mismatch warning; staff see the detail |
| Terminology annotations | `analysis.terms` | staff only |
| Ambiguity findings | `analysis.ambiguities` | staff only |
| Suggested clarification question | `analysis.clarifications` | staff only |
| Uncertainty, four separate dimensions | `analysis.uncertainty` | staff only |
| Staff-confirmed interpretation | `staffReview` | staff only |
| Correction of one's own turn | `correctionOf` (a new message) | both |
| Clarifying question actually asked | `clarifies` (a new staff message) | both |

`toParticipantMessage` strips `analysis`, `staffReview` and `reviewFlags`
before anything reaches a visitor device. That is covered by tests through the
real poll route.

## Architecture

**Before (main 4a33ec1)**

```
utterance ─▶ profile keywords ─▶ prompt (+ ≤20 ko/en glossary pairs, immigration only)
          ─▶ LLM ─▶ translation ─▶ value validator (numbers/dates/codes/negation) ─▶ store
```

**After**

```
utterance ─▶ profile keywords + registry sensitive-concept scan (all 10 languages)
          ─▶ prompt (+ only the concepts this turn/recent turns use, target-language
             rendering labelled provisional, non-standard wording warning)
          ─▶ LLM ─▶ translation (untouched)
                     ├─▶ value validator               ┐
                     └─▶ semantic validator (no LLM)   ┴─▶ assessment: passed | review | blocked | unverified
          ─▶ Administrative Meaning Layer (no LLM): terms, ambiguities, clarifications, uncertainty
          ─▶ store ─▶ host view (everything) / guest view (stripped)
staff ─▶ POST /api/counter/review  (confirmed | rejected | cleared, optional candidate concept)
```

Code:

| File | Role |
| --- | --- |
| `src/counter/admin/registry.ts` | Concept registry: 26 concepts × 10 languages, variants, restrictions, statute basis |
| `src/counter/admin/matcher.ts` | Deterministic matching, script-aware word boundaries, longest-match overlap resolution |
| `src/counter/admin/meaning.ts` | Ambiguity rules (data), clarification questions, uncertainty breakdown |
| `src/counter/admin/semantic.ts` | Meaning checks: modality, procedure concept, condition, completion, certainty, actor, invented instruction |
| `src/counter/admin/assess.ts` | One verdict over value + meaning checks |
| `src/counter/admin/prompt-terms.ts` | Per-turn terminology retrieval for the prompt |
| `src/app/api/counter/review/route.ts` | Staff decisions, host capability only |
| `src/features/counter/AdminAssist.tsx` | Staff panel |

## The registry and what "verified" means

- **No translation is `verified`.** A test fails if a term is marked verified
  without a named reviewer and a dated source.
- Korean/English pairs are `curated`: the repository's long-standing pairing,
  not re-checked against a dated source in this change.
- Every other language is `provisional`. It was written so the desk can
  *detect* what visitors say and keep naming consistent. It is never presented
  as an official term: the prompt labels it, and the staff panel labels it.
- The **Korean canonical terms** cite statute (`koBasis`). They were read from
  the current text of 「출입국관리법」 (in force 2026-10-02) and 「난민법」 via the
  national law information service on 2026-11-09: 제7조 사증, 제10조 체류자격,
  제20조 체류자격 외 활동허가, 제21조 근무처의 변경·추가, 제24조 체류자격 변경허가,
  제25조 체류기간 연장허가, 제30조 재입국허가, 제31조 외국인등록, 제33조
  외국인등록증, 제36조 체류지 변경의 신고, 제46조 강제퇴거, 제68조 출국명령 (제3항
  출국기한), 난민법 제2조 (난민인정자, 인도적체류자, 난민신청자).
- That reading changed one existing term. The old glossary called
  근무처 변경·추가 a **report** ("report of change or addition of workplace").
  제21조① says that, in principle, a workplace change needs prior
  **permission**. Only the professionals named in the Enforcement Decree report
  afterwards, within 15 days. The pairing is now "change or addition of
  workplace". The registry adds a restriction telling the model not to decide
  permission-vs-report on anyone's behalf.

## Ambiguity rules

Each rule is data in `meaning.ts`. It lists its candidates and one neutral
question in Korean and English. The question is **not sent automatically**.
"이 질문 보내기" sends it as the staff member's own utterance, labelled
"확인 질문", and it goes through the normal translation and checks. It is never
inserted into the visitor's translated speech.

| Rule | Candidates |
| --- | --- |
| card-or-stay-extension (e.g. 我想延期登录证) | 체류기간 연장허가 / 외국인등록증 재발급 |
| visa-extension-wording | 체류기간 연장허가 / 사증 |
| job-change-scope | 근무처 변경·추가 / 체류자격 변경허가 |
| address-or-workplace | 체류지 변경신고 / 근무처 변경·추가 |
| permission-or-report(-explicit) | 신고 / 허가 |
| stage-unclear | 신청 / 접수 / 허가 |
| deadline-type | 출국기한 / 체류기간 만료일 |
| refugee-outcome | 난민인정 / 인도적 체류 허가 / 난민인정 신청 |
| visa-means-card | 외국인등록증 / 사증 / 체류자격 |

Rules run on **visitor** turns only. On staff turns the staff member is the one
stating the procedure, so a finding there would be noise.

## Semantic checks and severity

| Severity | Meaning | Effect |
| --- | --- | --- |
| critical | may change legal/administrative consequences (must→may, application→approval, status→card, pending→completed, cannot→can) | `status: mismatch`, `assessment: blocked`, confidence forced low, staff review flag |
| high | material change (dropped condition, unjustified certainty, actor swap, invented approval/deportation) | `status: mismatch`, `assessment: review` |
| medium | possibly misleading (dropped obligation without a directive, invented requirement, added uncertainty) | `assessment: review` |
| low | minor (added condition) | shown nowhere by default |

**Independence.** The semantic validator does not use the translating model,
or any model. It is cue lexicons plus the concept registry. It cannot be
argued into agreeing with the model. It is also blind to paraphrase it has no
cue for.

**Coverage.** Meaning checks exist for ko, en, zh-Hans, zh-Hant, vi, id, ru and
th. For every other language the verdict is `unverified`: "values checked;
meaning not checked". It is never `passed`. The actor check also needs a
pronoun lexicon on both sides; it is listed as unchecked for vi and th.

**Not implemented:** an LLM back-translation or second-model semantic check,
and a procedural *scope* check ("only the passport" vs "the passport").

## Human control

| Staff action | How |
| --- | --- |
| Review the original | Every bubble shows both languages (unchanged) |
| Correct a transcription | "고치기" on an own message. It sends a NEW message with `correctionOf`. The original stays on screen marked "아래에서 고쳐 다시 보냄", on both devices |
| Request re-translation | "다시 번역" (unchanged) |
| Confirm an interpretation | "확인함", or press a candidate under an ambiguity |
| Reject | "틀림 표시" |
| Ask a clarification | "이 질문 보내기" |

The only way "a person reviewed this" enters the system is
`POST /api/counter/review` with the host capability. Automatic checks say
"자동 검사 통과 (사람 검토 아님)" and nothing stronger.

## Feature flags

| Variable | Default | Effect when `off` |
| --- | --- | --- |
| `COUNTER_ADMIN_LAYER` | on | no `analysis` on any turn |
| `COUNTER_SEMANTIC_CHECKS` | on | value checks only; verdict `unverified` unless a value mismatches |

Both are local and deterministic. Neither sends anything to any service, and
neither costs anything.

## Privacy and safety review

- **Fixed — sensitive routing gap.** Profile detection matched refugee and
  enforcement *keywords* but missed 94 surface forms of the registry's
  sensitive concepts. Examples: 인도적 체류, "humanitarian stay", 人道主义滞留,
  lưu trú nhân đạo, гуманитарное пребывание. Those turns stayed `general` and
  could take the ordinary provider chain, including its Google fallback.
  Detection now also scans every sensitive concept's forms in all ten registry
  languages and routes the turn to the refugee or judicial profile. A test
  enumerates every form. Over-matching fails safe (stricter provider, no
  Learning Vault). The one generic Thai form found (ส่งกลับ, "send back") was
  removed so it cannot over-match.
- **No new data leaves the server.** The layer is local code. `analysis`
  repeats spans the speaker already said. It is stored in the same session
  record with the same TTL, and it is stripped from visitor views.
- **Learning Vault unchanged.** The candidate written there still carries only
  its old fields. Neither `analysis` nor `staffReview` is added.
- **No logging of content.** No new `console` or telemetry call carries text.
- **Review endpoint.** It requires the host capability, is rate-limited, caps
  the body at 2 KB, and accepts a concept only if the layer offered it as a
  candidate. It records a decision about a translation turn, never an
  administrative decision about the visitor.
- **Not legal advice.** Restrictions and questions avoid stating eligibility,
  deadlines or fees. The prompt marks restrictions "for you only — never add
  these to the translation".
- **Not deployment-ready for official use.** The layer has not had
  independent evaluation, bilingual human review or authorization from any
  government body. A provider's zero-data-retention setting is not such
  authorization. ASAD is not integrated with any government system.

## Known limitations

- Provisional terms in eight languages have **not** been checked by native
  speakers. The same goes for the visitor-facing correction strings
  (`admin-strings.ts`; Mongolian and Uzbek fall back to English).
- Lexicon-based checks miss paraphrases with no cue. They can also misfire.
  For example, Russian "решение ещё не принято" is flagged as added negation by
  the pre-existing negation check.
- The matcher finds only contiguous forms. "Kartu ARC saya hilang" is read as
  the card, not as a lost-card reissuance.
- Recogniser hints for zh/vi/id/ru/th/mn/uz are now sent. Whether each STT
  provider actually applies hints in those languages has not been verified.
- The server receives no acoustic confidence, so for voice turns acoustic
  uncertainty is always "unmeasured".
- Staff UI copy is Korean or English by staff language.

See [benchmark.md](./benchmark.md) for measured results and
[human-review.md](./human-review.md) for the reviewer workflow.
