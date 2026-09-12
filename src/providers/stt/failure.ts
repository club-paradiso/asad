/**
 * What a recogniser failure says to the person in the booth.
 *
 * The console used to surface `Speech recognition error: service-not-allowed`,
 * which is the browser's word for it and no help at all to an interpreter who
 * is standing up, mid-service, with a room waiting. Every message here answers
 * the three questions they actually have, in that order:
 *
 *   what is wrong · can I keep interpreting · what do I do about it
 *
 * The code stays out of the sentence. It is still on `/diagnostics` and in the
 * console log for whoever is debugging the deployment, which is not the person
 * reading this string.
 */

/** Web Speech API error codes we have copy for. */
const MESSAGES: Record<string, string> = {
  "not-allowed":
    "Microphone access was refused. Allow it in the browser's site settings, then tap Try again.",
  "service-not-allowed":
    "The browser's speech service refused this session. Reload the page, then tap Try again.",
  "language-not-supported":
    "This browser cannot recognise Korean. Chrome on a laptop is the reliable option.",
  "language-unavailable":
    "This browser cannot recognise Korean. Chrome on a laptop is the reliable option.",
  "audio-capture":
    "The microphone stopped sending audio. Check nothing else is using it, then tap Try again.",
  network:
    "Speech recognition lost its connection. Check the network, then tap Try again.",
};

const FALLBACK =
  "Speech recognition stopped. Tap Try again to resume — English already on screen is kept.";

const EXHAUSTED =
  "Speech recognition could not recover after several tries. Tap Try again, or pick a different input on the start screen.";

/**
 * @param code   the recogniser's own error code
 * @param spent  true when the automatic retry budget is gone, so "it will sort
 *               itself out" is no longer true and the interpreter has to act
 */
export function speechFailureMessage(code: string, spent = false): string {
  if (spent) return EXHAUSTED;
  return MESSAGES[code] ?? FALLBACK;
}
