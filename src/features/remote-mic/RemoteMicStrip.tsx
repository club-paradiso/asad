"use client";

import type { ReceiverSnapshot } from "@/remote-mic/receiver";

/**
 * One line in the live console when the input is the paired phone and it is
 * NOT healthy. Silent when everything is fine — the console's own input meter
 * already says so — and never green while the phone is gone, muted or
 * delivering nothing.
 */
export function remoteMicProblem(remote: ReceiverSnapshot): string | null {
  switch (remote.phase) {
    case "connected":
      if (remote.sender?.muted) return "Phone microphone is muted on the phone.";
      if (remote.sender?.interrupted) return "Phone microphone was interrupted by a call or another app.";
      if (remote.trackMuted) return "No audio is arriving from the phone.";
      return null;
    case "interrupted":
      return "Phone connection lost — it is reconnecting. The transcript is kept.";
    case "paused":
      return "Phone microphone stopped. Tap Start Microphone on the phone to continue.";
    case "failed":
      return "Phone connection could not be restored. Check both devices' internet, then reconnect from the phone.";
    case "ended":
    case "error":
    case "idle":
      return "Phone remote microphone is not connected.";
    default:
      return "Phone remote microphone is connecting…";
  }
}

export function RemoteMicStrip({ remote }: { remote: ReceiverSnapshot }) {
  const problem = remoteMicProblem(remote);
  if (!problem) return null;
  return (
    <div
      role="alert"
      data-testid="remote-mic-strip"
      className="border-b border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[var(--bg-raised)] px-3 py-1.5 text-center text-[0.75rem] font-medium text-[var(--danger)]"
    >
      {problem}
    </div>
  );
}
