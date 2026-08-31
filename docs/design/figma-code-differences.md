# Figma ↔ code differences

**File:** 아무튼서로알아들었으면된거아닌가요 — Product Design
**Key:** `5iaJxvMbID1e6vvKTMMPDR`
**URL:** https://www.figma.com/design/5iaJxvMbID1e6vvKTMMPDR
**Synced:** 2026-08-29, from `claude/platform-ux-design-system-ine77g`

Everywhere the file and the repository disagree, and why. Read this before
trusting a value read off a Figma layer.

## Verification order

Official documentation → shipped code → Figma. The file is the newest of the
three and the easiest to edit, which makes it the least authoritative.

## Real differences

### 1. Korean renders in a different face in Figma than in the product
**The largest one, and it affects every screen.**

Production sets Hangul on the *device's own* Korean stack — Apple SD Gothic
Neo, then Pretendard, then Noto Sans KR. Neither webfont covers Hangul: IBM
Plex Sans and Bricolage Grotesque are loaded Latin-only, on purpose, because a
booth on church wifi cannot afford a megabyte of CJK subsets ninety seconds
before a service, and a browser resolves fonts per *character*, so the
fallback happens automatically.

Figma has no such fallback chain. Every Korean string in this file renders in
whatever Figma resolves, which is not what an iPhone shows.

**Consequence:** Korean line breaks, line lengths and optical weight in Figma
are indicative, never exact. Any layout decision that depends on where a
Korean line wraps must be checked in the browser. This is also the reason
`--korean-size` and `--english-size` were tuned against a device rather than
against a design file.

### 2. The caption face
Figma uses IBM Plex Mono. Production uses `ui-monospace` — the system mono
(SF Mono, Menlo, Consolas). Chosen to avoid shipping a fourth font file for
labels and timecodes. Figma's captions are therefore slightly narrower than
production's on macOS and slightly wider on Windows.

### 3. Two colour modes vs. one CSS attribute
Figma models the surfaces as two **modes** on the Colour collection (Paper,
Console). Production models them as a `[data-surface]` attribute that rebinds
CSS custom properties.

The values are identical and were entered from the same source. The mechanism
is not, so **adding a colour in Figma does not add it to the product** — it has
to be added to `globals.css` as well. There are 19 colour variables and 15
scale variables; if those counts and the token list in
`docs/design/design-system.md` ever disagree, the CSS is right.

### 4. `--font-scale` does not exist in Figma
The interpreter controls a live type scale multiplier in the console
(`+`/`−`). Every console type size in Figma is drawn at scale 1.0. The console
must survive roughly 0.8×–1.4×; that can only be checked in the browser.

### 5. Dual-axis type sizing does not exist in Figma
`clamp(1.5rem, min(4.4vw, 7dvh), 2.9rem)` sizes against viewport height as
well as width — the thing that keeps the console legible on an iPhone in
landscape (844 wide, 390 tall). Figma frames are fixed, so the console frame
shows one point on that curve. Resizing the Figma frame does **not** simulate
what the product does.

### 6. Archive images are missing
The four Archive frames are named, sized and positioned, but empty: the
session that built this file had `mcp.figma.com` blocked by its network egress
proxy, so the uploads failed with a 403 at the CONNECT stage. The PNGs were
handed to the user in chat; dragging them onto the four frames completes the
page. Nothing else depends on them.

### 7. Code Connect is not configured
It needs a published Figma library, which requires an organisation plan; this
file lives on a student team plan. `docs/design/component-map.md` is the manual
equivalent and has to be updated by hand when either side is renamed.

### 8. Interaction states are static
Hover, `active:scale-[0.98]`, focus rings and the `.mark-resolve` /
`.chunk-enter` animations exist only in CSS. The Button variant set carries
`State=default | active | disabled` because those are *semantic* states worth
designing; hover and focus are not modelled, and should not be added to the
variant set — they would double its size and still not be accurate.

## Not differences — deliberate, and correct in both

- The mark's geometry is one set of path data used three times: `<Mark>`,
  `scripts/generate-icons.mjs`, and the Figma vectors. If you change the curve,
  change all three or none.
- The button minimum height is 44px in both, including `size="sm"`.
- Signal red is `#c81e1e` on paper and `#f05a50` on the console in both. It is
  a remap, not a discrepancy: `#c81e1e` does not clear a near-black ground.

## When you change something

| Changed in | Also do |
|---|---|
| Figma variable | Edit `globals.css`; re-run the contrast table |
| Figma component | Update the production component **and** `component-map.md` |
| `globals.css` | Update the Colour/Scale collections; note it here |
| A brand asset | Re-run `npm run icons`; update 02 — Brand Identity |
| Anything at all | Update "Synced" at the top of this file |
