"use client";

/**
 * The status strip.
 *
 * An instrument panel, not a dashboard. When everything is working this reads
 *
 *     ● Live      ko → en · Worship                  18:42   ⋯   End
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
import type { ConnectionState, ContextMode, SubsystemHealth } from "@/types";
import { Button, StatusDot } from "@/components/ui/primitives";
import type { AiState } from "./AiStatus";
import { cn } from "@/lib/cn";
import { findLanguage } from "@/lib/languages";
import type { SessionFault } from "./transport-supervisor";
import {
  CONTEXT_LABEL_EN,
  CONTEXT_MODES,
  type ContextState,
} from "@/interpreter/context/context-mode";

/** `ko-KR` reads as `ko` in a strip an interpreter glances at for a second. */
export function shortTag(language: string): string {
  const definition = findLanguage(language);
  if (!definition) return language;
  // A script variant is exactly the case where the bare base subtag would lie.
  return definition.scriptVariant ? definition.id : definition.base;
}

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
   * The session's own verdict on why it stopped listening, when it has one.
   *
   * It outranks `connection`, and it has to: a recogniser reports its terminal
   * error and then, a beat later, reports that it closed. The close arrives
   * last and reads as `idle`, so the strip used to settle on "Idle" — the one
   * word that means "nothing is wrong" — while the microphone was refused and
   * the session was over.
   */
  fault?: SessionFault | null;
  /**
   * Demo mode. Its English is scripted, so "there is no model answering" is
   * the arrangement rather than a fault — and the demo ribbon already says so.
   * Warning about it would be the console crying wolf for a whole session.
   */
  scripted?: boolean;
}): ConsoleStatus {
  const { connection, health, ai, fault, scripted = false } = input;

  if (fault) return statusForFault(fault);

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

  // A backup cloud route answered. Not a fault and not rule-based output — but
  // a different model, and the one consequence an interpreter can act on is
  // that terminology it has not seen settled may come back worded differently.
  if (!scripted && ai === "recovered") {
    return {
      state: "degraded",
      label: "Backup model",
      detail: "The usual model is unavailable. Wording of settled terms may shift.",
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

  // A scripted run that reached its last beat is finished, not idle. "Idle" is
  // the word for "waiting", and it left the demo looking like it had stalled.
  if (scripted && connection === "idle") {
    return { state: "idle", label: "Demo finished", problem: false };
  }

  return { state: connection, label: "Idle", problem: false };
}

/**
 * One line per reason a session stopped listening.
 *
 * Each answers the interpreter's two questions — can I keep going, and is
 * there anything for me to do — in the same place and in plain language.
 */
function statusForFault(fault: SessionFault): ConsoleStatus {
  if (fault.recovering) {
    return {
      state: "reconnecting",
      label: "Reconnecting",
      detail: "Audio is held while it retries. Nothing on screen is lost.",
      problem: true,
    };
  }

  const detail: Record<SessionFault["kind"], string> = {
    permission: "Grant microphone access, then tap Resume. The transcript is kept.",
    device: "Reconnect the input or pick another, then tap Resume. The transcript is kept.",
    unsupported: "This browser or deployment cannot run the input you chose.",
    transport: "The connection did not come back. Tap Resume to try again.",
  };

  const label: Record<SessionFault["kind"], string> = {
    permission: "No microphone",
    device: "Input lost",
    unsupported: "Not available",
    transport: "Not listening",
  };

  return {
    state: "error",
    label: label[fault.kind],
    detail: detail[fault.kind],
    problem: true,
  };
}

export function ConsoleTopBar({
  connection,
  health,
  elapsedMs,
  aiState,
  fault,
  context,
  sourceLanguage,
  targetLanguage,
  onContextChange,
  scripted,
  onOpenSettings,
  onEnd,
}: {
  connection: ConnectionState;
  health: SubsystemHealth;
  elapsedMs: number;
  aiState: AiState;
  /** Why the session stopped listening, when it has. Outranks `connection`. */
  fault?: SessionFault | null;
  /** What the session resolved the setting to, and how it got there. */
  context?: ContextState;
  sourceLanguage?: string;
  targetLanguage?: string;
  onContextChange?: (mode: ContextMode) => void;
  scripted?: boolean;
  onOpenSettings: () => void;
  onEnd: () => void;
}) {
  const status = consoleStatus({ connection, health, ai: aiState, fault, scripted });
  const pair =
    sourceLanguage && targetLanguage
      ? `${shortTag(sourceLanguage)} → ${shortTag(targetLanguage)}`
      : null;

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

      {/* The pair and the context, in the order an interpreter would ask:
          what am I doing, and what has ASAD decided about it. The context is a
          select rather than a label because overriding it must cost one tap —
          it is the ONLY place the old mode choice still exists, and it is now
          optional, revisable and mid-session. */}
      {pair && (
        <span className="ml-auto hidden shrink-0 tabular-nums text-[var(--fg-dim)] sm:inline">
          {pair}
        </span>
      )}

      {context && onContextChange && (
        <select
          aria-label="Interpretation context"
          title={
            context.mode === "auto"
              ? `Detected automatically${context.warmingUp ? " — still listening" : ""}. Choose one to override.`
              : "Manually set. Choose Auto to hand it back to ASAD."
          }
          value={context.mode}
          onChange={(event) => onContextChange(event.target.value as ContextMode)}
          className={cn(
            "shrink-0 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[0.7rem] outline-none hover:border-[var(--line)] focus-visible:border-[var(--accent)] tall:text-[0.75rem]",
            context.mode === "auto" ? "text-[var(--fg-dim)]" : "text-[var(--accent)]",
            !pair && "ml-auto",
          )}
        >
          {CONTEXT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode === "auto"
                ? `Auto${context.warmingUp ? "" : ` · ${CONTEXT_LABEL_EN[context.resolved]}`}`
                : CONTEXT_LABEL_EN[mode]}
            </option>
          ))}
        </select>
      )}

      <span
        className={cn(
          "shrink-0 tabular-nums text-[var(--fg-muted)]",
          !pair && !context && "ml-auto",
        )}
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
