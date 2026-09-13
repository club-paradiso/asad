import { z } from "zod";
import { interpretRequestSchema, languagePairSchema, modeSchema } from "./schema";
import { RESCUE_MAX_CHARS } from "@/interpreter/engine/rescue";

/** Request body accepted by POST /api/rescue. */
export const rescueRequestSchema = z.object({
  mode: modeSchema,
  /** Session languages. Defaults preserve the original ko→en contract. */
  languagePair: languagePairSchema.default({ source: "ko-KR", target: "en-US" }),
  /**
   * Already bounded to the most recent stable SOURCE text by the client. The
   * name is the wire field's from when the product spoke one pair.
   */
  recentKorean: z.string().trim().min(1).max(RESCUE_MAX_CHARS),
  /** Reuse the same rolling-context trust boundary as ordinary live turns. */
  context: interpretRequestSchema.shape.context,
});

export type RescueRequest = z.infer<typeof rescueRequestSchema>;
