# Source datasets

## Christian Korean-English glossary

`christian-glossary-500.tsv` is the source-preservation copy of the supplied **기독교 영단어 500개** workbook.

- 500 numbered source rows
- 5 source categories, 100 rows each
- 470 unique Korean headwords across 30 duplicated rows
- duplicate Korean headwords are intentionally preserved here because some rows carry alternate English renderings or context

### This is an archive, not the runtime generator

`src/interpreter/glossary/community-glossary.ts` was **not** generated from this
file. Both come from the 「기독교 영단어 500개」 workbook, but from different
editions, and their vocabulary differs in substance rather than in normalization:

| | rows | unique Korean |
| --- | ---: | ---: |
| `christian-glossary-500.tsv` | 500 | 470 |
| `COMMUNITY_SERMON_GLOSSARY` | 500 | 447 |

371 headwords are shared. 99 exist only here (`세상의 빛`, `세상의 소금`,
`영혼 구원`, `그리스도의 몸`, `복음의 열매` …) and 76 only in the runtime layer
(`설교`, `예화`, `적용`, `도입`, `결론`, `지상명령`, `미전도종족` …). Do not
assert an equality between the two, and do not treat one as the other's
normalization: which edition ships is a product decision, and today the runtime
layer is authoritative.

`src/interpreter/glossary/source-dataset.test.ts` therefore checks this file's
own integrity — row count, numbering, category shape, well-formedness — and
nothing about the runtime glossary.

### Runtime use

ASAD does not send all 500 rows to the model on every live turn. That would waste tokens, add latency, and over-bias speech recognition.

The live sermon pipeline uses the normalized runtime coverage layer in `src/interpreter/glossary/community-glossary.ts`. `src/interpreter/glossary/matcher.ts` finds only terms that are actually present in the current Korean segment, with session/prep terminology and the hand-curated theological lexicon taking priority. `src/interpreter/prompts/live.ts` then injects those matched terms into the interpretation context.

For speech recognition, `src/interpreter/glossary/stt-hints.ts` selects a small high-value subset. Session-specific names and terminology come first, then glossary terms detected in the day's prep material, then a conservative sermon baseline. This keeps the glossary useful for Korean recognition without blindly biasing the recognizer with hundreds of irrelevant keyterms.

### Updating

When a source workbook changes, preserve its full rows here first, and update the counts above and in `source-dataset.test.ts` to match the file actually committed. Runtime normalization should continue to merge duplicate Korean headwords while retaining alternate English renderings. If a future edition is ever adopted as the runtime source, regenerate `community-glossary.ts` from it in the same change — the two drifting apart silently is what this note exists to prevent.
