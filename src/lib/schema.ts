/**
 * Zod schemas for everything that crosses a trust boundary — model output and
 * API request/response bodies.
 *
 * Rule: the live console must survive malformed model output. Parsing is
 * always `safeParse`; a failure degrades the LLM subsystem and leaves the
 * Korean transcript running, it never throws into React.
 */
import { z } from "zod";

export const confidenceSchema = z.enum(["high", "medium", "low"]);

export const modeSchema = z.enum(["sermon", "general"]);

export const lagSchema = z.enum(["fast", "balanced", "safe"]);

export const chunkDraftSchema = z.object({
  text: z.string().min(1).max(400),
  confidence: confidenceSchema.default("medium"),
  note: z.string().max(160).optional(),
  adapted: z.boolean().optional(),
  sourceSegmentId: z.string().optional(),
  correctsChunkId: z.string().optional(),
});

export const bibleReferenceSchema = z.object({
  book: z.string().min(1),
  chapter: z.number().int().positive(),
  verse: z.number().int().positive().optional(),
  verseEnd: z.number().int().positive().optional(),
  display: z.string().min(1),
  koreanRaw: z.string().optional(),
  confidence: confidenceSchema.default("medium"),
  text: z.string().optional(),
  translation: z.string().optional(),
});

export const glossaryItemSchema = z.object({
  korean: z.string().min(1),
  english: z.string().min(1),
  note: z.string().max(160).optional(),
  alternatives: z.array(z.string()).max(4).optional(),
  source: z.enum(["prep", "lexicon", "live"]).optional(),
  register: z.boolean().optional(),
});

export const culturalNoteSchema = z.object({
  kind: z.enum(["wordplay", "idiom", "cultural", "honorific", "hanja", "humour"]),
  korean: z.string().min(1),
  note: z.string().min(1).max(240),
  suggestion: z.string().max(240).optional(),
});

export const entitySchema = z.object({
  korean: z.string().min(1),
  english: z.string().min(1),
  kind: z.enum(["person", "place", "organisation", "work", "other"]).default("other"),
  note: z.string().max(160).optional(),
});

/** The contract the interpretation model must satisfy. */
export const interpreterOutputSchema = z.object({
  safeChunks: z.array(chunkDraftSchema).max(8).default([]),
  anticipatedChunks: z.array(chunkDraftSchema).max(3).optional(),
  bibleReferences: z.array(bibleReferenceSchema).max(6).optional(),
  glossary: z.array(glossaryItemSchema).max(10).optional(),
  culturalNotes: z.array(culturalNoteSchema).max(4).optional(),
  entities: z.array(entitySchema).max(8).optional(),
  confidence: confidenceSchema.default("medium"),
  topic: z.string().max(120).optional(),
});

export type ParsedInterpreterOutput = z.infer<typeof interpreterOutputSchema>;

/** Request body accepted by `POST /api/interpret`. */
export const interpretRequestSchema = z.object({
  mode: modeSchema,
  lag: lagSchema,
  /** Newly stabilised Korean awaiting interpretation. */
  pending: z.string().min(1).max(4000),
  /** Unstable tail, used only for anticipation. */
  partial: z.string().max(1000).optional(),
  context: z.object({
    summary: z.string().max(2000).optional(),
    topic: z.string().max(120).optional(),
    recentKorean: z.array(z.string()).max(12).default([]),
    recentEnglish: z.array(z.string()).max(12).default([]),
    glossary: z.array(glossaryItemSchema).max(24).default([]),
    entities: z.array(entitySchema).max(16).default([]),
    scripture: z.array(z.string()).max(8).default([]),
    corrections: z
      .array(z.object({ from: z.string(), to: z.string(), english: z.string().optional() }))
      .max(16)
      .default([]),
    prep: z
      .object({
        speaker: z.string().optional(),
        title: z.string().optional(),
        organisation: z.string().optional(),
        scripture: z.string().optional(),
        notes: z.string().max(2000).optional(),
      })
      .optional(),
  }),
  /** Detected references resolved locally, passed as hints. */
  detected: z
    .object({
      scripture: z.array(bibleReferenceSchema).max(4).default([]),
      glossary: z.array(glossaryItemSchema).max(8).default([]),
      culturalNotes: z.array(culturalNoteSchema).max(4).default([]),
    })
    .optional(),
  allowAnticipation: z.boolean().default(true),
});

export type InterpretRequest = z.infer<typeof interpretRequestSchema>;

/** Request body accepted by `POST /api/prep`. */
export const prepRequestSchema = z.object({
  mode: modeSchema,
  speaker: z.string().max(120).optional(),
  title: z.string().max(240).optional(),
  organisation: z.string().max(160).optional(),
  scripture: z.string().max(160).optional(),
  notes: z.string().max(8000).optional(),
  outline: z.string().max(20000).optional(),
});

export const prepBriefSchema = z.object({
  overview: z.string().default(""),
  likelyStructure: z.array(z.string()).max(12).default([]),
  keyTerms: z.array(glossaryItemSchema).max(24).default([]),
  scripture: z.array(bibleReferenceSchema).max(12).default([]),
  properNouns: z.array(entitySchema).max(16).default([]),
  difficultPoints: z.array(z.string()).max(12).default([]),
  anticipatedPhrases: z
    .array(z.object({ korean: z.string(), english: z.string() }))
    .max(16)
    .default([]),
  pronunciation: z
    .array(z.object({ korean: z.string(), english: z.string() }))
    .max(16)
    .default([]),
});

/**
 * Pull the first balanced JSON object out of a model response that may be
 * wrapped in prose or a fenced code block, then validate it.
 *
 * Returns `null` rather than throwing — a bad model turn must not end the
 * session.
 */
export function parseInterpreterOutput(raw: string): ParsedInterpreterOutput | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const result = interpreterOutputSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Extract the first balanced `{...}` block, ignoring braces inside strings. */
export function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}
