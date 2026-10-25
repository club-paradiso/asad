# Counter Mode UX/UI audit

Observed by reading the components and by driving both surfaces in Chromium
(desktop 1024×768 as the desk, iPhone 13 and Pixel 7 emulation as the phone)
through `scripts/e2e-counter.mjs`. Screenshots from that run are referenced
below; they are captured in `e2e-out/` when the script runs and are not
committed. No real device, Safari, or sighted-user session was available —
device-matrix verification is **PARTIAL**.

## What was good and was kept

- Both languages on every bubble, the viewer's large — the single most
  important decision in this surface.
- Quick phrases as the zero-error path; confirm-the-numbers read-back; risk
  highlighting; integrity warning with the specific values; staff-only review
  flags.
- Endonym language picker; interface chrome translated in all 25 languages;
  RTL handled per half-bubble with isolated Latin runs.
- Voice transcript always lands in the editable field, never sent silently.

## Findings and changes

| # | Surface | Finding | Change | Evidence |
| --- | --- | --- | --- | --- |
| 1 | both | After Send, nothing appears until the model answers (2–6 s). Sent, processing, translated and failed are indistinguishable until then. | Local bubble appears immediately (dashed border, "Translating…" status line in the viewer's language, `aria-busy`), replaced by the stored message; a failed send stays with text, Resend (prominent) and Discard. | E2E: pending bubble in 75–81 ms after click |
| 2 | both | One tap on End or × deletes the conversation for both people. | Two-tap confirm, 4 s window, label in the reader's language (26 languages), armed state styled distinctly, `aria-pressed`. Desk: only while a conversation exists; before anyone has spoken the buttons act at once. | E2E: "staff End asks once before acting" |
| 3 | visitor | A reload returns the visitor to the picker and the server then refuses them. | Per-tab resume; the conversation is back after reload. | E2E reload check |
| 4 | desk | Header buttons 30 px tall, 12 px text, tapped during service. | 44 px minimum height, 14 px text. | — |
| 5 | both | Full re-render every 1.2 s while idle. | Skip unchanged polls. | Hook test |
| 6 | both | Every "please check" warning that fires on a correct translation teaches people to ignore the one that matters. | Validator false positives on the corpus 46% → 0%. | Quality benchmark |
| 7 | visitor | Delivery waits for the next poll: 600 ms mean, 1.2 s worst. | 500 ms cadence while the conversation is live. | Latency model; E2E quick-phrase delivery 281–882 ms including render |

## Not changed, recommended

- **Visitor-side "incoming…" indicator.** The recipient still sees nothing
  while the other side's translation runs. A pre-translation pending record
  would need a message-revision cursor (replaced messages keep their `seq`
  and would be filtered out by `since`). Worth doing; out of scope here.
- **Connection state** is a small header suffix ("재연결 중"). A visible,
  colour-independent banner when polling has failed for > 5 s would help on
  bad mobile data.
- **Integrity chips** show `source → target` in monospace with "—" for a
  missing side; a short legend ("in the original / in the translation") would
  make them readable without training.
- **Keyboard**: the composer is a form (Enter sends, IME-safe). Quick-phrase
  chips and confirm buttons are real buttons. A visible focus ring on the mic
  button should be checked on the desk browser.
- **Dark appearance**: both surfaces use the token palette; verified only in
  the default (light) scheme in E2E.

## Responsive and RTL

| Viewport | Result |
| --- | --- |
| Desk 1024×768 | QR panel, header, conversation, composer: no overflow (screenshot) |
| iPhone 13 (390×844) portrait | Picker 2-column grid, sticky Start, composer above safe area (screenshot) |
| Pixel 7 (412×915), Arabic | RTL bubble; Latin status code `D-10` and `3 PM` render intact and in order (E2E check + screenshot) |
| iPhone landscape, iPad, desktop staff > 1280 | NOT VERIFIED in this run |
| Light/dark | light only in this run |

RTL verification is by text extraction and screenshot, not by a native Arabic
reader; the `BidiText` isolation logic is unchanged from `main`.
