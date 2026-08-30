"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { observeAudioInputEnd } from "@/providers/stt/audio";
import { classifyInputLevel, rmsOf, type InputLevelReading } from "./audio-level";

interface BoothPreflightProps {
  inputLabel: string;
  deviceId?: string;
  onPermissionGranted?: () => void;
  onReadyChange?: (ready: boolean) => void;
}

type TestPhase = "idle" | "requesting" | "listening" | "error";

const EMPTY_READING = classifyInputLevel(0);

export function isBoothPreflightReady(signalVerified: boolean, mixMinusChecked: boolean): boolean {
  return signalVerified && mixMinusChecked;
}

/**
 * Local-only booth hardware check.
 *
 * Nothing from this component is sent to STT or the interpretation API. The
 * stream exists only long enough to drive a coarse level meter, then every
 * track and AudioContext is torn down. That makes it safe to run before cloud
 * consent while still requiring an explicit user gesture for microphone
 * permission on Safari/iOS.
 */
export function BoothPreflight({
  inputLabel,
  deviceId,
  onPermissionGranted,
  onReadyChange,
}: BoothPreflightProps) {
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [reading, setReading] = useState<InputLevelReading>(EMPTY_READING);
  const [error, setError] = useState<string | null>(null);
  const [mixMinusChecked, setMixMinusChecked] = useState(false);
  const [signalVerified, setSignalVerified] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const detachEndObserverRef = useRef<(() => void) | null>(null);

  const ready = isBoothPreflightReady(signalVerified, mixMinusChecked);
  useEffect(() => onReadyChange?.(ready), [onReadyChange, ready]);

  const stopTest = useCallback((updateUi = true) => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    // Detach first so stopping the track ourselves never looks like a device
    // failure. The same invariant is used by the real live capture path.
    detachEndObserverRef.current?.();
    detachEndObserverRef.current = null;
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (contextRef.current && contextRef.current.state !== "closed") {
      void contextRef.current.close().catch(() => {});
    }
    streamRef.current = null;
    contextRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    if (updateUi) {
      setPhase("idle");
      setReading(EMPTY_READING);
    }
  }, []);

  useEffect(() => () => stopTest(false), [stopTest]);

  const startTest = useCallback(async () => {
    stopTest(false);
    setError(null);
    setPhase("requesting");
    setReading(EMPTY_READING);
    setSignalVerified(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot test audio input locally.");
      setPhase("error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;
      detachEndObserverRef.current = observeAudioInputEnd(stream, () => {
        setSignalVerified(false);
        setError(
          "Audio input disconnected during preflight. Reconnect it or choose another input, then test again.",
        );
        setPhase("error");
        stopTest(false);
      });
      onPermissionGranted?.();

      const AudioContextCtor =
        typeof AudioContext !== "undefined"
          ? AudioContext
          : (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
      const context = new AudioContextCtor();
      contextRef.current = context;
      if (context.state === "suspended") await context.resume();

      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.7;
      analyserRef.current = analyser;

      const source = context.createMediaStreamSource(stream);
      sourceRef.current = source;
      source.connect(analyser);

      const samples = new Float32Array(analyser.fftSize);
      let lastUiUpdate = 0;
      const measure = (now: number) => {
        analyser.getFloatTimeDomainData(samples);
        if (now - lastUiUpdate >= 100) {
          const nextReading = classifyInputLevel(rmsOf(samples));
          setReading(nextReading);
          if (nextReading.state === "good") setSignalVerified(true);
          lastUiUpdate = now;
        }
        frameRef.current = requestAnimationFrame(measure);
      };

      setPhase("listening");
      frameRef.current = requestAnimationFrame(measure);
    } catch (caught) {
      setSignalVerified(false);
      const message =
        caught instanceof Error && caught.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : caught instanceof Error &&
              (caught.name === "OverconstrainedError" || caught.name === "NotFoundError")
            ? "The selected audio input is unavailable. Reconnect it or choose another input."
            : caught instanceof Error
              ? caught.message
              : "Could not open this audio input.";
      setError(message);
      setPhase("error");
      stopTest(false);
    }
  }, [deviceId, onPermissionGranted, stopTest]);

  const meterPercent = Math.round(reading.meter * 100);

  return (
    <section
      aria-label="Booth preflight"
      className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--fg)]">Booth preflight</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--fg-muted)]">
            Test the selected church feed before the service. This meter is local only; no audio is sent to ASAD providers.
          </p>
        </div>
        <span className="rounded-sm border border-[var(--line-strong)] px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--fg-dim)]">
          Local only
        </span>
      </div>

      <div className="mt-4 rounded-md border border-[var(--line)] bg-[var(--bg-overlay)] p-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="min-w-0 truncate font-medium text-[var(--fg)]" title={inputLabel}>
            {inputLabel}
          </span>
          <span aria-live="polite" className="shrink-0 text-[var(--fg-muted)]">
            {phase === "requesting"
              ? "Opening…"
              : phase === "listening"
                ? reading.label
                : phase === "error"
                  ? "Input unavailable"
                  : signalVerified
                    ? "Signal verified"
                    : "Not tested"}
          </span>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--line)]"
          role="meter"
          aria-label="Input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={phase === "listening" ? meterPercent : 0}
        >
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-100"
            style={{ width: `${phase === "listening" ? meterPercent : 0}%` }}
          />
        </div>
        {error && (
          <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
            {error}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          {phase === "listening" ? (
            <Button tone="neutral" size="sm" onClick={() => stopTest()}>
              Stop test
            </Button>
          ) : (
            <Button tone="neutral" size="sm" onClick={() => void startTest()}>
              Test input
            </Button>
          )}
        </div>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3 text-xs leading-relaxed text-[var(--fg-muted)]">
        <input
          type="checkbox"
          checked={mixMinusChecked}
          onChange={(event) => setMixMinusChecked(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
        />
        <span>
          <strong className="font-semibold text-[var(--fg)]">Mix-minus checked.</strong>{" "}
          The ASAD feed contains the Korean speaker/program audio, but not the interpreter&apos;s English microphone.
        </span>
      </label>

      <div
        aria-live="polite"
        className="mt-4 rounded-md border border-[var(--line)] bg-[var(--bg-overlay)] px-3 py-2.5 text-xs leading-relaxed"
      >
        {ready ? (
          <p className="font-semibold text-[var(--accent)]">Ready for live.</p>
        ) : signalVerified ? (
          <p className="text-[var(--fg-muted)]">
            Signal verified. Confirm mix-minus to finish the booth check.
          </p>
        ) : (
          <p className="text-[var(--fg-muted)]">
            Run the input test until the meter reports a usable signal, then confirm mix-minus.
          </p>
        )}
      </div>
    </section>
  );
}
