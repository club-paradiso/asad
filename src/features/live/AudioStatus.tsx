"use client";

/**
 * The audio glyph in the status strip.
 *
 * One microphone icon whose colour and (very) subtle pulse say whether the
 * console is hearing anything. No level meter, no waveform: a meter is a thing
 * the eye tracks, and the interpreter's eye must stay on the line they are
 * reading. The glyph answers exactly one question at a glance — "is it
 * listening?" — and the tooltip and accessible name answer it in words.
 */
import type { AudioActivity } from "./useLiveSession";
import { cn } from "@/lib/cn";

const LABEL: Record<AudioActivity, string> = {
  off: "Microphone off",
  "mic-active": "Microphone open",
  speech: "Hearing speech",
  silence: "Microphone open, hearing silence",
  reconnecting: "Audio reconnecting",
  unavailable: "Audio input unavailable",
};

export const audioStatusLabel = (activity: AudioActivity): string => LABEL[activity];

const TONE: Record<AudioActivity, string> = {
  off: "text-[var(--fg-dim)] opacity-50",
  "mic-active": "text-[var(--fg-muted)]",
  speech: "text-[var(--ok)] pulse-soft",
  silence: "text-[var(--fg-dim)]",
  reconnecting: "text-[var(--warn)] pulse-live",
  unavailable: "text-[var(--danger)]",
};

export function AudioStatus({
  activity,
  className,
}: {
  activity: AudioActivity;
  className?: string;
}) {
  const label = LABEL[activity];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-audio={activity}
      className={cn("inline-grid size-5 shrink-0 place-items-center", TONE[activity], className)}
    >
      <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden>
        <rect x="7" y="2.5" width="6" height="9.5" rx="3" fill="currentColor" />
        <path
          d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7.5 17.5h5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        {activity === "unavailable" && (
          <path d="M3.5 3.5l13 13" stroke="var(--bg)" strokeWidth="3.4" strokeLinecap="round" />
        )}
        {activity === "unavailable" && (
          <path d="M3.5 3.5l13 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        )}
      </svg>
    </span>
  );
}
