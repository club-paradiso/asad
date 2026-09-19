# Multilingual code-switching, across writing systems

PR #135 fixed code-switching for the pair it was reported against: Korean with
English inside it. This is the follow-up that removes "Korean with English
inside it" as an assumption — and, in doing so, states plainly what a character
can and cannot prove about a language.

---

## 1. The assumption that was left behind

The layer PR #135 added read a unit as "source script" versus "guest script",
and *guest script* was spelled `[A-Za-zÀ-ɏ]`.

That range stops at Latin Extended-B. Vietnamese is written past it:

| character | in `[A-Za-zÀ-ɏ]`? |
| --- | --- |
| `v`, `ô`, `n`, `x` | yes |
| `ố` in `vốn`, `ộ` in `hội`, `ế`, `ữ` | **no** |

So `vốn xã hội` was half Latin and half nothing, and the run that should have
been preserved whole was cut into pieces at every toned vowel. The same shape of
bug applied everywhere the guest was not English: a Cyrillic, Arabic, Devanagari
or Thai span inside a Korean sentence was not "guest", it was invisible, and
the extraction that feeds the model's *Preserve exactly:* list
(`src/interpreter/prompts/live.ts`) and the recogniser's keyterms
(`src/interpreter/glossary/stt-hints.ts`) returned nothing for it.

The whole module is now written in Unicode properties rather than ranges:

```ts
const LATIN     = /\p{Script=Latin}/u;   // includes every Vietnamese tone mark
const DECIDABLE = /\p{L}/u;              // letters settle a script; digits do not
const RUN_CHAR  = /[\p{L}\p{M}\p{N}]/u;  // marks travel with their base letter
```

`\p{M}` in `RUN_CHAR` is what makes the module grapheme-safe by construction: a
Devanagari matra or an Arabic vowel mark is never classified on its own, so it
can never be separated from the consonant that opened its syllable.

---

## 2. Script detection is not language detection

This is the load-bearing distinction, and the module is built to refuse the
inference rather than to make it carefully:

| block | languages that use it |
| --- | --- |
| Latin | English, Vietnamese, Indonesian, Spanish, French, German, Portuguese, Turkish, Tagalog, Uzbek |
| Cyrillic | Russian, Ukrainian, **Mongolian** |
| Arabic | Arabic, Urdu, **Uyghur** |
| Han | Chinese (Simplified), Chinese (Traditional), and half of Japanese |
| Devanagari | Hindi, Nepali |

A Cyrillic span is not Russian because it is Cyrillic. A Latin span is not
English because it is Latin.

So `analyseCodeSwitch` does not ask "what language is this?". It asks the much
smaller question **"given that this session interprets A into B, is this run A,
B, or neither?"** — which characters can genuinely answer whenever A and B are
written differently, and cannot answer at all when they are not.

### The pair, not the character, decides

`pairIsScriptDecidable(source, target)` returns false for every pair that shares
a block, and every consumer treats that as *no opinion*:

| pair | decidable | why |
| --- | --- | --- |
| ko-KR ↔ en-US | yes | Hangul vs Latin |
| ko-KR ↔ th-TH | yes | Hangul vs Thai |
| mn-MN ↔ en-US | yes | Cyrillic vs Latin |
| en-US ↔ vi-VN | **no** | both Latin |
| en-US ↔ id-ID | **no** | both Latin |
| ru-RU ↔ mn-MN | **no** | both Cyrillic |
| ru-RU ↔ uk-UA | **no** | both Cyrillic |
| ar-SA ↔ ur-PK | **no** | both Arabic |
| zh-CN ↔ zh-TW | **no** | both Han, and the same base language |

The check is reference equality on the registry's shared `scriptPattern`
objects — `zh-CN` and `zh-TW` hold the *same* RegExp instance, as do `ru`, `uk`
and `mn` — so there is no second table to drift out of step with the first.

### What an undecidable pair still gets

Not nothing. Script-independent evidence survives, because a label is a label in
any language:

```
"Chúng tôi dùng GPT-4 và nhận HTTP 403 từ API."   →  ["GPT-4", "HTTP 403", "API"]
"We should ship the retention fix."               →  []
```

The second line is the point. In an English↔Spanish session an ordinary English
sentence is not a code switch, and a module that reported the whole thing as a
foreign span would be inventing the language identity this one exists to refuse.

### What an undecidable pair never gets

Target-language passthrough. `isAlreadyTargetLanguage` returns false outright
for an undecidable pair: passing *source* speech through untranslated is a far
worse failure than translating a quotation twice, and there is no character
evidence that would justify the risk.

### A third script is preserved, never classified

A run in a script belonging to neither side sets `unexpectedScript` and is kept
verbatim. It is counted in `LaneStats.unexpectedScriptTurns` so an operator can
see it happened; it is never given a language.

---

## 3. What each recogniser is actually asked for

Declared from the language registry, not inferred from a tag's shape.
`src/providers/stt/language-pairs.test.ts` pins all sixteen first-class pairs.

### Deepgram

Nova-3's multilingual model covers **ten** languages: `en es fr de hi ru pt ja
it nl`. Korean is not among them. Korean *is* a strong monolingual Nova-3 model,
so every Korean pair stays on `language=ko-KR` and leans on keyterm prompting —
which works on monolingual and multilingual streams alike.

| pair | `language` sent | code-switch support |
| --- | --- | --- |
| ko-KR + anything | `ko-KR` | none |
| ja-JP + en-US | `multi` | multi-model |
| ru-RU + en-US | `multi` | multi-model |
| mn-MN + en-US | `mn` | none — Mongolian is Cyrillic, but it is not Russian |
| vi-VN + en-US | `vi` | none |
| id-ID + en-US | `id` | none |

`multi` is requested only when the registry says Deepgram covers **both** sides.
Claiming it for a Korean pair would be inventing a capability and the socket
would be refused mid-service.

### OpenAI

Two request shapes, selected from an explicit model list rather than a substring
test:

| family | models | fields |
| --- | --- | --- |
| `gpt-transcribe` | `gpt-transcribe`, `gpt-live-transcribe` | `languages[]`, `keywords[]`, `prompt` |
| `whisper` | `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, and anything unrecognised | `language`, `prompt` |
| `whisper`, VAD-less | `gpt-realtime-whisper` | `language` only |

An unrecognised model resolves to the whisper family deliberately: `language` +
`prompt` is the older and more widely accepted contract, so it is the safer
thing to send at a model whose capabilities cannot be looked up. `/diagnostics`
reports which family a configured model resolved to, so the choice is visible
rather than silent.

`language` and `languages` are never sent together — OpenAI's migration guidance
is explicit that they must not be — and `keywords` is never sent to a model that
has no such field.

### Web Speech

One `lang`, one acoustic model, no second language. Everything foreign is forced
through the declared language's phonology, which is why the alternative picker
and the terminology hints are the only defence on this path, and why both were
generalised rather than left Latin-only.

---

## 4. A finding: the OpenAI realtime path was on the beta interface

Worth reading even if nothing else here is, because it means the multilingual
hint could have been built perfectly and still never reached the vendor.

The socket negotiated three subprotocols, the third being
`openai-beta.realtime-v1`, and the token was minted at
`POST /v1/realtime/transcription_sessions` with an `OpenAI-Beta: realtime=v1`
header. Both are the **beta** realtime interface.

Verified against OpenAI's own published types (`openai` on npm, **7.18.0**,
which is generated from their OpenAPI spec):

| | beta (`resources/beta/realtime/realtime.d.ts`) | GA (`resources/realtime/realtime.d.ts`) |
| --- | --- | --- |
| transcription fields | `language`, `model`, `prompt` | `language`, `languages`, `keywords`, `prompt`, `delay` |
| documented models | `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `whisper-1` | those plus `gpt-transcribe`, `gpt-live-transcribe`, `gpt-realtime-whisper`, … |
| subprotocols | `realtime`, `openai-insecure-api-key.…`, `openai-beta.realtime-v1` | `realtime`, `openai-insecure-api-key.…` |
| client secret | `POST /realtime/transcription_sessions` | `POST /realtime/client_secrets` |

Two consequences, neither of which depends on any deprecation claim:

1. `languages` and `keywords` **do not exist** on the beta interface. The field
   that says "this recording contains more than one language" — the entire point
   of this work for OpenAI sessions — is GA-only.
2. This deployment's default model, `gpt-live-transcribe`, is **not listed** by
   the beta interface at all.

So the OpenAI path moved to GA:

* subprotocols are now `["realtime", "openai-insecure-api-key.<token>"]`;
* the client secret is minted at `/v1/realtime/client_secrets` with no beta
  header, and the session configuration nested the way GA nests it —
  `session.audio.input`, with the PCM format as `{ type: "audio/pcm", rate:
  24000 }` rather than the old top-level `"pcm16"` string;
* the response's token is read from `value` rather than `client_secret.value`.

The websocket's own `transcription_session.update` event **keeps its flat field
names** (`input_audio_format`, `input_audio_transcription`, `turn_detection`),
because that event is specified flat on GA too. The create request nests and the
update event does not; both shapes are GA, they are simply different objects.
`src/providers/stt/language-pairs.test.ts` asserts each one separately so the
two cannot be conflated again.

One more thing the same types settled: `gpt-realtime-whisper` documents that
`prompt` is not supported and that turn detection must be null because it does
no VAD. Neither is now sent for that model, rather than sent and hoped over.

---

## 5. What was measured, and what was not

**Checked here:** 1,484 unit tests across 128 files, including a 78-case
multilingual matrix (`src/lib/code-switch-languages.test.ts`) and a 97-case
provider-contract matrix (`src/providers/stt/language-pairs.test.ts`); lint;
typecheck; a production build; and the five end-to-end suites
(`e2e`, `e2e:live-languages`, `e2e:live-two-lane`, `e2e:live-failure`,
`e2e:live-fallback`) — 44 + 11 + 16 + 14 + 7 checks, all passing.

**Not checked here, and it matters:**

* **No request was made to OpenAI.** This environment holds no OpenAI
  credentials and `platform.openai.com` and `developers.openai.com` are both
  blocked by the network egress proxy. The GA migration in §4 is derived
  entirely from OpenAI's own published TypeScript definitions, which are
  generated from their OpenAPI spec and are the best first-party source
  reachable from here — but a generated type is not a live 200. **The first
  deployment with an OpenAI STT key configured should check `/diagnostics` and
  confirm a session opens.** The fallback ladder (Deepgram → OpenAI → Web Speech
  → Hugging Face) means a wrong guess degrades rather than breaks, but it would
  degrade silently.
* **No request was made to Deepgram.** Its multilingual coverage is recorded in
  the registry from published documentation, not probed.
* **No claim is made about recognition accuracy.** Everything here is about what
  the product *asks for*. Whether asking correctly produces a better transcript
  is a question for a real service with real audio, and nothing in this
  repository can answer it.

The end-to-end language suite says so itself, on every run: *"window.Translator
and SpeechRecognition are mocked. This checks what ASAD asks for, not what any
vendor delivers."*
