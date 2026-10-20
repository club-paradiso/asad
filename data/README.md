# Source datasets

## Christian Korean-English glossary

`christian-glossary-500.tsv` is the source-preservation copy of the supplied **기독교 영단어 500개** workbook.

- 500 numbered source rows
- 10 source categories, 50 rows each
- 447 unique Korean headwords across 53 repeated rows
- duplicate Korean headwords are intentionally preserved here because some rows carry alternate English renderings or context

### This file and the runtime layer must agree

`src/interpreter/glossary/community-glossary.ts` is generated from this file,
and `src/interpreter/glossary/source-dataset.test.ts` asserts that the two carry
exactly the same 447 Korean headwords. That assertion is the reason the archive
is in the repository at all: a workbook and a runtime layer drifting apart
silently is the failure it exists to catch.

So a new workbook is never a data-only change. Replace the TSV, regenerate
`community-glossary.ts` from it, and move the counts here and in the test in the
same commit — otherwise the suite goes red for every branch in the repository,
which is exactly what happened once already.

### Runtime use

ASAD does not send all 500 rows to the model on every live turn. That would waste tokens, add latency, and over-bias speech recognition.

The live sermon pipeline uses the normalized runtime coverage layer in `src/interpreter/glossary/community-glossary.ts`. `src/interpreter/glossary/matcher.ts` finds only terms that are actually present in the current Korean segment, with session/prep terminology and the hand-curated theological lexicon taking priority. `src/interpreter/prompts/live.ts` then injects those matched terms into the interpretation context.

## Theological glossary pack (church-interpreter standard)

`theological-glossary.json` is the curated standard for Korean-church interpreter
volunteers: Korean theological headwords → standard English AND Chinese
renderings, each with a category (`구원론`, `교리`, `예배`, `성경`, `직분`,
`교회생활`) and a translator's note. Minimum 60 entries, enforced at import
time by `src/interpreter/glossary/theological-glossary.ts` (zod-validated;
duplicates and short packs fail loudly).

Priority at match time, in order:

1. session/prep terminology (the interpreter's explicit choice for the day)
2. **this pack** — the standard rendering
3. the hand-curated theological lexicon (donates notes/alternatives where the
   pack is silent)
4. the volunteer community glossary

The pack is active in worship contexts only, like the theological lexicon. It
also feeds `worshipTermHits`, the terminology-density signal the context
resolver reads. `theological-glossary.test.ts` pins the entry count, the
schema, and the priority order — a data edit that breaks the contract goes red
here, not in a live service.

For speech recognition, `src/interpreter/glossary/stt-hints.ts` selects a small high-value subset. Session-specific names and terminology come first, then glossary terms detected in the day's prep material, then a conservative sermon baseline. This keeps the glossary useful for Korean recognition without blindly biasing the recognizer with hundreds of irrelevant keyterms.

### Updating

When the source workbook changes, preserve its full rows here first, regenerate
`community-glossary.ts` from them, and update the counts above and in
`source-dataset.test.ts` to match the file actually committed — all in one
change. Runtime normalization should continue to merge duplicate Korean
headwords while retaining alternate English renderings.
