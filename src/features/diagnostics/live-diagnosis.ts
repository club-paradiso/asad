/**
 * One ordered answer to "why is Live not working?".
 *
 * The diagnostics payload and the browser each know a few facts. None of them
 * is the diagnosis; a volunteer in a booth needs the eight situations below
 * told apart, worst first, each with the one thing to do about it. Pure, so
 * the table is a test rather than a hope.
 */
import type { MicrophonePermissionState } from "@/providers/stt";
import { describeAudioInput } from "@/features/live/audio-input-kind";
import type { InputHealth } from "@/features/live/input-health";

export type LiveProblemKind =
  | "permission-denied"
  | "no-input-device"
  | "wrong-device"
  | "insufficient-signal"
  | "clipping"
  | "stt-unavailable"
  | "translation-unavailable"
  | "high-latency";

export interface LiveProblem {
  kind: LiveProblemKind;
  /** `blocked`: Live cannot work. `warning`: it works, worse than it should. */
  severity: "blocked" | "warning";
  title: string;
  detail: string;
  fix: string;
}

export interface SloRow {
  stage: string;
  target: { p50: number; p95: number };
  actual: { count: number; p50: number; p95: number };
  p95Met: boolean;
}

export interface LiveDiagnosisInput {
  /** From the browser's permission query, when it answers. */
  permission?: MicrophonePermissionState;
  /** Browser-visible audio inputs. */
  deviceCount?: number;
  /** Label of the input the booth would use. Empty for the system default. */
  selectedLabel?: string;
  /** Result of a local level check, when one has been run. */
  health?: InputHealth;
  stt?: { provider: string; credentialsRequired: boolean; keyConfigured: boolean | null };
  llm?: { active: string | null };
  slo?: SloRow[];
}

/** The stages whose p95 an interpreter actually feels. */
const FELT_STAGES = new Set(["stable_to_safe", "stable_to_render", "provider_response"]);

export function diagnoseLive(input: LiveDiagnosisInput): LiveProblem[] {
  const problems: LiveProblem[] = [];

  if (input.permission === "denied") {
    problems.push({
      kind: "permission-denied",
      severity: "blocked",
      title: "Microphone permission denied",
      detail: "The browser is refusing ASAD access to any audio input, so nothing can be heard.",
      fix: "Click the lock icon in the address bar, allow the microphone, then reload. If macOS itself blocks it, enable the browser under System Settings → Privacy & Security → Microphone.",
    });
  }

  if (input.permission !== "denied" && input.deviceCount === 0) {
    problems.push({
      kind: "no-input-device",
      severity: "blocked",
      title: "No audio input device",
      detail: "The browser cannot see a single audio input. The console feed is not reaching this computer.",
      fix: "Plug the adapter or cable in fully, then press Rescan. A USB adapter should appear as a USB device; the 3.5 mm jack appears as External Microphone only when the plug is detected as a headset.",
    });
  }

  if (input.selectedLabel) {
    const kind = describeAudioInput(input.selectedLabel);
    if (kind.suitability === "bad") {
      problems.push({
        kind: "wrong-device",
        severity: "warning",
        title: "Selected input is not the console feed",
        detail: `“${input.selectedLabel}” is ${kind.kind === "builtin-mic" ? "the laptop's own microphone" : kind.kind === "phone" ? "a phone's microphone" : "a Bluetooth device"}. It hears the room, not the console.`,
        fix: "Choose the USB adapter or the external jack input in Booth Preflight. Use a room microphone only as a last resort, and expect worse recognition.",
      });
    }
  }

  if (input.health && input.health.source === "raw") {
    if (input.health.state === "silent") {
      problems.push({
        kind: "insufficient-signal",
        severity: "blocked",
        title: "No signal on the selected input",
        detail: "The input opened, but the level check heard only silence.",
        fix: "Turn the console's output volume up, confirm the cable is in an OUTPUT socket on the console and the INPUT on the adapter, and play programme audio during the check.",
      });
    } else if (input.health.state === "ok" && input.health.level === "low") {
      problems.push({
        kind: "insufficient-signal",
        severity: "warning",
        title: "Signal is weak",
        detail: "Audio arrives, but too quietly for reliable recognition.",
        fix: "Raise the console output level, or the input gain in Audio MIDI Setup, until the meter reads 'usable' at ordinary speaking volume.",
      });
    } else if (input.health.state === "clipping") {
      problems.push({
        kind: "clipping",
        severity: "warning",
        title: "Input is clipping",
        detail: "The feed is overdriving the input and distorting. Recognition degrades on distorted audio.",
        fix: "Lower the console or adapter output. A headphone output into a microphone input usually needs to sit below half.",
      });
    }
  }

  if (
    input.stt &&
    input.stt.provider !== "webspeech" &&
    input.stt.provider !== "demo" &&
    input.stt.credentialsRequired &&
    input.stt.keyConfigured === false
  ) {
    problems.push({
      kind: "stt-unavailable",
      severity: "blocked",
      title: "Speech recognition service is not configured",
      detail: `The deployment is set to ${input.stt.provider}, but no key is configured, so no cloud recogniser will answer.`,
      fix: "Set the provider's key on the server, or choose Browser recognition in the launcher's advanced settings.",
    });
  }

  if (input.llm && input.llm.active === null) {
    problems.push({
      kind: "translation-unavailable",
      severity: "warning",
      title: "No translation provider",
      detail: "No cloud model is configured or every configured one is unusable. English will be rule-based, not a translation.",
      fix: "Configure a provider key, or on a supported desktop Chrome rely on the on-device translator and check names and numbers by ear.",
    });
  }

  const slow = (input.slo ?? []).filter(
    (row) => FELT_STAGES.has(row.stage) && row.actual.count > 0 && !row.p95Met,
  );
  if (slow.length > 0) {
    const worst = slow.reduce((a, b) => (b.actual.p95 - b.target.p95 > a.actual.p95 - a.target.p95 ? b : a));
    problems.push({
      kind: "high-latency",
      severity: "warning",
      title: "Interpretation is arriving late",
      detail: `${worst.stage.replace(/_/g, " ")} p95 is ${worst.actual.p95} ms against a target of ${worst.target.p95} ms (n=${worst.actual.count}).`,
      fix: "Check the provider's health below, prefer a faster lag profile only if accuracy allows, and make sure the venue network is not shared with a video stream.",
    });
  }

  return problems.sort((a, b) => Number(b.severity === "blocked") - Number(a.severity === "blocked"));
}

export function summariseLiveDiagnosis(problems: LiveProblem[]): {
  level: "ready" | "warning" | "blocked";
  headline: string;
} {
  if (problems.some((p) => p.severity === "blocked")) {
    return { level: "blocked", headline: "Live cannot work until this is fixed" };
  }
  if (problems.length > 0) {
    return { level: "warning", headline: "Live will work, with something to check" };
  }
  return { level: "ready", headline: "Nothing stands between the booth and a session" };
}
