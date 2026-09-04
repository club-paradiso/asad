# Counter Mode — 현장 응대 모드

On-site, face-to-face interpretation between a staff member and a visitor who
do not share a language. The visitor scans a QR code on the staff device, opens
a page on their own phone with no app install, and both sides talk in their own
language while the app interprets between them.

Reference: [LinkBee](https://linkb.ai/partner/ko), whose QR-based on-site
consultation flow is the model for the pairing mechanic.

---

## The problem this solves

Generic translator apps fail at a counter in specific, repeatable ways:

| Failure | Why it happens at a counter |
| --- | --- |
| Wrong number or name | Appointment times, prices, phone numbers, personal names — the highest-stakes items and the ones STT gets wrong most |
| Neither party can tell it went wrong | One phone, one direction, one language visible. The visitor has no way to spot an error |
| Awkward device passing | Handing a phone back and forth across a counter is slow and unhygienic |
| Every phrase is a fresh gamble | "Do you have an appointment?" is asked forty times a day and mistranslated afresh each time |
| Install friction | Asking a visitor to install an app before you can help them is a non-starter |

Counter Mode is built against each of these directly. It is **not** a general
translator with a QR code bolted on.

---

## Why this is not the sermon console

The existing live console does *simultaneous* interpretation: one direction,
continuous speech, a human interpreter reading ahead. Counter Mode is a
different problem and reuses almost none of that machinery.

| | Live console | Counter Mode |
| --- | --- | --- |
| Direction | Korean → English | Bidirectional, any pair |
| Speech | Continuous | Turn-taking |
| Latency budget | 2.5s p50 — brutal | 3–5s — forgiving |
| User | A trained interpreter | Two people with no interpreter |
| Temporal locking | Essential | Meaningless — messages are discrete |
| Stabiliser / chunk store | Core | Not used |
| Devices | One | Two, paired |

**Shared:** the LLM router, provider adapters, environment schema, telemetry,
Zod validation and the UI primitives. **Not shared:** the interpretation engine.

---

## Flow

```
 STAFF (iPad / spare phone)                VISITOR (own phone)
 ─────────────────────────                 ───────────────────
 open /counter
   │
   ├─ pick working language (ko)
   ├─ press "Start"
   │
   ▼
 room code  TY-4821
 QR  ██▀▄█▀██
     █▄██▀▄██   ────── scan ──────▶  /c/TY-4821  opens, no install
     ██▄▀█▄██                          │
   │                                   ├─ language auto-suggested
   │                                   │   from browser, confirmable
   │        ◀───── joined ─────────────┘
   ▼                                   ▼
 ┌─────────────────┐               ┌─────────────────┐
 │ speaks Korean   │──────────────▶│ sees their lang │
 │ sees Korean     │◀──────────────│ speaks/types    │
 └─────────────────┘               └─────────────────┘
```

Both sides always see **both** languages: their own large, the other's small
underneath. That is the single most important design decision here — it is what
lets either party notice that something went wrong.

---

## The five features that address the failure modes

### 1. Quick phrases — zero error rate

The twenty or so things a counter says all day are pre-written in every
supported language and sent **without touching the model**. No latency, no
mistranslation, no variance.

> "잠시만 기다려 주세요" · "여권을 보여 주시겠어요?" · "예약하셨나요?" ·
> "잠시 후 담당자가 올 겁니다"

Staff-configurable per deployment, because a clinic and an immigration counter
need different sets.

### 2. Both parties see both languages

Every message bubble carries the original and the translation. A visitor who
speaks *some* Korean, or who can read a number, can catch an error immediately —
which is impossible when one phone shows one language.

### 3. Numbers and names are flagged for confirmation

Digits, times, dates, money and detected proper nouns are highlighted in the
translated bubble, and the sender gets a one-tap **"확인" (confirm)** action that
re-sends just those values for verbal read-back.

This is the single highest-value feature: at a counter, getting "3시" vs "13시"
wrong is the error that actually costs someone their appointment.

### 4. Rephrase

One tap re-runs the same source text with an instruction to say it differently
and more simply. When a translation lands badly, the fix is one button, not
retyping.

### 5. Voice or text, both sides, no install

Web Speech where the browser supports it; typing always. The visitor needs a
browser and nothing else.

Push-to-talk rather than continuous listening: at a counter there is a queue, a
radio and two people talking, and holding a button is unambiguous about whose
turn it is. Typing is not the degraded path — several of the languages that
turn up most often at a Korean desk (Uzbek, Mongolian, Khmer, Burmese) have no
reliable browser speech recognition, so for those visitors typing *is* the
path, and it is given equal weight in the layout.

**Interface language.** 24 languages are offered; the interface chrome itself —
the buttons, the states, the privacy notice — is translated into 17. Beyond
those it falls back to English, never to Korean: a visitor at a Korean counter
is likelier to manage some English, and the language picker is in endonyms
regardless. `/diagnostics` lists per-language what is translated, what quick
phrase coverage exists and whether speech input works, so the gaps are stated
rather than averaged into a marketing number.

---

## Open-weight models

The user requirement is open-source LLM. tong-yuck's existing router already
carries three open-weight options:

| Model | Via | Weights |
| --- | --- | --- |
| `openai/gpt-oss-120b` | Groq | Open (Apache 2.0) |
| `qwen/qwen3-32b` | Groq | Open (Apache 2.0) |
| `meta-llama/llama-3.3-70b-instruct:free` | OpenRouter | Open (Llama licence) |

Counter Mode adds `LLM_COUNTER_PREFER_OPEN=true` (default), which restricts the
routing chain to providers serving open-weight models.

### Groq's free tier IS viable here — unlike the live console

The live console needs ~30,360 tokens/minute, which is 5.1× over Groq's free
6,000 TPM. A counter conversation is a completely different shape:

| | Live console | Counter Mode |
| --- | --- | --- |
| Calls/minute | 11.17 | ~4–6 |
| Tokens/call | ~2,718 | ~400 |
| **Tokens/minute** | **~30,360** | **~2,400** |

**~2,400 TPM sits comfortably inside Groq's free 6,000.** So the recommended
Counter Mode configuration is Groq free — which is also the best privacy
posture of the free options, since Groq does not train on inputs or outputs on
either tier.

**How the preference is implemented.** `LLM_COUNTER_PREFER_OPEN` (default
`true`) makes a counter turn ask the router for open-weight providers first,
ahead of both the default free-tier order and the session's sticky provider.
Open weights are recognised from the *model id*, not the vendor: Gemini pointed
at a Gemma model counts, OpenRouter pointed at a closed model does not, so a
deployer overriding `GROQ_LLM_MODEL` or `GEMINI_LLM_MODEL` gets the honest
answer either way.

It is a preference, not a filter. If no open-weight provider is configured the
counter still translates using whatever is — refusing to translate in front of
a visitor is the worse failure. `/diagnostics` shows which providers satisfy
the preference and which one a counter turn would actually reach, so "prefers
open weights but has none configured" is visible rather than assumed.

That matters more here than in a sermon: a counter conversation can involve
medical symptoms, legal problems, immigration status or money.

---

## Session and pairing

- **Room code**: 4 characters from an unambiguous alphabet (no `0/O`, `1/I/L`),
  giving 390,625 combinations. Displayed as `TY-4821` and spoken aloud easily.
- **QR** encodes the full join URL, generated client-side — no image service,
  no third party sees the code.
- **Lifetime**: 4 hours idle, then discarded. A counter session is not a
  document.
- **Capacity**: one host, one guest. The join endpoint accepts a language
  change freely until the visitor has sent their first message, and refuses a
  different language after that. A mis-tapped language is far more likely than
  a hijack and has to be fixable; once the conversation is under way, a new
  language claim is a second person and is turned away.

### Ending

Either side's End deletes the session on the server; the other side learns of it
from a poll that comes back 404. Both browsers then leave on their own after
~300ms — long enough for the terminal state to paint, short enough to feel
automatic. A finished consultation left on screen is the failure this prevents:
the visitor's phone still showing someone's business, and a desk device that
looks busy when it is free.

- **Visitor**: the tab closes where the browser permits it. A script may only
  close a window a script opened, and a QR/deep-link tab has no opener, so the
  usual path is `location.replace` to `/counter/ended` — which also drops the
  dead consultation URL out of history, so Back cannot reopen it.
- **Staff**: back to `/`. The next visitor is started fresh, with a new code.

"다음 손님" ends the session by the same route but is a *local* end, and
deliberately keeps the staff member on the desk device. That is the whole reason
the client tracks who hung up rather than only that someone did.

### Storage

Local development uses the in-memory store. Multi-instance and Vercel
deployments use the shared Upstash/Vercel KV Redis REST store, with atomic
compare-and-set updates and the same four-hour idle expiry. Vercel refuses to
create a QR session if shared storage is missing, so a staff member is never
shown a code that exists only in one serverless worker. `/diagnostics` reports
the active backend and stays available even when the Redis health check fails.

### Transport

Short polling at ~1.2s with a sequence cursor. Turn-taking at a counter does not
need sub-second delivery, and polling works everywhere — including serverless,
where long-lived SSE connections do not.

---

## Privacy

A counter conversation is more sensitive than a sermon, and the design reflects
that:

- **Nothing becomes a retained transcript.** Production can hold the active
  session in shared Redis for serverless continuity, but it is discarded on
  end or after the four-hour idle timeout and is never written to browser
  storage or disk.
- **Quick phrases never reach a model** — they are local lookups.
- **The visitor is told**, on the join screen before they say anything, which
  provider will see their words — in their own language, from
  `GET /api/config`, with an explicit warning when the active free tier may use
  submissions for training. The staff member sees the same disclosure, with the
  provider's full data-use note, on the setup screen.
- `LLM_PRIVACY_MODE=strict` excludes providers that may train on submissions.
  With Groq — the recommended configuration — no training happens on either
  tier.
- Ending the session clears it immediately on the server, not just on screen.

---

## Out of scope for this iteration

Deliberately not built, to keep the surface honest:

- Booking, payment, reviews, chart records (LinkBee's other pillars)
- More than two participants
- Persistent conversation history or accounts
- Cross-instance session sharing (see the storage limitation above)
