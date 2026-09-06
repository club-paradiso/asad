# Source datasets

## Christian Korean-English glossary

`christian-glossary-500.tsv` is the source-preservation copy of the supplied **기독교 영단어 500개** workbook.

- 500 numbered source rows
- 5 source categories, 100 rows each
- 447 unique Korean headwords
- duplicate Korean headwords are intentionally preserved here because some rows carry alternate English renderings or context

### Runtime use

ASAD does not send all 500 rows to the model on every live turn. That would waste tokens, add latency, and over-bias speech recognition.

The live sermon pipeline instead uses the normalized runtime coverage layer in `src/interpreter/glossary/community-glossary.ts`. `src/interpreter/glossary/matcher.ts` finds only terms that are actually present in the current Korean segment, with session/prep terminology and the hand-curated theological lexicon taking priority. `src/interpreter/prompts/live.ts` then injects those matched terms into the interpretation context.

For speech recognition, `src/interpreter/glossary/stt-hints.ts` selects a small high-value subset. Session-specific names and terminology come first, then glossary terms detected in the day's prep material, then a conservative sermon baseline. This keeps the glossary useful for Korean recognition without blindly biasing the recognizer with hundreds of irrelevant keyterms.

### Updating

When the source workbook changes, preserve the full source rows here first. Runtime normalization should continue to merge duplicate Korean headwords while retaining alternate English renderings, and regression tests should keep source-row and unique-headword counts explicit.
