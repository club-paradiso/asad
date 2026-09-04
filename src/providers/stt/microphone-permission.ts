/**
 * Counter microphone permission handshake.
 *
 * The first mic tap should not make the user guess whether ASAD is already
 * listening while a browser permission sheet is still on screen. We request
 * permission from the same explicit tap, immediately release the probe stream,
 * and let the pending voice action continue only after the browser has decided.
 * No audio frames are read, buffered, uploaded, or persisted here.
 */
export type MicrophonePermissionReadiness = "granted" | "denied" | "unavailable";

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

export async function ensureMicrophonePermission(): Promise<MicrophonePermissionReadiness> {
  if (grantedInPage) return "granted";
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "unavailable";
  }

  const known = await queryMicrophonePermission();
  if (known === "denied") return "denied";
  if (known === "granted") {
    grantedInPage = true;
    return "granted";
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // This probe exists only to complete the browser permission flow. The real
    // recogniser opens its own capture path once STT is ready.
    for (const track of stream.getTracks()) track.stop();
    grantedInPage = true;
    return "granted";
  } catch (error) {
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
