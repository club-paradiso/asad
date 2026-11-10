# Bilingual reviewer workflow

The administrative layer has **not** been externally validated. This is the
procedure that would change that. Until it has been followed, nothing in the
registry may be marked `verified`, and no benchmark result may be described as
validated.

## Who

- One reviewer per language. Native or near-native in that language, fluent
  in Korean, and familiar with immigration-office usage.
- Independent: not the author of the registry entries or corpus lines under
  review.
- For legal terminology: a second reviewer with Korean administrative-law
  background checks the Korean side.

## What they review

1. **Registry terms** (`src/counter/admin/registry.ts`), per language:
   - Is `term` what a visitor from that community would recognise for this
     procedure?
   - Is there an official rendering? Examples: a Korea Immigration Service
     multilingual page, an official form translation, or a Ministry of
     Justice guide. Record the URL and the date it was read.
   - Are the colloquial, ASR-error and MT-error variants real, and are they
     correctly classed?
   - Is anything missing that people actually say at the desk?
2. **Clarification questions** (`AMBIGUITY_RULES` in `meaning.ts`): are they
   neutral? Do they avoid presupposing an answer and avoid legal advice?
3. **Benchmark lines** (`benchmarks/counter/admin-corpus.ts`): is each
   "faithful" rendering faithful? Is each "corrupted" rendering really the
   stated defect?
4. **Live outputs.** Take a sample of real model translations generated from
   the synthetic corpus (never applicant data). Grade them on the rubric
   below.

## Rubric for live outputs

| Score | Meaning |
| --- | --- |
| 0 — critical | Changes a legal or administrative consequence (must/may, procedure, status, deadline, actor) |
| 1 — major | Wrong or misleading term; dropped condition; changed certainty |
| 2 — minor | Unnatural or inconsistent wording, meaning intact |
| 3 — acceptable | Faithful and natural for a service counter |

For each output, also record whether the automatic assessment
(`passed / review / blocked / unverified`) agreed with the human score. That
gives the validator's real recall and false-alarm rate on model output, which
the current benchmark cannot provide.

## Recording a review

To promote a term from `provisional` or `curated` to `verified`, set:

- `terms[lang].status = "verified"`
- `review = { state: "reviewed", reviewer: "<name or role>", reviewedOn: "YYYY-MM-DD" }`
- `reference.revisedOn` set to the date the source was read, and `reference.url`
  set to that source

`registry.test.ts` rejects a `verified` term without all three. Put the review
notes in the pull request.

## Sample size guidance

To claim, say, ≥99% critical-error recall with a 95% lower bound above 95%,
you need on the order of 100+ independent critical cases **per claim**, all
caught. The current 21 synthetic cases support a lower bound of 84.5% and no
more.

## Data rules

- Synthetic text only. No applicant records, names, numbers, case files or
  recordings.
- Reviewers work from the repository files. They do not receive a production
  export.
