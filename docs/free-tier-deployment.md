# Running tong-yuck for free

A genuinely zero-cost live configuration: browser speech recognition, a
free-tier interpretation model, and reference-only Scripture. No paid API
anywhere in the path.

This is **not** demo mode. It is real live interpretation from a real
microphone.

---

## Setup

### 1. Get a free Gemini API key

From Google AI Studio. No credit card is required for the free tier.

### 2. Configure

`.env.local`:

```bash
STT_PROVIDER=webspeech
LLM_ROUTING_MODE=auto-free
GEMINI_API_KEY=your-free-key
BIBLE_PROVIDER=reference-only
```

### 3. Run

```bash
npm install
npm run dev
```

Open the console in **Chrome**, choose **Sermon**, pick **Browser** as the
audio source, and press Start.

### 4. Check it

Visit `/diagnostics`. You should see:

```
Mode              auto-free
Paid fallback     blocked
Active provider   gemini
Fallback chain    gemini → local
```

---

## What it costs

| | |
| --- | --- |
| Speech recognition | **$0** — runs in the browser |
| Interpretation | **$0** — Gemini free tier |
| Scripture | **$0** — no network call at all |
| Hosting | **$0** on a Vercel hobby plan at personal-project scale |

---

## The privacy tradeoff — read this before a real service

**Gemini's free tier may use your prompts and responses to improve Google
products, including human review.** The paid tier does not.

For tong-yuck that means the Korean transcript and the English assistance —
which in a sermon can include testimonies, prayer requests, names and pastoral
information — may be retained and reviewed.

The app shows this once, in-app, before your first live cloud session. It is
repeated here because it is the single most important thing about this
configuration.

### If that is not acceptable

Three real alternatives, in increasing order of cost:

**Local only — $0, nothing leaves the device**

```bash
LLM_ROUTING_MODE=local
```

Scripture normalisation, terminology matching and wordplay detection all still
work; they run locally and always did. What you lose is translated English —
assistance becomes rule-based.

**Exclude providers that train on free submissions — $0**

```bash
LLM_PRIVACY_MODE=strict
GROQ_API_KEY=your-free-key
```

Groq does not train on inputs or outputs on either tier. But see the quota
warning below: its free tier cannot sustain a full sermon.

**Pay a little — the honest recommendation for real pastoral content**

```bash
LLM_ROUTING_MODE=pinned
LLM_PROVIDER=groq
GROQ_API_KEY=your-key      # Developer tier
```

Groq's paid tier lifts the token limit to 250k+/min, keeps the no-training
posture, and is the fastest of the candidates.

---

## Quota: what "free" actually sustains

Measured workload: **11.17 interpretation calls per minute at ~2,718 tokens
each**, or about **30,360 tokens per minute**. A 45-minute sermon is ~503 calls.

| Provider | Free-tier verdict |
| --- | --- |
| **Gemini 3.5 Flash-Lite** | **Works.** ~90 min/day — about two sermons |
| Groq free | **Does not work.** 6,000 TPM cap; needs 5.1× that |
| OpenRouter `:free` unfunded | **Does not work.** 50 requests/day ≈ 4 minutes |

tong-yuck knows these limits. If you configure Groq on the free tier it will
automatically use a compact context, warn on `/diagnostics` that the quota is
insufficient, and fall back to the local interpreter rather than looping on
429s. It will not pretend the configuration works.

### After the daily quota runs out

The console does not stop. Gemini goes into cooldown, the router falls through
to the local interpreter, and the status pill shows `AI LOCAL`. The Korean
transcript, Scripture detection, terminology and wordplay all keep working —
they never needed the model.

---

## Browser support for Web Speech

The zero-cost STT path depends on the browser, and support is genuinely uneven.

| Browser | Korean recognition | Notes |
| --- | --- | --- |
| **Desktop Chrome** | Good | The recommended zero-cost setup |
| **Edge** | Good | Same engine |
| Desktop Safari | Partial | Works, less reliable on long sessions |
| **iOS Safari** | Unreliable | Stops when backgrounded or the screen locks |
| Firefox | Not supported | No `SpeechRecognition` |

Two behaviours to know about:

**It stops on silence.** Browsers end recognition after a pause. tong-yuck
restarts it automatically, but a phrase spoken during the restart window can be
lost. Cloud providers do not have this problem.

**Audio still leaves the browser.** Web Speech looks the most private because
there is no key, but the browser sends audio to its own speech service — in
Chrome, generally Google's. This is outside the application's control. If that
matters, use Deepgram with a key you control, or demo mode.

Check what your browser actually supports at `/diagnostics` under **Browser
capability**.

---

## Upgrading later

Nothing in the free setup has to be undone.

```bash
# Better speech recognition, still free interpretation
STT_PROVIDER=deepgram
DEEPGRAM_API_KEY=...
DEEPGRAM_PROJECT_ID=...     # so the browser only gets a short-lived key

# Free-first, but allowed to fall back to a paid provider if free fails
LLM_ROUTING_MODE=auto-free
LLM_ALLOW_PAID_FALLBACK=true
ANTHROPIC_API_KEY=...
```

`auto-free` never spends money unless `LLM_ALLOW_PAID_FALLBACK` is explicitly
set. A free tier hiccuping cannot start charging you.

---

## Verifying a zero-cost deployment

```bash
npm run smoke:llm      # confirms the provider answers with valid structure
npm run bench:live -- --minutes 5   # measures real latency through the engine
```

Then in the console, say:

> 우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.

You should see the Korean transcript, English assistance, and `1 Peter 2:9` in
the context rail — with no paid API involved.

---

## Recovering from a Vercel Hobby build limit

Vercel can reject a Git deployment before a build starts when the Hobby plan's
rolling build limit is exhausted. That failure is attached to the commit and is
not proof that the application failed to build.

When this happens:

1. Compare the SHA of GitHub `main` with the SHA of the latest Vercel deployment
   whose target is `production`.
2. Confirm the same code has a successful Preview deployment or green CI before
   retriggering production.
3. After the rolling limit clears, create one meaningful `main` push or use a
   production redeploy. Do not repeatedly push empty commits while the limit is
   still active, because every accepted Preview build consumes more of the same
   allowance.
4. Verify the resulting production deployment is `READY`, then check
   `/api/config` and `/api/diagnostics` rather than assuming a green Git status
   means the live aliases moved.

This recovery procedure matters because a failed Vercel commit status does not
magically retry itself when the rolling limit later expires. Humans apparently
needed a distributed deployment platform to reinvent the concept of taking a
number and waiting for the counter to call it.