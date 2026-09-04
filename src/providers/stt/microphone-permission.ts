/**
 * Counter microphone permission helpers.
 *
 * Permission can be prepared explicitly before a conversation, but it is never
 * required to enter one. Text-only users should not see a native microphone
 * prompt they did not ask for. When voice is chosen, the same helper completes
 * the browser handshake and immediately releases its probe stream. No audio
 * frames are read, buffered, uploaded, or persisted by this module.
 */
export type MicrophonePermissionReadiness = "granted" | "denied" | "unavailable";
export type MicrophonePermissionState = MicrophonePermissionReadiness | "prompt";

let grantedInPage = false;

async function queryMicrophonePermission(): Promise<PermissionState | null> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return null;
  try {
    return (
      await navigator.permissions.query({ name: "microphone" as PermissionName })
    ).state;
  } catch {
    // Safari/WebKit and older browsers may expose Permissions without accepting
    // the microphone descriptor. getUserMedia remains the authoritative path.
    return null;
  }
}

/** Read the current permission posture without causing a browser prompt. */
export async function getMicrophonePermissionState(): Promise<MicrophonePermissionState> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "unavailable";
  }

  const known = await queryMicrophonePermission();
  if (known === "granted") {
    grantedInPage = true;
    return "granted";
  }
  if (known === "denied") {
    grantedInPage = false;
    return "denied";
  }

  // Browsers that do not expose microphone permission through Permissions API
  // still benefit from the successful in-page handshake cache.
  return grantedInPage ? "granted" : "prompt";
}

export async function ensureMicrophonePermission(): Promise<MicrophonePermissionReadiness> {
  const mediaDevices =
    typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) return "unavailable";

  const known = await queryMicrophonePermission();
  if (known === "granted") {
    grantedInPage = true;
    return "granted";
  }
  if (known === "denied") {
    grantedInPage = false;
    return "denied";
  }
  if (grantedInPage) return "granted";

  try {
    const stream = await mediaDevices.getUserMedia({ audio: true });
    // This probe exists only to complete the browser permission flow. The real
    // recogniser opens its own capture path once STT is ready.
    for (const track of stream.getTracks()) track.stop();
    grantedInPage = true;
    return "granted";
  } catch (error) {
    grantedInPage = false;
    if (
      error instanceof DOMException &&
      (error.name === "NotAllowedError" || error.name === "SecurityError")
    ) {
      return "denied";
    }
    return "unavailable";
  }
}

/** Test seam. */
export function __resetMicrophonePermissionReadiness() {
  grantedInPage = false;
}
