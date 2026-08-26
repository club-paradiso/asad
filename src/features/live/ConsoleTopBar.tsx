"use client";

/**
 * The status strip.
 *
 * One compact line carrying only what the interpreter would want to know
 * without looking for it: is it connected, what mode is it in, how long have
 * we been going, and is anything degraded. Interactive controls still keep a
 * 44px touch target; shaving eight pixels off a button is not worth missed taps
 * in the middle of a sentence.
 *
 * Everything adjustable lives behind the settings button, because §40 is
 * right: controls exposed during live interpretation are controls the eye has
 * to skip over on every glance.
 */
import type { ConnectionState, SubsystemHealth } from "@/types";
import { Button, StatusDot } from "@/components/ui/primitives";
import { AiStatus, type AiState } from "./AiStatus";
import { cn } from "@/lib/cn";

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  idle: "Idle",
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  degraded: "Degraded",
  offline: "Offline",
  error: "Error",
};

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** The overall state is the worst of the connection and the subsystems. */
export function effectiveState(
  connection: ConnectionState,
  health: SubsystemHealth,
): ConnectionState {
  if (connection === "error" || connection === "offline") return connection;
  if (health.stt === "down") return "error";
  if (connection === "live" && (health.llm !== "ok" || health.stt === "degraded")) {
    return "degraded";
  }
  return connection;
}

export function ConsoleTopBar({
  connection,
  health,
  elapsedMs,
  modeLabel,
  lagLabel,
  sourceLabel,
  thinking,
  degradedReason,
  aiState,
  aiTitle,
  onOpenSettings,
  onEnd,
}: {
  connection: ConnectionState;
  health: SubsystemHealth;
  elapsedMs: number;
  modeLabel: string;
  lagLabel: string;
  sourceLabel: string;
  thinking: boolean;
  degradedReason?: string;
  aiState: AiState;
  aiTitle?: string;
  onOpenSettings: () => void;
  onEnd: () => void;
}) {
  const state = effectiveState(connection, health);

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--bg-raised)] pl-3 pr-1 text-[0.7rem] sm:pl-4 tall:h-12 tall:text-[0.75rem]">
      <span className="flex items-center gap-1.5" title={degradedReason}>
        <StatusDot state={state} />
        <span
          className={cn(
            "font-medium",
            state === "degraded" ? "text-[var(--warn)]" : "text-[var(--fg-muted)]",
          )}
        >
          {CONNECTION_LABEL[state]}
        </span>
      </span>

      <span aria-hidden className="text-[var(--line-strong)]">
        /
      </span>
      <span className="text-[var(--fg-dim)]">{sourceLabel}</span>

      <span aria-hidden className="text-[var(--line-strong)]">
        /
      </span>
      {/* Three words is the entire AI story the live console tells. Everything
          else lives on /diagnostics. */}
      <AiStatus state={aiState} title={aiTitle} />

      <span className="ml-auto flex items-center gap-2.5 text-[var(--fg-dim)]">
        {/* A dot rather than a spinner: it reads as "working" in peripheral
            vision without becoming something to watch. */}
        {thinking && (
          <span className="pulse-live text-[var(--accent)]" title="Interpreting" aria-hidden>
            ●
          </span>
        )}
        <span className="hidden sm:inline">{modeLabel}</span>
        <span className="hidden sm:inline">{lagLabel}</span>
        <span className="tabular-nums text-[var(--fg-muted)]" aria-label="Elapsed time">
          {formatElapsed(elapsedMs)}
        </span>
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
