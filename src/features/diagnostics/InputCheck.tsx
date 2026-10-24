"use client";

/**
 * A local input check for the diagnostics page.
 *
 * Opens the booth's preferred input for a few seconds, runs the same
 * `InputHealthMonitor` the live console uses, and hands the result up so the
 * page can tell "no device" from "wrong device" from "no signal" from
 * "clipping". Nothing is recorded, uploaded or kept; the stream is closed the
 * moment the countdown ends.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { observeAudioInputEnd } from "@/providers/stt/audio";
import { getMicrophonePermissionState, type MicrophonePermissionState } from "@/providers/stt";
import { classifyInputLevel, rmsOf, type InputLevelState } from "@/features/live/audio-level";
import { describeAudioInput } from "@/features/live/audio-input-kind";
import { InputHealthMonitor, type InputHealth } from "@/features/live/input-health";
import { useBoothAudioInput } from "@/features/live/useBoothAudioInput";

export interface InputCheckResult {
  permission: MicrophonePermissionState;
  deviceCount: number;
  selectedLabel: string;
  /** Present once a level check has run. */
  health?: InputHealth;
  /** The best level seen during the check. */
  bestLevel?: InputLevelState;
  /** A failure opening the input, in plain language. */
  openError?: string;
}

const CHECK_SECONDS = 8;
const LEVEL_RANK: Record<InputLevelState, number> = { silent: 0, low: 1, good: 2, hot: 3 };

export function InputCheck({ onResult }: { onResult: (result: InputCheckResult) => void }) {
  const audioInput = useBoothAudioInput(true);
  const [permission, setPermission] = useState<MicrophonePermissionState>("prompt");
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [remaining, setRemaining] = useState(CHECK_SECONDS);
  const [levelLabel, setLevelLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InputCheckResult | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMicrophonePermissionState().then((state) => {
      if (!cancelled) setPermission(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedLabel = audioInput.deviceId ? audioInput.selectedLabel : "";
  const deviceCount = audioInput.devices.filter((device) => device.deviceId !== "default").length;

  // The parent gets a result whenever the facts change, with or without a run.
  useEffect(() => {
    onResult({
      permission,
      deviceCount,
      selectedLabel,
      health: outcome?.health,
      bestLevel: outcome?.bestLevel,
      openError: outcome?.openError,
    });
  }, [onResult, permission, deviceCount, selectedLabel, outcome]);

  useEffect(() => () => cleanupRef.current?.(), []);

  const run = useCallback(async () => {
    cleanupRef.current?.();
    setError(null);
    setOutcome(null);
    setPhase("running");
    setRemaining(CHECK_SECONDS);
    setLevelLabel("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot open an audio input.");
      setPhase("error");
      return;
    }

    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame: number | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let detach: (() => void) | null = null;
    const monitor = new InputHealthMonitor();
    let best: InputLevelState = "silent";

    const cleanup = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer) clearInterval(timer);
      detach?.();
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") void context.close().catch(() => {});
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: audioInput.deviceId ? { exact: audioInput.deviceId } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      setPermission("granted");
      void audioInput.refresh();
      detach = observeAudioInputEnd(stream, () => {
        cleanup();
        setError("The input disconnected during the check.");
        setPhase("error");
      });
      const Ctor =
        typeof AudioContext !== "undefined"
          ? AudioContext
          : (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      context = new Ctor();
      if (context.state === "suspended") await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.7;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      monitor.start();
      let lastUi = 0;
      const measure = (now: number) => {
        analyser.getFloatTimeDomainData(samples);
        if (now - lastUi >= 100) {
          const rms = rmsOf(samples);
          let peak = 0;
          for (let i = 0; i < samples.length; i += 1) {
            const magnitude = Math.abs(samples[i]);
            if (magnitude > peak) peak = magnitude;
          }
          monitor.observe({ rms, peak, at: Date.now() });
          const reading = classifyInputLevel(rms);
          if (LEVEL_RANK[reading.state] > LEVEL_RANK[best]) best = reading.state;
          setLevelLabel(reading.label);
          lastUi = now;
        }
        frame = requestAnimationFrame(measure);
      };
      frame = requestAnimationFrame(measure);

      const startedAt = Date.now();
      const label = stream.getAudioTracks()[0]?.label ?? selectedLabel;
      timer = setInterval(() => {
        const elapsed = (Date.now() - startedAt) / 1000;
        const left = Math.max(0, Math.ceil(CHECK_SECONDS - elapsed));
        setRemaining(left);
        if (left === 0) {
          // Judge the whole check, not the last 100 ms: a feed that was audible
          // at any point is not "silent", and the monitor's silence rule
          // (twelve seconds) is longer than this check on purpose.
          const snapshot = monitor.snapshot();
          const health: InputHealth = {
            ...snapshot,
            state:
              snapshot.state === "clipping"
                ? "clipping"
                : best === "silent"
                  ? "silent"
                  : "ok",
            level: best,
          };
          cleanup();
          setOutcome({ permission: "granted", deviceCount, selectedLabel: label, health, bestLevel: best });
          setPhase("done");
        }
      }, 250);
    } catch (caught) {
      cleanup();
      const denied =
        caught instanceof Error && (caught.name === "NotAllowedError" || caught.name === "SecurityError");
      if (denied) setPermission("denied");
      const message = denied
        ? "Microphone permission was denied."
        : caught instanceof Error && (caught.name === "OverconstrainedError" || caught.name === "NotFoundError")
          ? "The selected input is not available."
          : caught instanceof Error && caught.name === "NotReadableError"
            ? "Another application is holding the input."
            : "The input could not be opened.";
      setError(message);
      setOutcome({ permission: denied ? "denied" : permission, deviceCount, selectedLabel, openError: message });
      setPhase("error");
    }
  }, [audioInput, deviceCount, permission, selectedLabel]);

  const kind = describeAudioInput(selectedLabel);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] px-3.5 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[var(--fg-muted)]">Microphone permission</span>
        <span className={permission === "denied" ? "font-medium text-[var(--danger)]" : "font-medium"}>
          {permission}
        </span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[var(--fg-muted)]">Audio inputs visible</span>
        <span className="font-medium">{audioInput.supported ? deviceCount : "cannot enumerate"}</span>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[var(--fg-muted)]">Input the booth would use</span>
        <select
          aria-label="Diagnostics audio input"
          value={audioInput.deviceId}
          onChange={(event) => audioInput.setDeviceId(event.target.value)}
          disabled={!audioInput.supported}
          className="min-h-11 rounded-md border border-[var(--line-strong)] bg-[var(--bg-overlay)] px-3 text-sm text-[var(--fg)] outline-none focus-visible:border-[var(--accent)] disabled:opacity-50"
        >
          <option value="">System default</option>
          {audioInput.devices
            .filter((device) => device.deviceId !== "default")
            .map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
        </select>
        {selectedLabel && (
          <span className={kind.suitability === "bad" ? "text-xs text-[var(--warn)]" : "text-xs text-[var(--fg-dim)]"}>
            {kind.kind.replace(/-/g, " ")} · {kind.suitability === "good" ? "suitable for a booth" : kind.suitability === "bad" ? "not a console feed" : "verify with the level check"}
          </span>
        )}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void run()} disabled={phase === "running"}>
          {phase === "running" ? `Listening… ${remaining}s` : `Run ${CHECK_SECONDS}-second level check`}
        </Button>
        <Button size="sm" tone="quiet" onClick={() => void audioInput.refresh()}>
          Rescan devices
        </Button>
        <span className="text-xs text-[var(--fg-dim)]">
          {phase === "running"
            ? levelLabel || "opening…"
            : phase === "done" && outcome?.health
              ? `result: ${outcome.health.state === "ok" ? `signal ${outcome.bestLevel}` : outcome.health.state}`
              : "Local only. Nothing is recorded or sent."}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
