# tong-yuck LLM benchmark

Run 2026-08-24T08:03:28.281Z → 2026-08-24T08:03:28.305Z

20 interpretation cases, 1× each, 12000ms deadline, Node v22.22.2.

## Summary

Weights: fidelity 30% · speakability 25% · latency 20% · schema 10% · sustainability 10% · privacy 5%.

| Provider | Model | Total | Fidelity | Speakable | Latency p50 / p95 | Schema | Quota | Privacy | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| local | `deterministic` | **85%** | 50% | 100% | — / 2ms | 100% | 100% | 100% | **disqualified** |

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

**local** — 0ms · 0 chunks · schema ok · **no_output**

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

**local** — 0ms · 0 chunks · schema ok · **no_output**

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

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b08 · terminology

> Two technical terms that must stay technical. Softening them loses the distinction the sentence exists to make.

**Korean**

```
칭의는 단번에 이루어지지만 성화는 평생에 걸쳐 계속됩니다.
```

**Reference rendering** — Justification happens once and for all, / but sanctification continues your whole life.

**local** — 1ms · 0 chunks · schema ok · **no_output**

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

**local** — 1ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b11 · wordplay

> The brief's disqualifying case. Literal translation kills the joke and the interpreter cannot recover once said.

**Korean**

```
그래서 우리는 길을 잘 찾아야 됩니다. 제 이름에도 길이 있어요.
```

**Reference rendering** — So we need to find the right way. / And speaking of "the way," it's even in my name.

**local** — 0ms · 2 chunks · schema ok

> So we need to find the right way.
> And speaking of "the way," it's even in my name.

### b12 · testimony

> Narrative past, personal register. Must not become expository.

**Korean**

```
제가 스무 살 때 정말 힘든 시간을 보냈습니다. 그때 하나님을 만났습니다.
```

**Reference rendering** — When I was twenty I went through a really hard time. / That's when I met God.

**local** — 1ms · 0 chunks · schema ok · **no_output**

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

**local** — 0ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]

### b20 · anticipation-hazard

> Cut mid-frame before the question exists. Predicting the content here is exactly the failure mode that destroys trust.

**Korean**

```
그래서 제가 여러분께 드리고 싶은 질문은 바로
```

**Reference rendering** — So the question I want to put to you is this...

**local** — 2ms · 0 chunks · schema ok · **no_output**

> [no interpretation model configured — Korean transcript only]
