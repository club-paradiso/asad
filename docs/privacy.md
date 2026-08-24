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

With `LLM_PROVIDER=mock` (the default) **no text leaves the device at all** —
Scripture normalisation, terminology and wordplay detection all run locally.

With a real provider, each call sends only the bounded rolling window:

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

## Vendor retention

tong-yuck cannot control what a third party does with data you send it, and it
will not pretend otherwise. As of writing, in broad terms:

- **Deepgram** does not retain audio or transcripts by default on pay-as-you-go
  plans; opt-in retention exists for model improvement.
- **OpenAI** API data is not used for training by default; a limited retention
  window applies for abuse monitoring, with zero-retention available to
  eligible accounts.
- **Anthropic** API data is not used for training by default, with a similar
  limited abuse-monitoring window.

**Verify these against each vendor's current terms before handling anything
sensitive.** They change, and the summary above is not a contract. If a session
must not leave the room, use demo mode or run without a cloud provider.

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

There is none. No analytics, no error reporting, no beacons. The only network
requests tong-yuck makes are the ones described above.

---

## If you are interpreting something sensitive

1. Use **demo mode** to rehearse — it is fully offline.
2. For a live session, prefer a provider whose terms you have read, and set
   `DEEPGRAM_PROJECT_ID` so the browser only ever holds a scoped, expiring key.
3. Leave **"Save this session" off**.
4. Tell the people in the room. An interpreter using an AI aid should say so —
   that is a professional obligation this software cannot discharge for you.
