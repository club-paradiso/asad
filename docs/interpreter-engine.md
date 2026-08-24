# The interpretation engine

This document explains the parts of tong-yuck that are not obvious from the
code: *why* the timing works the way it does, and which failure modes each
mechanism exists to prevent.

---

## The failure this product is designed against

> Korean speech → translated English subtitles

That already exists, and it is close to useless in a booth. Subtitles assume a
reader who can go at their own pace. A simultaneous interpreter cannot: they
are two to five seconds behind the speaker, already talking, and their eyes get
one fixation per line.

So the engine's job is not "translate accurately". It is:

> produce the shortest, safest, most contextually accurate piece of English
> that helps this human say their next phrase.

---

## Temporal locking

**The single hardest constraint.** A streaming system that rewrites earlier
text is unusable, because the interpreter's mouth is already past it. Correcting
a line they have already said out loud does not help them — it just tells them
they were wrong, three seconds too late, while they are trying to listen.

So chunks move one way only:

```
anticipated ──▶ current ──▶ committed
                                │
                                └─▶ never edited; a serious fix is
                                    appended as a discreet correction
```

- **anticipated** — a prediction. Dimmed, dashed rule, `◦` marker. It must
  never read as confirmed speech.
- **current** — supported by stable Korean, still editable, amber rule in the
  margin. This is the line the eye should land on.
- **committed** — the interpreter has probably said it. Immutable. Dimmed to
  52% so it stays available as context without competing.

A chunk locks after the lag profile's `commitDwellMs`, or immediately when new
confirmed English arrives (which means the interpreter has moved past it).
`appendCorrection` adds a new `↺` line rather than mutating the original,
because the screen must keep matching the interpreter's memory of what they
said.

---

## Lag profiles

The interpreter chooses how far behind the speaker to run, and that one choice
has to propagate through the whole pipeline. It lives in one table
(`engine/lag.ts`) rather than as scattered constants.

| | Fast (~1s) | Balanced (~2–3s) | Safe (~4–6s) |
| --- | --- | --- | --- |
| Stabilise window | 350 ms | 900 ms | 1800 ms |
| Min trigger length | 6 chars | 10 chars | 16 chars |
| Hold ceiling | 1.0 s | 2.6 s | 5.2 s |
| Commit dwell | 1.2 s | 2.6 s | 5.0 s |
| Anticipation | aggressive | conservative | **off** |

Balanced is the default. Safe turns prediction off entirely: at five seconds
behind, the Korean has usually resolved, so guessing buys nothing and costs
retractions.

---

## When to interpret

`engine/stabiliser.ts` decides the moment. A flush happens when **any** of:

1. **sentence** — the pending Korean ends on a sentence-final ending
   (`다/요/까/죠/습니다/…`) and is long enough. The clean case.
2. **quiet** — the recogniser has been silent for the profile's stabilise
   window.
3. **timeout** — the pending Korean has waited past the hold ceiling.
4. **clause** — a connective ending (`고/며/지만/는데/…`) with a buffer at least
   twice the trigger length.

(3) is what keeps a preacher who never pauses from starving the pipeline. It
also matters for *what* is emitted: a `timeout` flush is a mid-thought cut and
gets more conservative treatment than a clean `sentence` flush.

---

## Anticipation, and refusing to guess

Prediction is gated hard:

```ts
if (config.anticipation === "off") return false;   // Safe mode
if (!partial.trim()) return false;                  // nothing to predict from
if (reason === "sentence") return false;            // thought already resolved
```

That third line is the important one. Asking a model what comes *after a
completed sentence* produces confident invention, which is the one thing this
product must never show. Prediction only runs mid-thought, off the unresolved
Korean tail, and the prompt forbids predicting a Bible reference, a number, a
name or a quotation.

---

## Korean → English restructuring

Korean holds the predicate — and often the whole semantic payload — until the
end of the sentence. English cannot wait that long.

```
제가 오늘 여러분과 함께 나누고 싶은 것은 ... 바로 우리의 정체성입니다.
└────────── topic frame ──────────┘        └──── payload, arrives last ────┘

SAFE:        "Today, I'd like to talk with you about..."
ANTICIPATED: "our identity."
```

The safe half commits to the *structure* without committing to unresolved
content, which lets the interpreter start speaking. The anticipated half is
visibly provisional and disappears cleanly if it was wrong.

`engine/rhetoric.ts` carries the known frames. It never rewrites anything on
its own — it supplies the shortcut to the prompt, and the model decides.

---

## Local detection: what does not need a model

Scripture normalisation, glossary matching and cultural/wordplay detection all
run **locally, synchronously, the instant Korean stabilises**. Three reasons:

1. **Latency.** No round trip.
2. **Demo mode.** They work with no network.
3. **Resilience.** When the LLM subsystem is down, the console still shows
   the reference, the terminology and the pun warning. That is the difference
   between a degraded session and a dead one.

The model receives these as hints and can add to them; it is not the only thing
standing between a pun and *"there is a road in my name."*

### Korean is agglutinative, so substring search is wrong

This produced two real bugs, both caught by looking at live output:

- `감사` fired inside `감사합니다` ("thank you") and displayed **thanksgiving**.
- `한` fired inside `거룩한` ("holy") and displayed a note about Korean
  collective sorrow.

A false term on a live console is worse than a missing one: the interpreter has
half a second and will take what the screen says. So `glossary/match-korean.ts`
requires a whole-word boundary — the term must be followed by end-of-string,
punctuation, whitespace, or a **chain** of noun suffixes (`성도` + `들` + `이`;
`은혜` + `입니다`). `감사` + `합니다` is rejected because `합니다` is a verb
ending, not a noun suffix.

### Scripture

`scripture/detect.ts` handles the spoken forms — `베드로전서 2장 9절`,
`시편 23편 1절`, `요한복음 3:16`, ranges, and Sino-Korean numerals
(`이장 구절` → 2:9). Every candidate is validated against the book's real
chapter count, so `유다서 5장` (Jude has one chapter) is rejected as a
recognition error rather than shown. Ambiguous book names — `아가` is also
"baby", `마`/`요`/`시` are ordinary syllables — only match with a verse and
resolve at lower confidence.

**It never guesses.** No confident match, no reference.

---

## Cultural adaptation and wordplay

Mandatory, not decorative. Literal translation is where Korean humour goes to
die, and a literal rendering of a joke is a visible failure in the room.

The acceptance case, from the brief. Speaker 류정길 (Ryu Jeong-gil):

> 길을 잘 찾아야 됩니다. 제 이름에도 길이 있어요.

| | |
| --- | --- |
| **Fails** | "We need to find the road well. There is also a road in my name." |
| **Passes** | "We need to find the right way." / "And speaking of \"the way,\" it's even in my name." |
| **Note** | "Gil" in Jeong-gil means "way" in Korean. |

`cultural/detect.ts` finds this deterministically: a person in session memory
has a name syllable that is also being used as a bare noun nearby, and the
speaker is pointing at their own name (`제 이름`, `이름에도`). The UI marks the
second line **ADAPTED** in the reading path — not in a side panel — because the
interpreter has to see at a glance that it is not a literal rendering.

Asserted in `tests/acceptance.test.ts`, including an explicit assertion that
the output never contains "road in my name".

---

## Rolling context and compression

A sermon runs 20–70 minutes. Sending the whole transcript on every call would
be slow, expensive, and past a point *actively worse* — the model starts
attending to the introduction instead of the sentence being spoken now.

So the window is bounded (`context/rolling.ts`):

| | Budget |
| --- | --- |
| Recent Korean, verbatim | 900 chars / 12 segments |
| Recent English, verbatim | 700 chars / 12 chunks |
| Compressed summary | 700 chars |
| Glossary · entities · scripture · corrections | 24 · 16 · 8 · 16 |

Everything older is folded into one summary line rather than dropped: topic,
passages covered, people named, terms already settled, opening line.

**The compression is deterministic and local.** No extra model call, no extra
latency, no extra cost — and it still works when the LLM is down.

Only committed and current English is sent back. An anticipated chunk is a
guess and must never be fed back as though it had been said.

Measured cost of the bounded window: under 2,000 estimated tokens per call even
after 500 segments (asserted in `context/rolling.test.ts`).

---

## Session memory and corrections

Within a session the engine remembers what an interpreter would be annoyed to
re-decide: who is speaking, how a name romanises, which English rendering was
chosen for a term.

**A user correction is absolute.** When the interpreter says 유정길 is actually
류정길:

- every past segment is rewritten, keeping `originalText` for the review;
- every *future* recognition of the wrong form is corrected before anything
  downstream sees it;
- the preferred romanisation is bound (`Ryu Jeong-gil`) and passed to the model
  as a rule it may not overrule;
- the correction appears in the post-session review as a term to pre-load next
  time.

Romanisation uses Revised Romanisation with a documented exception: surnames
use their conventional spellings (김 → **Kim**, not "Gim"; 이 → **Lee**, not
"I"). Strict RR would put a name on screen that no Korean writes and no
interpreter should say aloud.

---

## Uncertainty

Coarse by design — no numeric percentages, which are noise at a glance.

| Confidence | On screen |
| --- | --- |
| high | nothing |
| medium | nothing (the chunk is simply present) |
| low | a small amber `?` after the line |

Plus `ADAPTED` for a non-literal rendering and `↺` for a correction.

The prompt's rule is that **omission beats invention**: a missing detail costs
the interpreter a beat, a fabricated one costs them their credibility.

---

## Reading behaviour

- **Auto-scroll fires on stabilised chunks, never on tokens.** Per-token
  scrolling makes text impossible to fixate on.
- The active line's centre parks at **55%** of the reading region — verified at
  55% on iPhone landscape, iPad landscape and laptop. History above, room for
  what is coming below.
- **Manual scroll wins.** The moment the interpreter scrolls, following stops
  and a `↓ Live` button appears. Fighting a user for scroll position is
  unforgivable on stage.
- **Freeze** (Space, or a large button) stops the display while the pipeline
  keeps running. Releasing returns smoothly, never with a jump.

---

## Evaluation

`tests/fixtures.ts` holds one fixture per interpretation problem — 15
categories from the brief plus a false-positive guard — each asserting what
must and must not appear. `tests/acceptance.test.ts` runs the two critical
cases through the real engine end to end.

What is **not** asserted here: latency and "interpreter usefulness". Both need
measurement against a live model and a real interpreter, not a deterministic
stub. That is the honest next step, and it is named in the README's roadmap.
