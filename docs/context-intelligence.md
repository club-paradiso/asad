# Context intelligence and the language registry

Two things used to be asked of the user before a word was spoken, and neither
should have been.

---

## 1. "Sermon Mode or General Mode?"

`InterpretationMode = "sermon" | "general"` was chosen on the launcher, stored
in settings, sent on the wire, and forked eleven places: the prompts, the
glossary lexicon, the community glossary, the recogniser's keyterm hints, the
demo script, rescue availability, the booth-preflight readiness row, the prep
brief, the prep prompt, the stored-session record and the sessions list.

It was also the wrong shape of question. It had to be answered before anyone
had spoken, it could not be revised without discarding in-flight work, and a
wrong answer stayed wrong for the whole service.

### What replaced it

```
ContextMode       what the USER may say
  auto | worship | lecture | meeting | conversation | event

ResolvedContext   what the SYSTEM decided, and what every consumer reads
  worship | lecture | meeting | conversation | event | generic
```

The default is `auto`. The expected case is that nobody ever touches it.

`ContextResolver` (`src/interpreter/context/context-mode.ts`) combines six
signal families. None is trusted alone:

| family | what it is | where it comes from |
| --- | --- | --- |
| structure | Scripture references resolved by the detector | `scripture/detect.ts`, already running |
| terminology | how densely the domain lexicons match | `glossary/matcher.ts`, already running |
| discourse | the rhetorical shape — address to a room, an agenda, question-and-answer | pattern families, Korean and English |
| metadata | the prep sheet: a venue, a title, a named passage | available at second zero |
| model | the interpretation model's own read of the setting | the `context` field of a response the turn already paid for |
| incumbency | what the session already decided | a switch margin, so context does not flicker |

Two properties are load-bearing:

**Inference is free.** The model's vote rides a response the turn was going to
send anyway. No extra call is ever made to decide the context, and
`context-and-terminology.test.ts` asserts the call count.

**Automatic resolution never invalidates work.** A USER override changes the
contract every in-flight request was built on, so it aborts and restores them.
A gradual refinement does not: throwing away a request that is about to answer,
in order to re-ask it with a slightly different domain paragraph, would cost
the interpreter a real sentence to buy a marginally better one. The new context
applies from the next turn, which is the next few seconds.

### Cost

Unifying six contexts onto one shared core cost about 1–3% of the system
prompt, measured with `npm run measure:prompt`:

| prompt (schema-enforced) | before | after |
| --- | --- | --- |
| sermon / worship, full | 1,077 tokens | 1,095 |
| general / generic, full | 726 | 727 |
| sermon / worship, ultra-compact | 580 | 600 |
| general / generic, ultra-compact | 469 | 481 |

The four new contexts land between those two. 52% of the worship prompt is the
byte-identical core shared by every context, so a provider's prompt cache sees
the same prefix whichever way a session resolves.

---

## 2. "Korean into English, and nothing else"

Live Interpretation was hardcoded end to end: `"ko-KR"` passed to the recogniser,
`ko`→`en` passed to Chrome's translator, "Korean into English" written into
every prompt, and no language fields on the wire at all. The twenty-five
advertised languages existed only in Counter Mode.

The root cause was not the pipeline — it was that the language registry lived
under `counter/`, so nothing above it could use it.

### The registry

`src/lib/languages.ts` is now the single authority. One record per language:

```
id            canonical BCP-47 tag; the key everything else uses
base          ISO-639 subtag, for providers that accept nothing finer
script        ISO-15924 code
scriptVariant true when the tag's MEANING depends on the script subtag
spaced        whether the writing system separates words with spaces
direction     ltr / rtl
stt           what each recogniser family calls it, and how well it serves it
translator    Chrome's on-device Translator code, or null
capabilities  where this language may legitimately be offered
```

`counter/languages.ts`, `providers/stt/language.ts`,
`providers/stt/capability.ts` and `providers/stt/transcript.ts` are all views of
it. A language cannot now be offered in a picker and simultaneously be missing
from a recogniser map.

### The Chinese failure it fixes

Whisper's transcription API selects a **language**, never a **script**. It takes
`zh`. So a visitor who chose 中文（繁體）:

1. had `zh-TW` sent as `zh`;
2. was transcribed in Simplified characters;
3. and the system reported success.

`sttLanguageSupport("openai", "zh-TW")` said `native`, which was not true.

The fix is stated once and applies generally, because the cause is general —
"the tag carries a distinction the provider's API cannot express":

- the registry declares that coverage as `variant-lossy`;
- `counterSpeechPlan` sinks any script-losing path below one that preserves the
  script, so an OpenAI-only deployment routes Traditional Chinese to the browser
  recogniser instead;
- `/api/stt/token` sends the registry's code and returns `scriptFidelity` when
  it is lossy, and the console says so rather than staying quiet;
- the prompt states the target script explicitly, because a model asked for
  "Chinese" produces Simplified.

`src/lib/languages.test.ts` pins every step of that.

### What a live session now carries

```
source: "ko-KR"   target: "zh-TW"
   │                  │
   ├── recogniser locale, via the registry
   ├── Chrome Translator pair, via the registry (never guessed from the base tag)
   ├── the prompt's opening line, structure block and name-handling rule
   ├── the target-script directive
   └── the wire: interpretRequestSchema.source / .target
```

An unsupported pair is refused on the launcher — a disabled Start and a
readiness row that says why — rather than discovered after the microphone opens.
