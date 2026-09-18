/**
 * The label a recovery route reports itself under.
 *
 * Its own module because both sides of the wire need it and neither may import
 * the other: `live-recovery.ts` is `server-only` because it holds credentials,
 * and the console has to recognise the label in a response body to tell the
 * interpreter that a backup model is answering. A string constant is the whole
 * of the shared surface.
 */
export const RECOVERY_PROVIDER = "vercel-gateway";
