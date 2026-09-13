import { z } from "zod";
import { interpretRequestSchema, languageTagSchema, resolvedContextSchema } from "./schema";
import { RESCUE_MAX_CHARS } from "@/interpreter/engine/rescue";

/** Request body accepted by POST /api/rescue. */
export const rescueRequestSchema = z.object({
  context: resolvedContextSchema,
  source: languageTagSchema.default("ko-KR"),
  target: languageTagSchema.default("en-US"),
  /** Already bounded to the most recent stable source speech by the client. */
  recentKorean: z.string().trim().min(1).max(RESCUE_MAX_CHARS),
  /** Reuse the same rolling-context trust boundary as ordinary live turns. */
  history: interpretRequestSchema.shape.history,
});

export type RescueRequest = z.infer<typeof rescueRequestSchema>;
