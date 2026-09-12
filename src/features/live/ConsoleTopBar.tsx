"use client";

/**
 * The status strip.
 *
 * An instrument panel, not a dashboard. When everything is working this reads
 *
 *     ● Live                                        18:42   ⋯   End
 *
 * and nothing else, because an interpreter mid-sentence cannot act on the
 * provider's name, the lag profile they chose before they started, or whether a
 * request happens to be in flight right now. Every one of those was a thing the
 * eye had to skip over on each glance, and the glance is about a second long.
 *
 * When something IS wrong the strip is the opposite of quiet: it says so in
 * plain language, in the same place, and the colour changes with it. The
 * detailed cause belongs to the error bar over the English and to
 * `/diagnostics` — never here, and never as a provider error string.
 *
 * Interactive controls still keep a 44px touch target; shaving eight pixels off
 * a button is not worth missed taps in the middle of a sentence.
 */
import type { ConnectionState, SubsystemHealth } from "@/types";
import { Button, StatusDot } from "@/components/ui/primitives";
import type { AiState } from "./AiStatus";
import { cn } from "@/lib/cn";

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export interface ConsoleStatus {
  /** Drives the dot and the colour. */
  state: ConnectionState;
  /** One or two words. The only thing guaranteed to be on screen. */
  label: string;
  /**
   * Present only when something is wrong, and then it answers the two
   * questions the interpreter actually has: can I keep going, and is there
   * anything for me to do.
   */
  detail?: string;
  /** False while everything is working, which is almost all of the time. */
  problem: boolean;
}

/**
 * Reduce every subsystem signal to one line an interpreter can read at a
 * glance, worst problem first.
 *
 * Exported and tested directly: "the console is silent when it is working, and
 * says something useful when it is not" is a product rule worth asserting
 * rather than remembering.
 */
export function consoleStatus(input: {
  connection: ConnectionState;
  health: SubsystemHealth;
  ai: AiState;
  /**
   * Demo mode. Its English is scripted, so "there is no model answering" is
   * the arrangement rather than a fault — and the demo ribbon already says so.
   * Warning about it would be the console crying wolf for a whole session.
   */
  scripted?: boolean;
}): ConsoleStatus {
  const { connection, health, ai, scripted = false } = input;

  if (connection === "offline") {
    return {
      state: "offline",
      label: "Offline",
      detail: "No network. Recognition resumes on its own.",
      problem: true,
    };
  }

  if (connection === "error" || health.stt === "down") {
    return {
      state: "error",
      label: "Not listening",
      detail: "Speech recognition stopped. English already on screen is kept.",
      problem: true,
    };
  }

  if (connection === "connecting") {
    return { state: "connecting", label: "Connecting", problem: false };
  }

  if (connection === "reconnecting" || health.stt === "degraded") {
    return {
      state: "reconnecting",
      label: "Reconnecting",
      detail: "Audio is held while it retries. Nothing on screen is lost.",
      problem: true,
    };
  }

  // `local` is the deterministic interpreter, not a small translator: the
  // English is assembled from rules and is not a translation of the sentence.
  // That is the single most important thing the console can tell an
  // interpreter, because it changes how far they can trust what they are
  // reading — most of all on names and numbers.
  if (!scripted && (health.llm === "down" || ai === "local")) {
    return {
      state: "degraded",
      label: "Rule-based",
      detail: "No AI translation right now. Check names and numbers before saying them.",
      problem: true,
    };
  }

  if (!scripted && (health.llm === "degraded" || ai === "degraded")) {
    return {
      state: "degraded",
      label: "Reduced",
      detail: "Translation is short on capacity. Expect plainer lines.",
      problem: true,
    };
  }

  if (connection === "live") return { state: "live", label: "Live", problem: false };

  return { state: connection, label: "Idle", problem: false };
}

export function ConsoleTopBar({
  connection,
  health,
  elapsedMs,
  aiState,
  scripted,
  onOpenSettings,
  onEnd,
}: {
  connection: ConnectionState;
  health: SubsystemHealth;
  elapsedMs: number;
  aiState: AiState;
  scripted?: boolean;
  onOpenSettings: () => void;
  onEnd: () => void;
}) {
  const status = consoleStatus({ connection, health, ai: aiState, scripted });

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--bg-raised)] pl-3 pr-1 text-[0.7rem] sm:pl-4 tall:h-12 tall:text-[0.75rem]">
      {/* One live region, announced only when the reading changes. A partial
          transcript must never reach a screen reader token by token, so nothing
          that updates continuously lives in here. */}
      <p
        role="status"
        aria-live="polite"
        className="flex min-w-0 items-center gap-1.5"
        title={status.detail}
      >
        <StatusDot state={status.state} />
        <span
          className={cn(
            "shrink-0 font-medium",
            status.state === "degraded" || status.state === "reconnecting"
              ? "text-[var(--warn)]"
              : status.state === "error" || status.state === "offline"
                ? "text-[var(--danger)]"
                : "text-[var(--fg-muted)]",
          )}
        >
          {status.label}
        </span>
        {status.detail && (
          // Narrow screens get the label and the colour; the sentence needs
          // room it does not have next to a 390px-wide English column.
          <span className="hidden min-w-0 truncate text-[var(--fg-dim)] sm:inline">
            {status.detail}
          </span>
        )}
      </p>

      <span
        className="ml-auto shrink-0 tabular-nums text-[var(--fg-muted)]"
        aria-label="Elapsed time"
      >
        {formatElapsed(elapsedMs)}
      </span>

      <Button
        size="sm"
        tone="quiet"
        className="min-w-11 px-2"
        onClick={onOpenSettings}
        ariaLabel="Session settings"
      >
        <span aria-hidden className="text-base leading-none">⋯</span>
      </Button>
      <Button
        size="sm"
        tone="quiet"
        className="min-w-12 px-2 text-[var(--danger)]"
        onClick={onEnd}
        ariaLabel="End session"
      >
        End
      </Button>
    </header>
  );
}
