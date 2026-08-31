# Design decisions

Only the ones with a real alternative. Each says what was rejected and why, so
a future change can disagree on the reasoning rather than rediscover it.

---

### D1 · Two surfaces, not one theme

**Decided:** one dark surface (the live console) and one paper surface
(everything else), each locked regardless of the OS theme.

**Rejected:** a single palette with light/dark modes throughout.

The console is dark because an interpreter reads it in an auditorium with the
lights down; that is not a preference. The launcher is light because it gets
used in a lit office and a bright foyer, and because a dark launcher next to a
dark console made the whole product feel like one long night shift. A single
theme would have to lose one of those.

The cost is honest: two palettes to keep in step. That is why every component
resolves through working tokens rather than brand values — a component never
knows which surface it is on.

---

### D2 · Ink is the action colour; red is the correction mark

**Decided:** primary buttons are near-black. Signal red is reserved for the
brand's `?`, errors, and struck text.

**Rejected:** signal red as the primary CTA fill — the obvious reading of "one
brand colour, use it for buttons".

Red-as-CTA and red-as-error cannot coexist: the moment both are on screen, red
stops meaning anything. Making ink the action colour gives a rule that fits in
one sentence — *a red button in this product always means something is wrong* —
and it is also the more distinctive choice. A black button on warm paper reads
as editorial, and nothing about it resembles a SaaS dashboard.

It also matches the brand idea exactly: red is the proof-reader's pen. The pen
does not press the button.

`BRAND.primaryColor` is still the red, because a platform listing asks for an
*identity* colour, which is a different question from what a button is filled
with.

---

### D3 · Korean chrome on the launcher, English chrome in the console

**Decided:** chrome follows the reader; content follows the work.

**Rejected:** (a) all-Korean, (b) all-English, (c) a language switcher.

The old launcher had a Korean brand, Korean nav, English control labels,
English options, an English hint, an English CTA and an English readiness
panel — on one screen. That is the actual defect, and either (a) or (b)
consistently applied would have fixed it.

The console keeps English because its *content* is English: the interpreter is
reading the next line they have to say, at speed, and a Korean word in that
chrome sits next to the one thing they are reading against the clock. The
launcher goes Korean because nothing is being read aloud yet and the reader is
Korean. A switcher was rejected as a setting nobody would find, for a problem
that has a correct default.

The Korean label maps live in `StartScreen.tsx`, not in `lag.ts` or
`providers/stt`, precisely because those modules are shared with the console.

---

### D4 · The mark is drawn, not typeset

**Decided:** the `?`-with-a-`✓`-dot is SVG path data, shared by the React
component and the icon generator.

**Rejected:** a font glyph, or a `?` with a check positioned next to it.

No typeface puts a tick where the dot goes, and there is no way to guarantee
the metrics of one that did. Sharing the path data across `<Mark>` and
`scripts/generate-icons.mjs` also means the icon and the in-app mark cannot
drift, which is the failure mode that produces an app icon two redesigns
behind the product.

---

### D5 · The empty state is a component with a tone, not a string

**Decided:** `<StateBlock tone="empty | success | error">`, where the error
tone drops the symbol and the playfulness.

**Rejected:** one styled block with the copy varied per use.

The brief's rule — jokes in empty and success, never in errors, payment,
privacy or permissions — is the kind that erodes the moment someone is in a
hurry. Making `error` a structurally different rendering means you cannot
accidentally ship a shrug on an error screen; you would have to pass the wrong
tone and then also rewrite the copy.

---

### D6 · Room codes are `AS-`, and `TY-` is still accepted

**Decided:** change the prefix, keep the old one readable.

**Rejected:** (a) leave `TY-`, (b) change it cleanly with no fallback.

`TY` is tong-yuck, a name no user has seen since the rebrand, and it was being
printed on QR posters and read aloud across counters. Leaving it was not an
option. But a visitor holding an old poster is exactly the person least able to
recover from "invalid code" — they are at a counter, in a queue, without a
shared language. Two lines of fallback in `normaliseCode` is a cheap price.

---

### D7 · The live console was not redesigned

**Decided:** leave it, and derive the system from it.

**Rejected:** restyling it for consistency with the new launcher.

It is the only surface in the product that was actually designed, and the
reasoning behind it — three text weights, three colour roles, colour reserved
for state, dual-axis type sizing, no spinner — is correct and hard-won. The
launcher was made consistent with the console, not the other way round. The
only change it received is `--brand-red` remapping to a value that clears a
near-black ground.

The brief asked for an overhaul. The honest reading of that is "fix what is
broken", and this was not broken.

---

### D8 · Apps in Toss compliance was not asserted

**Decided:** document what porting would need; do not write TDS mappings.

**Rejected:** building against TDS token names and navigation specs gathered
from web search.

Two facts: the repo has no Apps in Toss or TDS dependency of any kind, and both
official documentation domains are blocked by this environment's egress proxy.
A component written against an invented `colors.grey700` compiles, ships, and
is wrong in a way nobody catches until review — which is worse than a documented
gap. See `apps-in-toss-design-reference.md` for the open questions and the
structural conflicts (landscape-first console, dark lock, `userScalable: false`,
two co-equal modes) that a port will actually have to resolve.

---

### D9 · The wordmark breaks at the clause

**Decided:** two lines — `아무튼서로알아들었으면` / `된거아닌가요?` — with
`word-break: keep-all` plus `overflow-wrap: anywhere`.

**Rejected:** `break-all` (what shipped), a single line at a smaller size, and
an image.

`break-all` on fifteen unspaced Hangul syllables rendered
`아무튼서로알아들었으면된거아닌가` / `요`. Shrinking it to fit one line makes
the brand statement quieter than the body copy beside it. An image cannot be
selected, translated or scaled with the type.

The clause break is also the better *design*: the setup reads small and
hedging, the punchline reads big and shrugging. The constraint produced the
right answer.
