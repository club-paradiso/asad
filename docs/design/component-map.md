# Component map

Figma component → production component → source → notes.

The Figma column refers to the **ASAD — Product Design** file (see
`figma-code-differences.md` for the file key). "TDS" is deliberately empty
everywhere: this product does not depend on TDS, and inventing a mapping to a
library the repo cannot import would be worse than leaving it blank. See
`apps-in-toss-design-reference.md`.

## Brand

| Figma | Production | TDS | Source | Notes |
|---|---|---|---|---|
| `Brand/Mark` | `<Mark>` | — | `src/components/brand/Mark.tsx` | `?` with a `✓` dot. Same path data as the icons. `mono` for single-ink. |
| `Brand/Wordmark` | `<Wordmark>` | — | `src/components/brand/Wordmark.tsx` | `variant: full \| compact` |
| `Brand/SpeechBubbles` | `<SpeechBubbles>` | — | `src/components/brand/SpeechBubbles.tsx` | `tone: default \| resolved` |
| `Brand/AppIcon` | — | — | `scripts/generate-icons.mjs` | Generated, not authored. `npm run icons` |

## Primitives

| Figma | Production | TDS | Source | Notes |
|---|---|---|---|---|
| `Core/Button` | `<Button>` | — | `src/components/ui/primitives.tsx` | `tone: neutral\|primary\|quiet\|danger`, `size: sm\|md\|lg`, `active` |
| `Core/Segmented` | `<Segmented>` | — | ditto | radiogroup; ≤4 items |
| `Core/Chip` | `<Chip>` | — | ditto | `tone: neutral\|info\|accent` |
| `Core/TextInput` | `<TextInput>` | — | ditto | `korean` switches the stack |
| `Core/TextArea` | `<TextArea>` | — | ditto | |
| `Core/Toggle` | `<Toggle>` | — | ditto | `role="switch"` |
| `Core/Field` | `<Field>` | — | ditto | label + hint wrapper |
| `Core/Label` | `<Label>` | — | ditto | |
| `Core/StatusDot` | `<StatusDot>` | — | ditto | never the only signal |

## Patterns

| Figma | Production | TDS | Source | Notes |
|---|---|---|---|---|
| `Pattern/PageHeader` | `<PageHeader>` | — | `src/components/ui/PageHeader.tsx` | back link + compact wordmark + title |
| `Pattern/StateBlock` | `<StateBlock>` | — | `src/components/ui/states.tsx` | `tone: empty\|success\|error`. Error drops the symbol by design. |
| `Pattern/Readiness` | `<Readiness>` | — | `src/features/live/Readiness.tsx` | 4 rows, worst-row headline |
| `Pattern/ModeRow` | `ModeRow` | — | `src/features/home/HomeScreen.tsx` | local; only two exist |

## Console (dark surface)

| Figma | Production | TDS | Source |
|---|---|---|---|
| `Console/TopBar` | `<ConsoleTopBar>` | — | `src/features/live/ConsoleTopBar.tsx` |
| `Console/EnglishStream` | `<EnglishStream>` | — | `src/features/live/EnglishStream.tsx` |
| `Console/KoreanStream` | `<KoreanStream>` | — | `src/features/live/KoreanStream.tsx` |
| `Console/ContextRail` | `<ContextRail>` | — | `src/features/live/ContextRail.tsx` |
| `Console/ControlBar` | `<ControlBar>` | — | `src/features/live/ControlBar.tsx` |
| `Console/Teleprompter` | `<Teleprompter>` | — | `src/features/live/Teleprompter.tsx` |
| `Console/SettingsSheet` | `<SettingsSheet>` | — | `src/features/live/SettingsSheet.tsx` |

## Counter

| Figma | Production | TDS | Source |
|---|---|---|---|
| `Counter/HostSetup` | `SetupScreen` | — | `src/features/counter/CounterHostScreen.tsx` |
| `Counter/Conversation` | `<ConversationView>` | — | `src/features/counter/ConversationView.tsx` |
| `Counter/Composer` | `<Composer>` | — | `src/features/counter/Composer.tsx` |
| `Counter/QuickPhrases` | `<QuickPhraseBar>` | — | `src/features/counter/QuickPhraseBar.tsx` |
| `Counter/QrCode` | `<QrCode>` | — | `src/features/counter/QrCode.tsx` |
| `Counter/GuestJoin` | `<CounterGuestScreen>` | — | `src/features/counter/CounterGuestScreen.tsx` |

## Code Connect

Not configured. It needs a Figma library published from an organisation plan;
this file lives on a student team plan, where published libraries are not
available. The table above is the manual equivalent and is the thing to keep
current — if a component is renamed on either side, fix it here in the same
commit.

## Rules for adding a component

Before writing a new one, in order:

1. Can an existing primitive do it with a prop? Add the prop.
2. Does it need a raw colour? It must not — use a working token.
3. Does it meet 44px and have a focus ring?
4. Does it carry state by something other than colour alone?
5. Add it to this table **and** to the Figma Components page in the same
   change, or the two drift immediately.
