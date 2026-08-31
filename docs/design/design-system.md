# Design system

Two surfaces, one brand, four colour roles. Everything below is defined in
`src/app/globals.css`; nothing here is a plan.

## The brand in one paragraph

The service is called 아무튼서로알아들었으면된거아닌가요 — "anyway, if we
understood each other, isn't that the point?" It is a sentence, not a noun, and
it is a shrug. The product does not sell correct language; it sells the moment
a conversation worked despite the language. So the visual system is a
**proof-read page**: ink on warm paper, with a red correction mark. The mistake
stays legible under the line. That is the whole idea, and every device below is
a way of saying it.

Internal name for the direction: **Communication Error Chic** — looks slightly
wrong, is precisely built.

## Brand tokens

Four values. Everything else is derived.

| Token | Value | Means |
|---|---|---|
| `--brand-ink` | `#12100e` | what you read, and what you press |
| `--brand-paper` | `#faf7f2` | warm off-white; a screen quoting a page |
| `--brand-cream` | `#f2ede4` | raised / inset paper |
| `--brand-red` | `#c81e1e` | **the correction mark** |
| `--brand-red-on-dark` | `#f05a50` | the same role, on the console |
| `--brand-navy` | `#1b2a4a` | reference material, deep accent |

`--brand-red` is not the button colour. It means "look here, this is off" and
nothing else — the `?` of the wordmark, an error, a struck word. Because ink is
the action colour, **a red button in this product always means something is
wrong**. That is a rule you can teach in one sentence, and it is why the brand's
most saturated colour can be reused for danger without ambiguity.

`BRAND.primaryColor` in `src/lib/brand.ts` is the red — it is the *identity*
colour any platform listing should be given, which is a different question from
what a button is filled with.

## Surfaces

A surface rebinds the working tokens. Components only ever reference the
working names (`--fg`, `--accent`, `--line`…), never a brand value or a hex, so
a component is correct on any surface without knowing which it is on.

### `[data-surface="live"]` — the console
Dark, in any OS theme, always. Interpreting from a white screen in a dark
auditorium is not a preference question. Palette unchanged from the tuned
original; the only addition is `--brand-red` remapping to the on-dark red,
because `#c81e1e` does not clear a near-black background.

### `[data-surface="launcher"]` — paper
Light, in any OS theme. Launcher, prep, sessions, counter host, guest join.
These get used in a lit office and a bright foyer, and a dark launcher beside a
dark console made the product feel like one long night shift.

```
--accent: var(--brand-ink)        the action role
--accent-contrast: paper
--danger: var(--brand-red)
```

### Working tokens
`--bg` `--bg-raised` `--bg-overlay` `--line` `--line-strong` `--fg`
`--fg-muted` `--fg-dim` `--accent` `--accent-contrast` `--accent-dim` `--info`
`--info-dim` `--ok` `--warn` `--danger`, plus `--safe-{top,bottom,left,right}`.

## Contrast

Every pair below is measured, not estimated (WCAG 2.1 relative luminance).

| Pair | Ratio | |
|---|---|---|
| ink on paper | 17.77:1 | AAA |
| `--fg-muted` `#4a4540` on paper | 8.87:1 | AAA |
| `--fg-dim` `#6b655e` on paper | 5.39:1 | AA |
| red on paper | 5.37:1 | AA |
| paper on red | 5.37:1 | AA |
| paper on ink | 17.77:1 | AAA |
| red on cream | 4.92:1 | AA |
| on-dark red on console bg | 6.00:1 | AA |
| ink on amber | 10.18:1 | AAA |

The red passes both as text on paper *and* as the ground under paper text,
which is what lets one value serve the mark, an error label and a filled
destructive button.

## Typography

| Role | Face | Used for |
|---|---|---|
| body | IBM Plex Sans → Apple SD Gothic Neo / Pretendard / Noto Sans KR | everything |
| display | Bricolage Grotesque | wordmark, headings, timers |
| caption | system mono | labels, annotations, codes |

Both webfonts are Latin-only and self-hosted at build time by `next/font`. A
booth on church wifi cannot afford a blocking request to fonts.gstatic.com
ninety seconds before a service. **Hangul stays on the system stack** — the
Korean faces already on the device are better than anything worth shipping a
megabyte of CJK subsets for, and a browser resolves fonts per *character*, so
the fallback order does this automatically.

The brand's "one unexpected interruption" is the **caption voice**: monospace,
small, tracked — a subtitle timecode. It is the only typographic joke, and it
never lands on anything that has to be read at speed.

Korean captions take `letter-spacing: 0.02em`, not the `0.08em` a Latin caption
would take: CSS cannot track by script, and Latin tracking on 무엇을 하시나요
opens holes between syllables that read as broken kerning.

Type roles: `.type-english` `.type-korean` `.type-context` `.type-display`
`.type-label` `.brand-caption`, all scaled by `--font-scale`, which the
interpreter controls.

## Brand expression

Allowed **only** on hero, onboarding, empty, success and brand illustration.
Never inside a live reading area or a form somebody is trying to complete. If a
device makes a task harder it comes out; the concept survives that fine.

| Class | Device |
|---|---|
| `.brand-wordmark` / `-lead` | the two-line lockup |
| `.brand-caption` | subtitle/timecode voice |
| `.brand-struck` | struck text, red rule, still legible |
| `.brand-underline` | annotation underline under descenders |
| `.brand-nudge` | ≤3px misalignment, once per screen at most |
| `.mark-resolve` | the ? → ✓ resolve, fires once, never loops |

## Identity components

`src/components/brand/`

- **`<Mark>`** — the `?` whose dot is a `✓`. Drawn, not typeset: no face puts a
  tick there. `mono` collapses it to one colour for single-ink reproduction.
- **`<Wordmark>`** — `full` (two lines + mark) and `compact` (mark + 아서알?).
  One `aria-label` for the whole lockup, so a screen reader hears the name
  rather than two fragments and a punctuation mark.
- **`<SpeechBubbles>`** — bubble A over-explains, bubble B says "ㅇㅇ", a check
  sits on the overlap. Communication ≠ equal effort or matched grammar; it is
  only the overlap. The inner lines are strokes, not text, so the symbol is a
  picture rather than a sentence needing translation.

Minimum sizes: mark 16px, full wordmark 20px cap height, symbol 64px. Clear
space around the wordmark = the cap height of line 2.

## UX writing

Korean on launcher surfaces, English in the console — **chrome follows the
reader, content follows the work**. The interpreter is reading English off the
console at speed; a Korean word in that chrome sits next to the one thing they
are reading against the clock.

Personality is allowed in empty and success states. It is **not** allowed in
payment, errors, privacy, permissions, or any decision the user cannot undo —
`<StateBlock>` enforces this structurally by having a separate `error` tone
that drops the symbol and states the fact.

- 아직 저장된 세션이 없어요. (empty)
- 아무튼 통했어요 ✓ (success)
- 번역이 지금 되지 않습니다. 직원에게 말씀해 주세요. (error — plain)

## Motion

Feedback, never decoration. One-shot only; nothing loops except the connection
pulse, which is state. `prefers-reduced-motion` disables animation, the edge
mask fades and `.brand-nudge`, because a mask that hides content is a bug and
anyone asking for less motion has usually also asked for plainer rendering.

## Accessibility rules that are not negotiable

1. Minimum target 44px. `min-h-11` is the floor in `primitives.tsx`.
2. State is never colour alone — always a word, a shape or a fill as well.
3. Focus ring: 2px `--accent`, 2px offset, on every focusable element.
4. The brand's deliberate misalignment is aesthetic only. Confusing UX is not
   excused by calling it a concept.
5. Errors say what happened and what to do, in the reader's language.
