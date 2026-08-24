"use client";

/**
 * The status strip.
 *
 * One line, 36px tall, carrying only what the interpreter would want to know
 * without looking for it: is it connected, what mode is it in, how long have
 * we been going, and is anything degraded.
 *
 * Everything adjustable lives behind the settings button, because §40 is
 * right: controls exposed during live interpretation are controls the eye has
 * to skip over on every glance.
 */
import type { ConnectionState, SubsystemHealth } from "@/types";
import { Button, StatusDot } from "@/components/ui/primitives";
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
  onOpenSettings: () => void;
  onEnd: () => void;
}) {
  const state = effectiveState(connection, health);

  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--bg-raised)] pl-3 pr-1 sm:pl-4 text-[0.75rem]">
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

      <Button size="sm" tone="quiet" onClick={onOpenSettings} ariaLabel="Session settings">
        <span aria-hidden>⋯</span>
      </Button>
      <Button size="sm" tone="quiet" onClick={onEnd} className="text-[var(--danger)]">
        End
      </Button>
    </header>
  );
}
