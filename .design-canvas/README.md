# Design canvas sources

The artboards behind the published design canvas:
https://claude.ai/code/artifact/e690bd8b-07ca-44e3-a5a3-f01bbea6e878

| File | Artboard |
|---|---|
| `Main.dc.html` | Foundations — colour, contrast, the two surfaces, type |
| `Brand.dc.html` | The mark, the wordmark, the symbol, the devices |
| `Screens.dc.html` | The shipped screens at 390pt, plus the console |
| `Rules.dc.html` | The nine checks before shipping a screen |
| `canvas.json` | Layout, sticky notes, launch view |

These are the source of truth; the published page is generated from them. To
change it, edit an artboard here and re-seed with the `/design` skill's helper,
then republish to the **same** URL — publishing without it creates a second
canvas instead of updating this one.

Values here are duplicated from `src/app/globals.css` by hand. When they
disagree, the CSS is right — see `docs/design/figma-code-differences.md`, which
tracks the same problem for the Figma file.
