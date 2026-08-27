# tong-yuck LLM benchmark

Run 2026-08-26T06:11:46.800Z → 2026-08-26T06:11:46.833Z

34 interpretation cases, 1× each, 12000ms deadline, Node v22.22.2.

## Summary

Weights: fidelity 30% · speakability 25% · latency 20% · schema 10% · sustainability 10% · privacy 5%.

| Provider | Model | Tier | Total | Fidelity | Speakable | Latency p50 / p95 | Schema | Quota | Privacy | Cache | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| local | `deterministic` | free-or-unknown | **80%** | 32% | 100% | — / 1ms | 100% | 100% | 100% | not reported | **disqualified** |

## Provider-reported usage

| Provider | Requests reporting usage | Input | Cached input | Cache rate | Output | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| local | 0 | 0 | 0 | not reported | 0 | 0 |

A reported 0% means the provider returned usage but no cached input. ‘not reported’ means it did not return enough usage data to measure caching.

### Not tested

These providers were skipped because no credential was configured:

- **gemini** — no GEMINI_API_KEY configured
- **groq** — no GROQ_API_KEY configured
- **openrouter** — no OPENROUTER_API_KEY configured
- **openai** — no OPENAI_API_KEY configured
- **anthropic** — no ANTHROPIC_API_KEY configured

> No claim is made about their quality or latency. A provider that was not run was not measured.

## Hard failures

These make a candidate unsuitable regardless of its numeric score.

### local

- `no_output`

- **b02** (delayed-predicate): no_output
- **b03** (fast-rhetorical): no_output
- **b05** (self-correction): no_output
- **b07** (scripture-paraphrase): no_output
- **b08** (terminology): no_output
- **b10** (proper-noun): no_output
- **b12** (testimony): no_output
- **b17** (ambiguous-pronoun): no_output
- **b19** (early-restructuring): no_output
- **b20** (anticipation-hazard): no_output
- **b21** (quoted-casual): no_output
- **b22** (date-and-time): no_output
- **b23** (place-name): no_output
- **b24** (loanword): no_output
- **b25** (disfluency): no_output
- **b26** (mid-sentence-cancel): no_output
- **b27** (dropped-subject): no_output
- **b28** (long-modifier): no_output
- **b30** (lecture-register): no_output
- **b31** (public-notice): no_output
- **b32** (code-mixed): no_output
- **b33** (stt-error): no_output
- **b34** (abandoned-number): no_output

## Side-by-side review

For a human interpreter. The scores above are proxies; whether English is *sayable* is a judgement only a person doing the job can make.

### b01 · declarative

> Ordinary sermon opening — the baseline everything else is measured against.

**Korean**

```
여러분, 반갑습니다. 오늘 이 자리에 함께해 주셔서 감사합니다.
```

**Reference rendering** — Good morning, everyone. / Thank you for being here today.

**local** — 1ms · 2 chunks · schema ok

> Good morning, everyone.
> Thank you for being here today.

### b02 · delayed-predicate

> Long sentence holding its payload to the very end. English must lead with a topic frame or the interpreter cannot start.

**Korean**

```
제가 오늘 이 자리에서 여러분과 함께 꼭 나누고 싶은 한 가지 이야기가 있는데 그것은 바로 우리의 정체성에 관한 것입니다.
```

**Reference rendering** — There's one thing I really want to share with you today... / and it's about who we are.

**local** — 3ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b03 · fast-rhetorical

> Rapid rhetorical questions to the room. Must stay short and keep the drive.

**Korean**

```
여러분 그렇지 않습니까? 정말 그렇지 않습니까? 우리가 정말 그렇게 살고 있습니까?
```

**Reference rendering** — Isn't that right? / Isn't it though? / Are we really living like that?

**local** — 1ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b04 · incomplete

> Unfinished. A scaffold is honest; completing the thought is invention.

**Korean**

```
그런데 우리가 이 놀라운 은혜를 받고도
```

**Reference rendering** — And yet, even after receiving this amazing grace...

**local** — 0ms · 1 chunks · schema ok

> And yet, even after receiving this amazing grace...
> ◦ _we so easily forget who we are._ (anticipated)

### b05 · self-correction

> Speaker corrects a number mid-sentence. The wrong figure must not survive.

**Korean**

```
그 자리에는 한 삼천... 아니, 삼백 명 정도가 모였습니다.
```

**Reference rendering** — There were about three hundred people there.

**local** — 1ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b06 · scripture-reference

> The acceptance case. Reference must normalise; wording must not be invented.

**Korean**

```
우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.
```

**Reference rendering** — Today we're going to look at... / 1 Peter 2:9.

**local** — 0ms · 2 chunks · schema ok

> Today we're going to look at...
> 1 Peter 2:9.

### b07 · scripture-paraphrase

> Paraphrase rather than citation. Must render the paraphrase, not quote a translation it was not given.

**Korean**

```
베드로 사도는 우리가 택하신 족속이라고 말합니다.
```

**Reference rendering** — Peter says we are a chosen people.

**local** — 1ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b08 · terminology

> Two technical terms that must stay technical. Softening them loses the distinction the sentence exists to make.

**Korean**

```
칭의는 단번에 이루어지지만 성화는 평생에 걸쳐 계속됩니다.
```

**Reference rendering** — Justification happens once and for all, / but sanctification continues your whole life.

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b09 · idiom

> Literal rendering destroys the proverb.

**Korean**

```
티끌 모아 태산이라고 하지 않습니까?
```

**Reference rendering** — You know the saying — little by little, it adds up.

**local** — 0ms · 3 chunks · schema ok

> You know the saying —
> little by little, it adds up.
> Small acts of obedience pile up.

### b10 · proper-noun

> Korean name must romanise conventionally. 'Ryu', not the strict-RR 'Lyu'; surname first.

**Korean**

```
오늘 말씀은 류정길 목사님께서 전해 주시겠습니다.
```

**Reference rendering** — Today's message will be brought by Pastor Ryu Jeong-gil.

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b11 · wordplay

> The brief's disqualifying case. Literal translation kills the joke and the interpreter cannot recover once said.

**Korean**

```
그래서 우리는 길을 잘 찾아야 됩니다. 제 이름에도 길이 있어요.
```

**Reference rendering** — So we need to find the right way. / And speaking of "the way," it's even in my name.

**local** — 1ms · 2 chunks · schema ok

> So we need to find the right way.
> And speaking of "the way," it's even in my name.

### b12 · testimony

> Narrative past, personal register. Must not become expository.

**Korean**

```
제가 스무 살 때 정말 힘든 시간을 보냈습니다. 그때 하나님을 만났습니다.
```

**Reference rendering** — When I was twenty I went through a really hard time. / That's when I met God.

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b13 · prayer

> Register shifts to direct address. English must follow.

**Korean**

```
사랑의 하나님, 오늘 이 말씀을 통해 우리를 만나 주시옵소서.
```

**Reference rendering** — God of love, / meet us today through this word.

**local** — 0ms · 2 chunks · schema ok

> God of love,
> meet us today through this word.

### b14 · humour

> 아멘 하실 분 invites a response an English-speaking room may not give. Needs a flag, not a literal render.

**Korean**

```
사실 제가 어젯밤에 설교 준비하다가 그만 잠들었습니다. 아멘 하실 분?
```

**Reference rendering** — Last night I actually fell asleep preparing this sermon. / Anyone want to say amen to that?

**local** — 0ms · 3 chunks · schema ok

> I'll be honest —
> last night I fell asleep preparing this sermon.
> Anyone want to say amen to that?

### b15 · repetition

> Repetition IS the rhetoric here. Compressing it flattens the sermon.

**Korean**

```
여러분은 택하신 족속입니다. 여러분은 왕 같은 제사장입니다. 여러분은 거룩한 나라입니다.
```

**Reference rendering** — You are a chosen people. / You are a royal priesthood. / You are a holy nation.

**local** — 0ms · 3 chunks · schema ok

> You are a chosen people.
> You are a royal priesthood.
> You are a holy nation.

### b16 · cultural

> 새벽기도 is a Korean church institution, not a time of day.

**Korean**

```
우리 교회는 새벽기도로 유명한 교회입니다.
```

**Reference rendering** — Our church is known for early morning prayer.

**local** — 0ms · 1 chunks · schema ok

> Our church is known for early morning prayer.

### b17 · ambiguous-pronoun

> Korean drops and reuses referents. Getting 그분 vs 그 사람 backwards inverts the sentence.

**Korean**

```
그분이 그렇게 말씀하셨을 때, 그 사람은 아무 대답도 하지 않았습니다.
```

**Reference rendering** — When he said that, the other man didn't answer at all.

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b18 · context-dependent-term

> 은혜 is 'grace' as theology but a blessing in a farewell. Technical rendering here is wrong.

**Korean**

```
오늘 하루도 은혜 많이 받으세요.
```

**Reference rendering** — I hope you're richly blessed today.

**local** — 0ms · 1 chunks · schema ok

> I hope you're richly blessed today.

### b19 · early-restructuring

> The lesson arrives last. English must open with a frame so the interpreter can begin speaking.

**Korean**

```
제가 지난 삼 년 동안 이 프로젝트를 준비하면서 가장 크게 배운 것은 결국 사람이 전부라는 사실이었습니다.
```

**Reference rendering** — Over the last three years working on this project, / the biggest thing I learned was this: / in the end, it's all about people.

**local** — 1ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b20 · anticipation-hazard

> Cut mid-frame before the question exists. Predicting the content here is exactly the failure mode that destroys trust.

**Korean**

```
그래서 제가 여러분께 드리고 싶은 질문은 바로
```

**Reference rendering** — So the question I want to put to you is this...

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b21 · quoted-casual

> 반말 quoted inside polite narration. The quote has to sound like a friend talking; the narration around it has to stay polite. Flattening both to one register loses the story.

**Korean**

```
그때 그 친구가 저한테 이러는 거예요. "야, 진짜 괜찮겠어?"
```

**Reference rendering** — And my friend turned to me and said, / "Hey — are you sure about this?"

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b22 · date-and-time

> A date and a time, both of which the room will act on. 시월 is October, not the tenth month read aloud, and a wrong month sends people to an empty building.

**Korean**

```
다음 주 화요일, 그러니까 시월 이십삼일 오후 세 시에 모이겠습니다.
```

**Reference rendering** — We'll meet next Tuesday — / that's October 23rd — / at three in the afternoon.

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b23 · place-name

> Jeju place names. Every one of them has a literal meaning, and translating rather than romanising them produces confident nonsense nobody can navigate by.

**Korean**

```
이번 수련회는 제주도 서귀포시 성산일출봉 근처에서 열립니다.
```

**Reference rendering** — This year's retreat is on Jeju Island, / near Seongsan Ilchulbong, / in Seogwipo.

**local** — 1ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b24 · loanword

> Korean loanwords that are already English. Re-romanising them, or reaching for a synonym because they look foreign, is a self-inflicted wound.

**Korean**

```
오늘 스케줄은 오리엔테이션 먼저 하고, 그 다음에 워크숍 세션이 있습니다.
```

**Reference rendering** — Today's schedule: / orientation first, / then the workshop session.

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b25 · disfluency

> Stutters and fillers. They carry no meaning, and reproducing them makes the interpreter sound like the one who is struggling.

**Korean**

```
그, 그러니까 제 말은... 어... 우리가, 우리가 좀 더 진지해져야 한다는 거예요.
```

**Reference rendering** — What I'm saying is — / we need to take this more seriously.

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b26 · mid-sentence-cancel

> The speaker abandons a wrong year mid-sentence and supplies the right one. Only the corrected figure may reach the English.

**Korean**

```
저희가 작년에 그 프로그램을... 아니, 재작년에 시작했습니다.
```

**Reference rendering** — We started that programme two years ago — / not last year.

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b27 · dropped-subject

> Three consecutive sentences with no subject at all — ordinary Korean, impossible English. The subject must be recovered from context rather than invented, and it must not silently become 'I'.

**Korean**

```
어제 만났어요. 많이 좋아졌더라고요. 다음 주에 퇴원한대요.
```

**Reference rendering** — I saw Deacon Kim yesterday. / He's doing much better. / They say he'll be discharged next week.

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b28 · long-modifier

> A long pre-nominal modifier chain arriving entirely before the noun it modifies. Rendered in order it is unsayable in one breath; it has to be restructured into a lead plus two clauses.

**Korean**

```
지난 삼십 년 동안 이 교회를 묵묵히 섬겨 오신, 그리고 한 번도 자기 이름을 드러내지 않으신 권사님을 오늘 소개하고 싶습니다.
```

**Reference rendering** — I'd like to introduce someone today. / She has served this church quietly for thirty years, / and never once put her own name forward.

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b29 · proverb

> A proverb with a direct English equivalent. The literal version is comprehensible and still lands as a translation rather than as a saying.

**Korean**

```
여러분, 소 잃고 외양간 고친다는 말이 있지 않습니까?
```

**Reference rendering** — You know the saying — / shutting the barn door after the horse has bolted.

**local** — 1ms · 1 chunks · schema ok

> Shutting the barn door after the horse is gone.

### b30 · lecture-register

> Lecture register in GENERAL mode. Plain instructional English — not sermon cadence, and not the stiff formality that 주시기 바랍니다 invites.

**Korean**

```
자, 그러면 다음 장으로 넘어가겠습니다. 이 부분은 시험에 나올 가능성이 높으니까 집중해 주시기 바랍니다.
```

**Reference rendering** — Right, let's move on to the next chapter. / This part is likely to be on the exam, / so please pay attention.

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b31 · public-notice

> A public-service announcement a visitor will act on. 반드시 is not a suggestion, and softening it into one sends someone home for their ID a second time.

**Korean**

```
민원 접수는 오후 여섯 시까지이며, 신분증을 반드시 지참하셔야 합니다.
```

**Reference rendering** — Applications are accepted until six p.m. / You must bring photo ID.

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b32 · code-mixed

> Korean carrying English business vocabulary. Those words are already the audience's words; expanding the acronym costs breath and sounds like an explanation nobody asked for.

**Korean**

```
이번 분기 KPI는 달성했는데, 다음 스프린트에서 리소스가 좀 타이트할 것 같아요.
```

**Reference rendering** — We hit this quarter's KPIs, / but resources look a bit tight for the next sprint.

**local** — 1ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b33 · stt-error

> The recogniser mangled the pastor's name and the interpreter corrected it earlier in the session. Reproducing the recogniser's version instead is the failure that gets noticed from the platform.

**Korean**

```
오늘 말씀은 유정기 목사님께서 전해 주시겠습니다.
```

**Reference rendering** — Today's message will be brought to us / by Pastor Ryu Jeong-gil.

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b34 · abandoned-number

> A figure is started and abandoned with nothing put in its place. There is no correct number to give, so any number is invented — and this one is about money.

**Korean**

```
헌금은 총 삼백... 아니 잠시만요, 확인해 보겠습니다.
```

**Reference rendering** — The offering came to— / sorry, let me check that.

**local** — 1ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]
