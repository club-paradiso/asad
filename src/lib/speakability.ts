/**
 * Deterministic speakability guardrails.
 *
 * These do NOT judge translation quality — no regex knows whether English
 * carries the Korean's meaning. What they can do is catch the specific,
 * mechanical ways a model output becomes unusable for a person who has to say
 * it out loud while listening to something else:
 *
 *   - a paragraph where a breath group was needed
 *   - markdown, which is meaningless when spoken
 *   - academic register instead of speech
 *   - the model explaining itself instead of interpreting
 *
 * Used as a benchmark dimension and as a live sanity check, never as a
 * substitute for human review.
 */

export interface SpeakabilityIssue {
  code:
    | "chunk_too_long"
    | "too_many_chunks"
    | "markdown"
    | "meta_commentary"
    | "academic_register"
    | "subordinate_pileup"
    | "repeated_text"
    | "empty_chunk"
    | "unbalanced_quotes";
  severity: "error" | "warning";
  detail: string;
  chunkIndex?: number;
}

export interface SpeakabilityReport {
  /** 0–1; 1 is clean. */
  score: number;
  issues: SpeakabilityIssue[];
  stats: {
    chunks: number;
    meanWordsPerChunk: number;
    maxWordsPerChunk: number;
  };
}

/** A breath group. Beyond this the interpreter cannot hold it while speaking. */
const MAX_WORDS_PER_CHUNK = 16;
const HARD_MAX_WORDS_PER_CHUNK = 24;
/** More than this in one turn means the model is transcribing, not chunking. */
const MAX_CHUNKS = 8;

const MARKDOWN = /(\*\*|__|^#{1,6}\s|^\s*[-*+]\s|`{1,3}|\[[^\]]+\]\([^)]+\))/m;

/** Phrases that mean the model is talking about the task instead of doing it. */
const META_COMMENTARY = [
  /\bhere('s| is) (the|a|my) (translation|interpretation|rendering)/i,
  /\bi (would |will |'ll )?translate\b/i,
  /\bthe korean (says|means|literally)/i,
  /\bnote that\b/i,
  /\bas an ai\b/i,
  /\bin this context,? the (word|phrase|term)\b/i,
  /\bthis (phrase|sentence) (means|refers to)\b/i,
];

/** Register markers that belong in an essay, not in spoken interpretation. */
const ACADEMIC = [
  /\bfurthermore\b/i,
  /\bmoreover\b/i,
  /\bheretofore\b/i,
  /\bthus it (is|can be)\b/i,
  /\bit is worth noting\b/i,
  /\bin conclusion,? it\b/i,
  /\bnotwithstanding\b/i,
];

const SUBORDINATORS = /\b(which|that|whereby|wherein|although|whereas|inasmuch)\b/gi;

export function assessSpeakability(chunks: Array<{ text: string }>): SpeakabilityReport {
  const issues: SpeakabilityIssue[] = [];
  const wordCounts: number[] = [];
  const seen = new Map<string, number>();

  chunks.forEach((chunk, index) => {
    const text = (chunk.text ?? "").trim();

    if (!text) {
      issues.push({ code: "empty_chunk", severity: "error", detail: "Empty chunk.", chunkIndex: index });
      wordCounts.push(0);
      return;
    }

    const words = text.split(/\s+/).filter(Boolean).length;
    wordCounts.push(words);

    if (words > HARD_MAX_WORDS_PER_CHUNK) {
      issues.push({
        code: "chunk_too_long",
        severity: "error",
        detail: `${words} words — a paragraph, not a breath group.`,
        chunkIndex: index,
      });
    } else if (words > MAX_WORDS_PER_CHUNK) {
      issues.push({
        code: "chunk_too_long",
        severity: "warning",
        detail: `${words} words — above the ${MAX_WORDS_PER_CHUNK}-word breath group target.`,
        chunkIndex: index,
      });
    }

    if (MARKDOWN.test(text)) {
      issues.push({
        code: "markdown",
        severity: "error",
        detail: "Contains markdown, which is meaningless spoken aloud.",
        chunkIndex: index,
      });
    }

    for (const pattern of META_COMMENTARY) {
      if (pattern.test(text)) {
        issues.push({
          code: "meta_commentary",
          severity: "error",
          detail: "Explains the translation instead of being the translation.",
          chunkIndex: index,
        });
        break;
      }
    }

    for (const pattern of ACADEMIC) {
      if (pattern.test(text)) {
        issues.push({
          code: "academic_register",
          severity: "warning",
          detail: "Written register rather than spoken.",
          chunkIndex: index,
        });
        break;
      }
    }

    const subordinates = text.match(SUBORDINATORS)?.length ?? 0;
    if (subordinates >= 3) {
      issues.push({
        code: "subordinate_pileup",
        severity: "warning",
        detail: `${subordinates} subordinate clauses in one chunk.`,
        chunkIndex: index,
      });
    }

    const quotes = (text.match(/"/g) ?? []).length;
    if (quotes % 2 !== 0) {
      issues.push({
        code: "unbalanced_quotes",
        severity: "warning",
        detail: "Unbalanced quotation marks.",
        chunkIndex: index,
      });
    }

    const key = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const previous = seen.get(key);
    if (previous !== undefined) {
      issues.push({
        code: "repeated_text",
        severity: "warning",
        detail: `Identical to chunk ${previous + 1}.`,
        chunkIndex: index,
      });
    } else {
      seen.set(key, index);
    }
  });

  if (chunks.length > MAX_CHUNKS) {
    issues.push({
      code: "too_many_chunks",
      severity: "warning",
      detail: `${chunks.length} chunks in one turn — the model is transcribing rather than chunking.`,
    });
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  // Errors are disqualifying; warnings degrade gently.
  const score = Math.max(0, 1 - errors * 0.34 - warnings * 0.08);

  return {
    score: Number(score.toFixed(3)),
    issues,
    stats: {
      chunks: chunks.length,
      meanWordsPerChunk: wordCounts.length
        ? Number((wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length).toFixed(1))
        : 0,
      maxWordsPerChunk: wordCounts.length ? Math.max(...wordCounts) : 0,
    },
  };
}
