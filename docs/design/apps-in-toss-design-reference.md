# Apps in Toss — porting reference

**Status: not integrated, and not verifiable from this environment.**

Read this before acting on any Apps in Toss requirement in this repository.

## Two facts that shape everything below

**1. This is not a Toss miniapp.** It is a Next.js 16 app on Vercel. There is
no `@apps-in-toss/*` or `@toss/tds*` dependency, no `granite.config.ts`, no
miniapp manifest. A repo-wide grep for `toss`, `tds`, `apps-in-toss` and
`granite` returns zero matches outside this file.

**2. The official documentation is unreachable from here.** Both
`developers-apps-in-toss.toss.im` and `tossmini-docs.toss.im` return
`EGRESS_BLOCKED` from this environment's network proxy. Web *search* works and
returns plausible summaries; the brief correctly says search summaries are not
a source of truth, so **nothing in this file is treated as verified**.

Consequently this document does not restate TDS token names, navigation specs,
icon dimensions or review criteria as if they were settled. Getting those
wrong is worse than not having them: a component written against an invented
`colors.grey700` compiles, ships, and is wrong in a way nobody catches until
review.

## What was done instead

The design system was built so that a TDS mapping later is a **token-layer
change, not a rewrite**:

- No component contains a raw hex. Every colour resolves through a working
  token (`--fg`, `--accent`, `--line`…) that a surface rebinds. Pointing those
  at TDS semantic colours is one file.
- No component hard-codes a font stack; `--font-sans` / `--font-display` /
  `--font-korean` are single points of change.
- Every touch target is ≥44px and every interactive element has a visible
  focus ring, so a platform minimum at or below that is already met.
- Safe-area insets are already tokens (`--safe-top`, `--safe-bottom`) and are
  applied on the launcher and the guest screen.
- The brand carries one identity colour (`BRAND.primaryColor = #c81e1e`) ready
  for a `brand.primaryColor` field, and a 600×600 square icon
  (`public/icons/brand-600.png`) on a light ground, since that size is the one
  requirement consistently reported for miniapp listings.

## Open questions — resolve against the official docs before porting

Do **not** answer these from memory or from a blog.

1. **TDS semantic colour names and light/dark values**, and whether the Figma
   UI Kit's names match the shipped code's.
2. **Navigation bar**: whether it is mandatory on every screen, and the exact
   icon treatment. The brief is explicit that this must not be designed
   freehand, and this product currently has no top navigation bar at all — it
   uses in-page back links.
3. **Tab bar**: whether a floating type is required, and the permitted item
   count. This product has two modes and no tab bar; if one is required, the
   IA in `decisions.md` needs revisiting, because two tabs plus three support
   screens is not a tab structure.
4. **Runtime font family.** The design assumes IBM Plex Sans + a system Korean
   stack. A Toss runtime may impose its own, which would invalidate the metric
   tuning behind `--english-size` / `--korean-size`. This is the single
   highest-risk unknown for the console.
5. **Webview restrictions** — specifically whether the Web Speech API and
   `getUserMedia` are available. If they are not, `webspeech` as an STT source
   cannot ship inside Toss and the readiness rows change meaning.
6. **Icon and logo spec**: exact sizes, background rules, light/dark
   visibility, and whether the brand name may be exposed as it is here.
7. **Dark pattern policy** as it applies to the consent gate and the free-tier
   disclosure.
8. **Whether the console may run dark** when the host app is light. The
   auditorium argument is strong but it is the platform's call.

## Structural conflicts to expect

- **The console is landscape-first and dark-locked.** Both are load-bearing
  (an iPhone in landscape is 390pt tall; a lit screen in a dark auditorium is
  unusable) and both are likely to meet a platform convention.
- **`userScalable: false`.** Deliberate — pinch-zoom on a live console loses
  the interpreter their layout mid-sentence, and a font-scale control does the
  job properly instead. Some review processes reject this outright.
- **Two peers, not one home.** The IA has two co-equal modes. A single-entry
  miniapp shell may not have somewhere to put that.

## If you are the one porting this

1. Fetch the official docs from an unrestricted network and record what they
   actually say, replacing the questions above with answers and citations.
2. Log every difference you find between the docs, the shipped TDS code and
   the Figma kit in `figma-code-differences.md`.
3. Map the working tokens to TDS semantic colours in `globals.css` only.
4. Re-run the contrast table in `design-system.md` against the mapped values —
   TDS greys will not have the same ratios as this palette's.
5. Treat the console as the hard case and start there, not with the launcher.
