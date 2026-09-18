# Code-switching, latency and cloud recovery

Three reports, one session of work. This is what was actually wrong, what
changed, and — for one of the three — what the measurement said when it
disagreed with a plausible fix.

---

## 1. Korean-English mixing destroyed transcripts

### The symptom

> 오늘 우리가 살펴볼 개념은 social capital입니다.

arrived on screen as

> 오늘 우리가 살펴볼 개념은 소셜 캐피탈입니다.

and from there the interpretation model had nothing to work with. Foreign
names, acronyms, visa classes and quoted English all failed the same way. It
was not intermittent: it fired on every mixed sentence.

### The root cause

`pickSpeechAlternative` in `src/providers/stt/transcript.ts`. The browser
recogniser returns up to three hypotheses, ranked by its own acoustic
confidence. The product then re-ranked them by **how purely each was written in
the session's script**:

```
score = charactersInExpectedScript / allCharacters
```

For a Korean session that is a direct instruction to prefer a Korean-phonetic
invention over the real thing:

| hypothesis | old score |
| --- | --- |
| `오늘은 retrieval augmented generation, 그러니까 RAG 구조를` | 0.42 |
| `오늘은 리트리벌 어그멘티드 제너레이션, 그러니까 라그 구조를` | **1.00** ← chosen |

The browser had already done the hard part and we discarded it in favour of a
monolingual prejudice.

A second, smaller cause sat next to it. Korean browser result slots are
concatenated **without a space**, because one recognition event can split a
single lexical item across slots (`안녕` + `하세요`). No lexical item is half
Hangul and half Latin, so an English word arriving in its own slot was glued to
the Korean beside it — `오늘social` — and reached the stabiliser, the glossary
matcher and the model as one unrecognisable token.

### The fix

Guest script is legitimate **as long as the session's own script is genuinely
present**. A Korean sentence carrying English nouns is still a Korean sentence,
so its Latin characters count as correctly recognised rather than as errors, and
the browser's confidence ordering decides between hypotheses that are equally
plausible.

What the old score got right is kept: a hypothesis with *none* of the session's
script — romanised Mandarin where Han characters were expected — still loses to
one that has it. The guest allowance is conditional on the source script being
there at all.

The session's own terminology now also breaks ties, because it is the one signal
available at that layer that knows this speaker is about to say "RAG" rather
than "라그".

And a script change across a join is always a word boundary, for a spaced
language being concatenated by the slot-splitting rule. Genuinely unspaced
scripts are untouched: Chinese and Japanese set an inserted Latin word tight
against the surrounding characters, and `我的名字是Kim` has always been
deliberate.

### What each recogniser can actually do

Verified against vendor documentation rather than assumed, and **declared in the
registry** so no code path can claim a capability the vendor does not have.

| recogniser | mixed-language behaviour | what the product does |
| --- | --- | --- |
| OpenAI realtime (Whisper family) | **inherent** — multilingual by construction; `language` biases the decoder rather than constraining it | send the registry's code, plus a prompt naming the guest language and today's terms |
| Deepgram Nova-3 | **multi-model** — a dedicated multilingual model at `language=multi`, covering `en es fr de hi ru pt ja it nl` | use it only for a pair it genuinely covers; keyterm prompting either way |
| Browser SpeechRecognition | **none** — one `lang`, one model | the alternative picker and terminology hints are the only defence |

**Korean is not in Deepgram's multilingual set.** Sending `language=multi` for a
Korean session would be inventing a capability and the socket would be refused
mid-service, so Korean sessions stay on the monolingual Nova-3 model and lean on
keyterm prompting instead. A `ja-JP → en-US` session, which Deepgram does cover
on both sides, gets `language=multi`.

### What the rest of the pipeline now knows

`src/lib/code-switch.ts` reads which **scripts** a stabilised unit is written in.
Deterministic, synchronous, one pass over a short string — no model call, no
round trip, and nothing that could be called language identification, because
scripts are not languages. For a pair whose two languages share a script
(English↔Spanish, zh-CN↔zh-TW) it reports `unknown` and every consumer treats
that as "no opinion" rather than as evidence.

Three consumers:

* **The recogniser's vocabulary.** Prep-sheet terms now go in *both* languages.
  A Korean-only keyterm list tells the acoustic model that English is not
  expected, which is the opposite of true for a speaker who says both in one
  breath.
* **The prompt.** A mixed turn carries a short steer naming the spans to carry
  through unchanged; a turn already delivered in the target language is marked
  as a quotation to reproduce rather than re-translate. Measured cost: **+52 to
  +73 tokens on a mixed turn, and exactly zero on a monolingual one**
  (`npm run measure:prompt`).
* **The fast lane.** A unit already spoken in the target language is rendered
  verbatim instead of being handed to a Korean→English translator. It costs no
  model, no socket and no language pack, so unlike Chrome's on-device translator
  it works in every browser — and it lands in the same tick the recogniser
  settled the words.

---

## 2. Interpretation sometimes never ran

### The three root causes

**The Vercel AI Gateway was Counter-only.** PR #134 added
`src/providers/llm/vercel-gateway.ts` because Counter Mode went dark when the
public OpenRouter free allowance ran out. The fix worked and stopped at
Counter's door: `completeViaVercelGateway` had exactly one caller. Live had the
same failure and worse consequences — an interpreter on a stage watches the
English stop while the Korean keeps scrolling.

**One 403 disabled a provider for the life of the process.** `CircuitBreaker`
treated a single `auth` or `bad_request` as permanent. A 401 is not always a bad
key: an egress proxy, a brief vendor incident, a credential being rotated all
present as 403 and all clear on their own. Under the old rule one of those ended
cloud interpretation for every session on that instance until somebody
redeployed.

**Nothing bounded a turn end to end.** Three providers each allowed their own
deadline answer twelve seconds late; the client's retry ladder could run three
attempts each able to burn a full server turn; and the client's `fetch` had no
deadline at all, so a connection that opened and then stalled held the
contextual lane open indefinitely.

### The failure hierarchy now

```
provisional          on-device translator, or a verbatim target-language unit
      +
contextual cloud     sticky primary provider
      ↓  fails / benched / out of turn budget
                     next configured provider, inside what is LEFT of the turn
      ↓  all configured providers unusable
recovery route       Vercel AI Gateway — zero data retention, no prompt
                     training, fails closed. Never preferred, never sticky.
      ↓  fails or no credential
local floor          deterministic, in-process, never deadline-gated
      ↓
visible state        "Rule-based" / "Backup model" on the console strip
```

Two rules hold it together:

* **The budget is the whole turn, not one provider's slice of it.** An attempt
  that cannot land in time is recorded as `deadline` and skipped rather than
  started — "we never asked it" and "it failed" are different diagnoses, and the
  difference is the whole investigation when a session goes quiet.
* **Nothing is silent.** A recovery turn is reported as `vercel-gateway`, not
  attributed to a provider that answered nothing, and the console says
  *Backup model — the usual model is unavailable. Wording of settled terms may
  shift.* That last clause is the one thing an interpreter can act on: a
  different model chose the words, so a term settled ten minutes ago may come
  back differently, and they are the only one who can catch it.

### Bounds

Derived from the code and pinned by tests, not measured against a vendor:

| | before | after |
| --- | --- | --- |
| server chain, three configured providers (balanced lag) | ~12.4 s | 5.35 s |
| client retry ladder worst case (balanced lag) | ~18.1 s | 6.8 s |
| client behaviour on a stalled socket | unbounded | 6.8 s, then fallback |
| one transient 403 | provider disabled for the process | one 90 s cooldown, one probe decides |

---

## 3. Latency: one hypothesis, measured, and rejected

The obvious remaining latency bug looked like this. `canFlush()` refused to cut
a new turn while a cloud request was in flight, *unless* Chrome's on-device
translator was ready — which is to say, on Safari, Firefox and every phone,
newly stabilised speech sat in the stabiliser until the previous round trip
returned. The coalescing machinery the two-lane work had already built was
sitting right there, unreachable.

It was implemented, and then measured with a cloud-first simulation added to the
harness for the purpose (`npm run bench:live -- --simulate-cloud`, ten simulated
minutes, no fast lane, simulated provider latency 400–3200 ms with 6 % spikes):

| | p50 | p90 | max |
| --- | --- | --- | --- |
| single-flight (before) | 5700 ms | 9467 ms | 17167 ms |
| coalesced (the change) | 5667 ms | 9533 ms | **29667 ms** |

No median gain, and a far worse tail — because the oldest turn in a coalesced
unit ends up waiting for the newest. Reading the stabiliser again explains why
there was never much to win: `pendingSince` is preserved across the gate, so the
held unit flushes on the very next tick once the socket frees, not on a fresh
trigger. The gate costs one tick, not a round trip.

**The change was reverted.** The note lives in `canFlush` so the idea is not
re-derived from plausibility, and the simulation flag stays so the next person
can measure instead of arguing.

### What the latency work did deliver

* The failure-path bounds in the table above, which is where the real pathology
  was: the old worst case was a turn that took eighteen seconds to give up.
* Target-language units render in **0 ms** instead of a full round trip.
* No regression anywhere else: the ten-minute pipeline benchmark and the
  five-minute two-lane soak are unchanged to the millisecond and the token.

### What was NOT measured, and why

Nobody should read a 30 % median improvement into this work, because nothing
here measured a real provider.

* The repository's harness runs on a virtual clock with the local interpreter,
  so its `provider_response` figures are engine overhead, not vendor latency.
* No cloud credentials are available in this environment — `npm run smoke:llm`
  reports `Skipped (no credentials): gemini, groq, openrouter, openai,
  anthropic`, and `npm run health:openrouter` reports no key to check.
* The `asad` Vercel project is not reachable from this session (the connection
  lists only `visable`; a deployment query returns 403), so production
  telemetry — which the app already collects, and which is the only honest
  source for a median — could not be read.

The client telemetry stages that would answer the question are already in place
and unchanged: `stable_to_client_dispatch`, `stable_to_provisional`,
`stable_to_safe`, `stable_to_render`, `provisional_to_refinement`. Reading them
from a real service is the next honest step, and it needs production access
rather than more code.

---

## 4. Context: evidence that never aged out

The resolver reads six signal families. Four of them are textual, and three of
those read a rolling 1,200-character window — but **structure** (resolved
Scripture references) and **terminology** were lifetime counters.

That asymmetry had a specific victim: an academic keynote that opens with a
prayer or quotes a verse in passing. Three resolved references anywhere in
seventy minutes pinned the maximum +9 on worship permanently; the incumbency
rule then required a lecture to beat that frozen score by the switch margin, and
an ordinarily-signposted lecture does not. The session stayed "worship" for an
hour on the strength of a reading that ended in the first minute.

Every textual family now reads the same stretch of speech, so evidence ages out
of all of them together. Context is a property of what is being said *now*.

`src/interpreter/context/context-mixed.test.ts` pins it, including the specific
regression — and that test fails against the previous resolver, which is what
makes it a regression test rather than a description.
