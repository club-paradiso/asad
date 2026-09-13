/**
 * Shared prompt building blocks.
 *
 * Prompts live here, in dedicated modules — never inline in a React component.
 *
 * SIZE IS A FEATURE HERE, and the reason is measured rather than aesthetic.
 * The live path dispatches ~11 times a minute for 45 minutes, and the system
 * prompt is sent on every one of those calls while changing on none of them.
 * It was ~1,700 tokens of a ~2,700-token call: roughly two thirds of the
 * entire workload, re-billed ~500 times a service.
 *
 * Three things came out of that, in the order they mattered:
 *
 *  1. **The static term glossary was deleted.** The sermon prompt used to list
 *     fifteen theological terms and five church roles on every call. The local
 *     matcher in `glossary/` already scans each segment against 90+ entries
 *     and injects the ones actually present into the user turn. Sending a
 *     fixed subset unconditionally was paying for the worse version of a
 *     feature that already existed.
 *  2. **Rationale was cut; rules were kept.** A model does not behave
 *     differently for being told why a rule exists. The human reader who does
 *     need the reasoning has these comments, which cost nothing at runtime.
 *  3. **The core is byte-identical across layers**, so a provider's prompt
 *     cache sees the same prefix whichever layer a session runs in.
 *
 * LANGUAGE PAIRS. The contract used to say "Korean into English" in its first
 * line and teach Korean's delayed predicate to every session, including one
 * listening to Mandarin. It is now a function of the pair: the first line
 * names source → target, the Korean-specific scaffolding appears only for a
 * Korean source, and a target-writing line from `languages/writing-guidance`
 * says which script to write in. The pair is fixed for a session, so the
 * system prompt is still constant per session and still cache-friendly. For
 * Korean → English the bytes are exactly what they were, which is what the
 * `CORE_CONTRACT` constant and the prompt tests pin.
 *
 * What did NOT change is the behaviour contract: priority order, delayed
 * predicate scaffolding, the anticipation safety rules, the never-invent-
 * Scripture rule and the wordplay worked example are all still here, because
 * each of them is load-bearing and the benchmark says so.
 *
 * Priority order, in the order the model must resolve conflicts:
 *   1. semantic fidelity
 *   2. zero hallucination
 *   3. spoken naturalness
 *   4. interpretability (can a human say this while listening?)
 *   5. latency (fewer, shorter chunks)
 *   6. brevity
 */
import {
  canonicalPair,
  DEFAULT_LANGUAGE_PAIR,
  languageBase,
  languageDisplayName,
  languageScript,
  type LanguagePairIds,
} from "@/languages/registry";
import { sourceSpeechGuidance, targetWritingGuidance } from "@/languages/writing-guidance";

/** The pair-dependent names every prompt module needs. */
export interface PairNames {
  pair: LanguagePairIds;
  /** English display names, e.g. "Korean", "Chinese (Traditional)". */
  source: string;
  target: string;
  /** Upper-cased for section headings. */
  SOURCE: string;
  TARGET: string;
  /** Whether the source is Korean: the delayed-predicate and honorific material applies. */
  koreanSource: boolean;
  /** Whether the target is English: the worked examples are already in the target. */
  englishTarget: boolean;
  /** Whether the target writes in Latin script, so Korean names are romanised rather than transcribed. */
  latinTarget: boolean;
}

export function pairNames(pair: Partial<LanguagePairIds> | undefined): PairNames {
  const canonical = canonicalPair(pair);
  const source = languageDisplayName(canonical.source);
  const target = languageDisplayName(canonical.target);
  return {
    pair: canonical,
    source,
    target,
    SOURCE: source.toUpperCase(),
    TARGET: target.toUpperCase(),
    koreanSource: languageBase(canonical.source) === "ko",
    englishTarget: languageBase(canonical.target) === "en",
    latinTarget: languageScript(canonical.target) === "Latn",
  };
}

/**
 * The delayed-predicate section. Korean holds the verb to the end; the
 * target language cannot wait. Only a Korean source gets this.
 */
function koreanDirection(names: PairNames): string {
  const example = names.englishTarget
    ? `  제가 오늘 여러분과 나누고 싶은 것은... → "Today I'd like to talk with you about..."`
    : `  제가 오늘 여러분과 나누고 싶은 것은... → open the topic frame in ${names.target} ("what I want to share with you today is...") and stop there.`;
  return `KOREAN → ${names.TARGET}
Korean holds the predicate, and often the payload, until the end. ${names.target} cannot wait. Commit to the STRUCTURE without committing to unresolved content:
${example}
Never invent the payload just to finish a sentence. An honest unfinished scaffold beats a fluent guess.
Compress spoken padding (여러분, 정말, 사실, 다시 한번, 어떻게 보면). BUT preserve deliberate repetition — a refrain or a three-fold build is the rhetoric, not padding.
우리 is collective: "our team", "our church" — not "my".`;
}

/** The same discipline for any other source: commit to structure, never to payload. */
function genericDirection(names: PairNames): string {
  return `${names.SOURCE} → ${names.TARGET}
Spoken ${names.source} arrives in fragments, and the recogniser may cut mid-clause. Commit to the ${names.target} STRUCTURE the source has already fixed, never to content it has not yet resolved.
Never invent the payload just to finish a sentence. An honest unfinished scaffold beats a fluent guess.
Compress false starts and spoken padding. BUT preserve deliberate repetition — a refrain or a three-fold build is the rhetoric, not padding.
Keep the speaker's "we" collective; do not turn it into "I".`;
}

function nameRule(names: PairNames): string {
  if (names.koreanSource && names.latinTarget) {
    const settled = names.englishTarget
      ? "Once an English form is settled, reuse it exactly."
      : `Once a ${names.target} form is settled, reuse it exactly.`;
    return `Romanise a new Korean name with Revised Romanisation: 류정길 → "Ryu Jeong-gil". ${settled}`;
  }
  if (names.koreanSource) {
    return `Render a new Korean name the way ${names.target} conventionally does. Once a ${names.target} form is settled, reuse it exactly.`;
  }
  return `Carry a new name in the form ${names.target} conventionally uses; transliterate only when useful. Once a ${names.target} form is settled, reuse it exactly.`;
}

/** Script/orthography lines, when the pair needs them. Nothing for Korean → English. */
function writingGuidance(names: PairNames): string | null {
  const lines = [targetWritingGuidance(names.pair.target), sourceSpeechGuidance(names.pair.source)].filter(
    (line): line is string => !!line,
  );
  return lines.length ? lines.join("\n") : null;
}

/**
 * The layer-independent contract for a language pair.
 *
 * Identical bytes for the sermon and general layers of the same pair, which
 * is what makes it cacheable across a session rather than per turn.
 */
export function coreContract(pair: Partial<LanguagePairIds> | undefined = DEFAULT_LANGUAGE_PAIR): string {
  const names = pairNames(pair);
  const sections = [
    `You are the language-support layer of tong-yuck, a live copilot for a HUMAN simultaneous interpreter working ${names.source} into ${names.target}. You are NOT the interpreter: you never address the audience and never explain yourself. Everything you emit is read peripherally, in under a second, while they are already speaking.`,

    `PRIORITIES — higher wins on conflict
1 semantic fidelity · 2 zero hallucination · 3 spoken naturalness · 4 low working-memory load · 5 latency · 6 brevity`,

    `CHUNKS
Short thought units, one breath group each, 3–12 words. Each must be sayable alone and join naturally to the next. Split long sentences; never emit literary prose. Trailing "..." only when the thought is genuinely unfinished. 2–4 chunks per turn is normal; more than six is almost always wrong.`,

    names.koreanSource ? koreanDirection(names) : genericDirection(names),

    writingGuidance(names),

    `UNCERTAINTY
Set confidence per chunk: high, medium or low.
If a name, number, date or reference was not clearly recognised, do NOT guess it. Use a safe generic ("that passage", "this person") and mark the chunk low.
Omission beats invention. A missing detail costs a beat; a fabricated one costs credibility.
Never supply the wording of a quotation, verse or document that was not given to you — name it, do not recite it.
${nameRule(names)}`,

    `ANTICIPATION
anticipatedChunks predict what the speaker is about to say, from the unresolved tail. They are displayed as provisional.
Only predict when the ${names.source} is genuinely mid-thought. At most two, short.
Never predict a reference, a number, a name or a quotation.
If you are not clearly better than a coin flip, return none.`,
  ];
  return sections.filter((section): section is string => !!section).join("\n\n");
}

/**
 * The Korean → English contract, byte-identical to the one measured in
 * production before the prompts became pair-aware. Tests pin it.
 */
export const CORE_CONTRACT = coreContract(DEFAULT_LANGUAGE_PAIR);

export const OUTPUT_CONTRACT = `OUTPUT
Reply with a single JSON object and nothing else. No prose, no code fence.

{
  "safeChunks":        [{ "text": string, "confidence": "high"|"medium"|"low", "note"?: string, "adapted"?: boolean }],
  "anticipatedChunks": [{ "text": string, "confidence": "high"|"medium"|"low" }],
  "bibleReferences":   [{ "book": string, "chapter": number, "verse"?: number, "display": string, "confidence": "high"|"medium"|"low" }],
  "glossary":          [{ "korean": string, "english": string, "note"?: string }],
  "culturalNotes":     [{ "kind": "wordplay"|"idiom"|"cultural"|"honorific"|"hanja"|"humour", "korean": string, "note": string, "suggestion"?: string }],
  "entities":          [{ "korean": string, "english": string, "kind": "person"|"place"|"organisation"|"work"|"other" }],
  "confidence":        "high"|"medium"|"low",
  "topic":             string
}

Only "safeChunks" and "confidence" are required. Omit an array rather than sending an empty one. Keep every "note" under 100 characters.`;

/**
 * Short form for providers that enforce the JSON schema natively.
 *
 * Restating a shape the provider is already validating is ~190 tokens of
 * duplicated effort on every call.
 */
export const OUTPUT_CONTRACT_SCHEMA_ENFORCED = `OUTPUT
Reply with a single JSON object matching the supplied schema and nothing else. No prose, no code fence. Only "safeChunks" and "confidence" are required; omit an array rather than sending an empty one. Keep every "note" under 100 characters.`;

/**
 * Rendered context block shared by every live prompt.
 *
 * WIRE FIELD NAMES. `korean` / `english` on glossary, entity and correction
 * items, and `recentKorean` / `recentEnglish`, mean SOURCE and TARGET. They
 * were named when the product spoke one pair and are kept so stored sessions,
 * prep sheets and the model's own output schema stay valid. The rendered
 * labels use the real language names; only the JSON keys carry the history.
 */
export function contextBlock(
  context: {
    summary?: string;
    topic?: string;
    recentKorean: string[];
    recentEnglish: string[];
    glossary: Array<{ korean: string; english: string; note?: string }>;
    entities: Array<{ korean: string; english: string }>;
    scripture: string[];
    corrections: Array<{ from: string; to: string; english?: string }>;
    prep?: {
      speaker?: string;
      title?: string;
      organisation?: string;
      scripture?: string;
      notes?: string;
    };
  },
  pair: Partial<LanguagePairIds> | undefined = DEFAULT_LANGUAGE_PAIR,
): string {
  const names = pairNames(pair);
  const lines: string[] = [];

  if (context.prep) {
    const p = context.prep;
    const bits = [
      p.speaker && `speaker: ${p.speaker}`,
      p.title && `title: ${p.title}`,
      p.organisation && `venue: ${p.organisation}`,
      p.scripture && `main passage: ${p.scripture}`,
    ].filter(Boolean);
    if (bits.length) lines.push(`SESSION: ${bits.join(" · ")}`);
    if (p.notes) lines.push(`PREP NOTES: ${p.notes}`);
  }

  if (context.summary) lines.push(`EARLIER: ${context.summary}`);
  if (context.topic) lines.push(`CURRENT TOPIC: ${context.topic}`);

  if (context.corrections.length) {
    lines.push(
      `USER CORRECTIONS (absolute — the interpreter overruled the recogniser, honour these):\n${context.corrections
        .map((c) => `  ${c.from} → ${c.to}${c.english ? ` = "${c.english}"` : ""}`)
        .join("\n")}`,
    );
  }

  if (context.entities.length) {
    lines.push(
      `NAMES ALREADY SETTLED (reuse these exact ${names.target} forms):\n${context.entities
        .map((e) => `  ${e.korean} = ${e.english}`)
        .join("\n")}`,
    );
  }

  if (context.glossary.length) {
    lines.push(
      `TERMS ALREADY SETTLED (stay consistent):\n${context.glossary
        .map((g) => `  ${g.korean} → ${g.english}${g.note ? ` (${g.note})` : ""}`)
        .join("\n")}`,
    );
  }

  if (context.scripture.length) {
    lines.push(`PASSAGES SO FAR: ${context.scripture.join(", ")}`);
  }

  if (context.recentKorean.length) {
    lines.push(`RECENT ${names.SOURCE}:\n${context.recentKorean.map((k) => `  ${k}`).join("\n")}`);
  }

  if (context.recentEnglish.length) {
    lines.push(
      `${names.TARGET} ALREADY DELIVERED (do not repeat, continue from here):\n${context.recentEnglish
        .map((e) => `  ${e}`)
        .join("\n")}`,
    );
  }

  return lines.join("\n\n");
}
