import type { SttProviderId } from "@/providers/stt";

/**
 * Pick the best automatic input source for the launcher.
 *
 * An explicitly configured cloud recogniser wins because it is the deployment
 * operator's deliberate choice. Otherwise the browser-native recogniser is the
 * zero-configuration live path. Demo is a last resort, not a production
 * default merely because STT_PROVIDER was never changed in Vercel.
 */
export function preferredSttSource({
  browserSttAvailable,
  cloudAvailable,
  configured,
}: {
  browserSttAvailable: boolean;
  cloudAvailable: boolean;
  configured?: SttProviderId;
}): SttProviderId {
  if (cloudAvailable && configured) return configured;
  if (browserSttAvailable) return "webspeech";
  return "demo";
}
