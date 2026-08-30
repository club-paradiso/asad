import { z } from "zod";
import { interpretRequestSchema, modeSchema } from "./schema";
import { RESCUE_MAX_CHARS } from "@/interpreter/engine/rescue";

/** Request body accepted by POST /api/rescue. */
export const rescueRequestSchema = z.object({
  mode: modeSchema,
  /** Already bounded to the most recent stable Korean by the client. */
  recentKorean: z.string().trim().min(1).max(RESCUE_MAX_CHARS),
  /** Reuse the same rolling-context trust boundary as ordinary live turns. */
  context: interpretRequestSchema.shape.context,
});

export type RescueRequest = z.infer<typeof rescueRequestSchema>;
