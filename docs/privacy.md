# Privacy

Sermons contain pastoral confidences. Meetings contain commercial ones.
Immigration counters contain the most sensitive material any of these tools
will ever touch. This document states exactly what tong-yuck does with audio
and text — including what it cannot promise.

**Default posture: minimal retention.** Nothing is stored unless you turn it
on, and nothing leaves the device unless you configured a cloud provider.

---

## The short version

| | Demo mode | Browser mode | Cloud mode |
| --- | --- | --- | --- |
| Audio captured | none | yes | yes |
| Audio leaves the device | no | to the browser's speech service | to the STT vendor |
| Text leaves the device | no | no | to the LLM vendor |
| Network required | **no** | maybe (browser-dependent) | yes |
| API key required | no | no | yes |
| Stored afterwards | nothing | nothing unless you opt in | nothing unless you opt in |

Demo mode is fully offline. That is not a limitation — it is the mode to use
for a demonstration, a rehearsal, or any session you would rather not put on
someone else's network.

---

## Audio

**Raw audio is never stored, never uploaded as a file, and never exported.**

- Captured through `getUserMedia` only after the browser's permission prompt.
- Converted to 16 kHz mono PCM16 in ~50 ms frames and streamed.
- Frames are held in memory only: at most ~10 seconds are buffered, and only to
  survive a socket reconnect.
- Nothing is written to disk. Ending the session releases the microphone
  (`MediaStream` tracks stopped, `AudioContext` closed).

The microphone is only opened by a provider that needs it. Demo mode never
requests permission at all.

---

## What leaves the device, by provider

### Speech to text

| Provider | What is sent | Where |
| --- | --- | --- |
| `demo` | **nothing** | — |
| `webspeech` | audio | The browser's own speech service. In Chrome this generally means Google's servers; the browser controls this and tong-yuck cannot see or change it |
| `deepgram` | audio frames, plus terminology hints from your prep sheet | Deepgram |
| `openai` | audio frames (base64 PCM16), plus terminology hints | OpenAI |

`webspeech` deserves the caveat: it looks the most private because there is no
key, but the audio still goes wherever the browser sends it, and that is
outside this application's control. If a session is sensitive, use `demo` or a
provider whose retention terms you have actually read.

### Interpretation

With `LLM_ROUTING_MODE=local` **no text leaves the device at all** — Scripture
normalisation, terminology and wordplay detection all run locally, and always
did.

With a cloud provider, each call sends only the bounded rolling window:

- the Korean just stabilised, and the unresolved tail when predicting;
- up to ~900 characters of recent Korean and ~700 of recent English;
- a ≤700-character compressed summary of everything older;
- the session glossary, resolved names, Scripture seen, and your corrections;
- anything you typed into the prep sheet.

The full transcript is **never** sent. The bound is enforced in
`interpreter/context/rolling.ts` and asserted in its tests.

### Scripture

- `reference-only` (default): no network call, ever.
- `public-domain`: the reference string (e.g. `1 Peter 2:9`) is sent to
  bible-api.com. No session content.
- `api-bible`: the reference string is sent to scripture.api.bible.

---

## API keys

Keys are **server-side only**. They are read from the environment inside route
handlers and are never included in the client bundle.

- `/api/stt/token` mints a short-lived credential for the browser: a Deepgram
  temporary key (90 minutes, `usage:write` scope only) or an OpenAI ephemeral
  session token.
- **Caveat, stated plainly:** minting a Deepgram temporary key requires
  `DEEPGRAM_PROJECT_ID` and a key with key-management scope. Without it, the
  route falls back to passing the configured key through, and the response is
  marked `ephemeral: false`. That fallback exists so a misconfiguration does
  not kill a service in progress — but it does mean the key reaches the
  browser. Set `DEEPGRAM_PROJECT_ID` in any deployment you care about.
- `/api/interpret` and `/api/prep` proxy the LLM; that key never leaves the
  server.
- `/api/config` returns capability booleans only — no keys, ids or endpoints.

---

## Vendor retention — including the free tiers

tong-yuck cannot control what a third party does with data you send it, and it
will not pretend otherwise. Verified against provider documentation on
**2026-08-24**:

| Provider | Free tier | Paid tier |
| --- | --- | --- |
| **Gemini** | **May be used to improve Google products, including human review** | Not used for training |
| **Groq** | **Does not train** on inputs or outputs. Short abuse/reliability logs; zero-data-retention available self-serve | Same |
| **OpenRouter** | Does not store prompts by default, but forwards them to a downstream provider whose own policy then applies. Account settings control routing to training-capable providers | Same |
| **OpenAI** | n/a — no free tier | Not used for training by default; limited abuse-monitoring retention |
| **Anthropic** | n/a — no free tier | Not used for training by default; limited abuse-monitoring window |
| **Deepgram** | n/a | Does not retain audio or transcripts by default on pay-as-you-go |

### Free inference is not free of consequences

This is the single most important thing on this page.

**Gemini's free tier — the default `auto-free` provider — may use your prompts
and responses to improve Google products, and that includes human review.** For
tong-yuck the prompt contains the Korean transcript and the English assistance.
In a sermon that can mean testimonies, prayer requests, names and pastoral
information.

Because of that, tong-yuck:

- **shows a one-time in-app disclosure** before the first live cloud session,
  naming the actual configured provider, with local-only mode offered as a real
  alternative. It appears once per browser, not every session — interrupting
  every service would train people to dismiss it unread;
- provides **`LLM_PRIVACY_MODE=strict`**, which excludes providers that may
  train on free-tier submissions from the routing chain entirely;
- provides **`LLM_ROUTING_MODE=local`**, which sends nothing anywhere;
- **never silently escalates to a paid provider**: `auto-free` degrades to the
  local interpreter unless `LLM_ALLOW_PAID_FALLBACK` is explicitly set.

There is a genuine tension here and no configuration resolves it for free:
Gemini has the quota to run a sermon but trains on the data; Groq protects the
data but its free tier cannot sustain the workload. See
[`free-tier-deployment.md`](./free-tier-deployment.md) for the options.

**Verify these against each vendor's current terms before handling anything
sensitive.** They change, and the summary above is not a contract. If a session
must not leave the room, use `LLM_ROUTING_MODE=local` or demo mode.

---

## What is stored locally

In `localStorage`, in your browser, on your device:

| Key | Contents | When |
| --- | --- | --- |
| `tong-yuck:settings` | mode, lag, view, font scale, toggles | always |
| `tong-yuck:prep` | your prep sheet and session glossary | as you type |
| `tong-yuck:sessions` | finished session transcripts | **only when you turn on "Save this session"** |

"Save this session" is **off by default** and must be switched on before the
session ends. Nothing is written silently.

A saved session contains the Korean transcript, the English assistance,
timestamps, Scripture, terminology, cultural notes and your corrections. It
contains **no audio**.

Sessions are capped at the 30 most recent. Delete any of them, or all of them,
from `/sessions`. Clearing site data deletes everything permanently — there is
no backup, because nothing is uploaded.

---

## Export

Exports (TXT / Markdown / JSON) are generated in the browser and downloaded
directly. They are never sent anywhere. They contain the same fields as a saved
session, and no audio — asserted in `src/lib/export.test.ts`.

---

## Service worker

The service worker caches the application shell so demo mode works offline. It
**never** caches `/api/*`: interpretation, Scripture lookup and STT tokens are
always live. A stale interpretation would be worse than none.

---

## Telemetry

There is no analytics, no error reporting and no beacons. The only network
requests tong-yuck makes are the ones described above.

Phase 2 added **in-process latency and token measurement**, surfaced on
`/diagnostics`. It records durations, token counts, provider ids and failure
kinds. It **never** records transcript content — that is a hard rule enforced
at the type level in `src/lib/telemetry.ts`, not a convention. Nothing is
transmitted anywhere; the numbers live in memory and disappear on restart.

The `/api/diagnostics` payload reports credential state as booleans only. There
is no code path in it that can emit a key, a partial key, or a fingerprint of
one.

---

## If you are interpreting something sensitive

1. Use **demo mode** to rehearse — it is fully offline.
2. For a live session, prefer a provider whose terms you have read, and set
   `DEEPGRAM_PROJECT_ID` so the browser only ever holds a scoped, expiring key.
3. Leave **"Save this session" off**.
4. Tell the people in the room. An interpreter using an AI aid should say so —
   that is a professional obligation this software cannot discharge for you.
