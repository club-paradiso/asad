"use client";

import type { ReceiverSnapshot } from "@/remote-mic/receiver";

/**
 * One line in the live console when the input is the paired iPhone and it is
 * NOT healthy. Silent when everything is fine — the console's own input meter
 * already says so — and never green while the phone is gone, muted or
 * delivering nothing.
 */
export function remoteMicProblem(remote: ReceiverSnapshot): string | null {
  switch (remote.phase) {
    case "connected":
      if (remote.sender?.muted) return "iPhone microphone is muted on the phone.";
      if (remote.sender?.interrupted) return "iPhone microphone was interrupted by a call or another app.";
      if (remote.trackMuted) return "No audio is arriving from the iPhone.";
      return null;
    case "interrupted":
      return "iPhone connection lost — it is reconnecting. The transcript is kept.";
    case "paused":
      return "iPhone microphone stopped on the phone. Tap Start Microphone on the iPhone to continue.";
    case "failed":
      return "iPhone connection could not be restored. Check Wi-Fi, then reconnect from the phone.";
    case "ended":
    case "error":
    case "idle":
      return "iPhone remote microphone is not connected.";
    default:
      return "iPhone remote microphone is connecting…";
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
