/**
 * JSON Schema for the interpretation output, for providers that can enforce a
 * schema natively (Gemini `responseJsonSchema`, OpenAI-compatible
 * `response_format: json_schema`).
 *
 * This mirrors `interpreterOutputSchema` in `src/lib/schema.ts`, which remains
 * the trust boundary — a provider claiming schema support is not the same as a
 * provider honouring it, so Zod validates the result either way. The value of
 * this file is that it makes valid output far more likely, not that it makes
 * validation unnecessary.
 *
 * Kept deliberately shallow: deeply nested schemas cost tokens on every call
 * and some providers reject constructs like `additionalProperties: false` on
 * nested objects when `strict` is set.
 */

const chunk = {
  type: "object",
  properties: {
    text: { type: "string", description: "One short spoken thought unit." },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    note: { type: "string", description: "Short interpreter-facing hint." },
    adapted: { type: "boolean", description: "True when adapted rather than literal." },
  },
  required: ["text", "confidence"],
  additionalProperties: false,
} as const;

export const INTERPRETER_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    safeChunks: { type: "array", items: chunk, maxItems: 8 },
    anticipatedChunks: { type: "array", items: chunk, maxItems: 3 },
    bibleReferences: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          book: { type: "string" },
          chapter: { type: "integer" },
          verse: { type: "integer" },
          display: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["book", "chapter", "display", "confidence"],
        additionalProperties: false,
      },
    },
    glossary: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          korean: { type: "string" },
          english: { type: "string" },
          note: { type: "string" },
        },
        required: ["korean", "english"],
        additionalProperties: false,
      },
    },
    culturalNotes: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["wordplay", "idiom", "cultural", "honorific", "hanja", "humour"],
          },
          korean: { type: "string" },
          note: { type: "string" },
          suggestion: { type: "string" },
        },
        required: ["kind", "korean", "note"],
        additionalProperties: false,
      },
    },
    entities: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          korean: { type: "string" },
          english: { type: "string" },
          kind: {
            type: "string",
            enum: ["person", "place", "organisation", "work", "other"],
          },
        },
        required: ["korean", "english", "kind"],
        additionalProperties: false,
      },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    topic: { type: "string" },
  },
  required: ["safeChunks", "confidence"],
  additionalProperties: false,
};
