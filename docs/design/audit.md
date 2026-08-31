# UX/UI audit — 2026-08

Method: the app was run locally and every surface photographed at
iPhone portrait (390×844), iPhone landscape (844×390) and laptop, rather than
read from source. Several of the findings below are invisible in the code and
obvious in a screenshot — the wordmark break in particular.

## What the product actually is

A real-time interpretation copilot with two jobs that share almost nothing:

| | 라이브 통역 (`/live`) | 현장 응대 (`/counter`) |
|---|---|---|
| Who is reading | one interpreter, performing | staff + a visitor, two phones |
| Environment | dark auditorium, phone propped sideways | lit counter, handheld |
| Failure cost | a missed sentence, live, in public | a slower conversation |
| Reading speed | ~1s per glance while listening | conversational |

Plus three support surfaces: `/prep`, `/sessions`, `/diagnostics`.

That split is the reason the design system has exactly two surfaces and not
one — see `decisions.md`.

## Findings

### KEEP — do not touch

1. **The live console.** Hierarchy, restraint and typography are all correct
   and hard-won: three text weights, three colour roles, colour reserved for
   state (amber = now, cyan = reference, red = wrong). It is the only surface
   that was actually designed, and it is the source of the system's DNA rather
   than a candidate for redesign.
2. **The dual-axis type scale.** `clamp(1.5rem, min(4.4vw, 7dvh), 2.9rem)` —
   sizing against height as well as width is what keeps the console legible on
   an iPhone in landscape, which is 844 wide but only 390 tall. Width-only
   sizing produced 37px English in a 98px region.
3. **The dark-in-any-theme rule for the console.** Not a preference question.
4. **Readiness as four experiential lines.** "규칙 기반만 사용", not
   "Set GEMINI_API_KEY". The person reading it cannot redeploy.
5. **Chunk states** (committed / current / anticipated) and their margin
   rules. Anticipated text must never read as confirmed speech.
6. **`font-korean` as a separate stack.** Latin metrics on Hangul are wrong
   and interpreters notice.
7. **Consent resolved before the tap.** A privacy disclosure that arrives
   after the microphone opens is not a disclosure.

### IMPROVE

8. **Wordmark.** `break-all` on 15 unspaced Hangul syllables rendered
   "아무튼서로알아들었으면된거아닌가" / "요". → two-line lockup broken at the
   clause, `overflow-wrap: anywhere` with `word-break: keep-all`.
9. **Language mixing.** The old `/live` launcher had a Korean brand, Korean
   nav, English control labels, English options, an English hint, an English
   CTA and an English readiness panel — on one screen. → chrome follows the
   reader (Korean), content follows the work (console stays English).
10. **Empty states.** A bordered box containing a paragraph, which is the one
    place in a product a paragraph is guaranteed not to be read. → symbol,
    one line, one action.
11. **Counter setup header.** A four-line paragraph explaining the mode, on
    top of the task. Two of those facts change a decision; the rest is
    documentation.
12. **Section labels.** `tracking-[0.12em]` + uppercase applied to Korean
    opens visible holes between syllables and reads as broken kerning.
13. **Guest errors.** Red text alone, no icon — fails for a red-green
    deficiency and in sunlight, on the one screen read by someone who shares
    no language with the staff.

### REPLACE

14. **The launcher's two mode cards.** Icon tile + badge + 3-item ticked
    feature list + full-width filled button, twice = a pricing page answering
    a question nobody arriving at their own tool is asking. The second mode
    started below 1350px of scroll. → two rows.
15. **The blue action colour (`#144ddd`).** Generic, and close enough to Toss
    Blue to read as borrowed. → ink for action, signal red for correction.
16. **Two competing accents.** Launcher blue + console amber + teal info, with
    no rule saying which meant what. → one action colour, one brand mark
    colour, amber demoted to a console *state* colour (which is what its own
    code comment already said it was).
17. **Prep/sessions identity.** Called themselves "Prepare" and "Sessions",
    dark, in English, with a back link labelled "← Console" pointing at a
    screen called "라이브 통역". → shared `PageHeader`, named as the launcher
    names them.
18. **`TY-` room-code prefix.** A brand name retired months ago, printed on
    QR posters and read aloud across counters. → `AS-`, with `TY` still
    accepted on input.

### REMOVE

19. Feature bullet lists on the launcher.
20. The `주 모드` badge — with two modes, ranking them in a badge as well as
    in order and size is a third redundant signal.
21. The icon tiles on the mode cards. A 44px bordered tile containing a 20px
    glyph, next to a heading that already says the same thing.
22. The middle `mt-auto` void on the launcher (~400px of nothing on a phone).

## Not done, and why

**Apps in Toss / TDS.** The brief assumes this is a Toss miniapp. It is not:
there is no `@apps-in-toss/*` or `@toss/tds*` dependency, no `granite.config`,
no miniapp manifest — it is a Next.js 16 app deployed on Vercel, and a repo
grep for `toss|tds|granite` returns nothing. Separately,
`developers-apps-in-toss.toss.im` and `tossmini-docs.toss.im` are both blocked
by this environment's network egress proxy, so the official documentation the
brief names as the source of truth could not be read.

Rather than invent TDS token names and navigation specs from search summaries,
`apps-in-toss-design-reference.md` records what porting would require and which
decisions are deliberately deferred. The design system built here is
token-based specifically so that a future TDS mapping is a token-layer change
rather than a rewrite.
