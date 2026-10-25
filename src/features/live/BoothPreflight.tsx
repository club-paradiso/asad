"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { observeAudioInputEnd } from "@/providers/stt/audio";
import { classifyInputLevel, rmsOf, type InputLevelReading } from "./audio-level";
import { describeAudioInput } from "./audio-input-kind";
import {
  InputHealthMonitor,
  NO_INPUT_HEALTH,
  SILENCE_WARNING_MS,
  sameInputHealth,
  type InputHealth,
} from "./input-health";

interface BoothPreflightProps {
  inputLabel: string;
  deviceId?: string;
  onPermissionGranted?: () => void;
  onReadyChange?: (ready: boolean) => void;
}

type TestPhase = "idle" | "requesting" | "listening" | "error";

interface OpenedTrack {
  label: string;
  sampleRate?: number;
  channelCount?: number;
}

const EMPTY_READING = classifyInputLevel(0);

export function isBoothPreflightReady(signalVerified: boolean, mixMinusChecked: boolean): boolean {
  return signalVerified && mixMinusChecked;
}

/** Largest absolute sample — the clipping question the RMS cannot answer. */
function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const magnitude = samples[i] < 0 ? -samples[i] : samples[i];
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

/**
 * Local-only booth hardware check.
 *
 * Nothing from this component is sent to STT or the interpretation API. The
 * stream exists only long enough to drive a coarse level meter, then every
 * track and AudioContext is torn down. That makes it safe to run before cloud
 * consent while still requiring an explicit user gesture for microphone
 * permission on Safari/iOS.
 *
 * The meter now carries the same two judgements the live console makes —
 * "nothing has arrived for a while" and "this is distorting" — through the
 * same `InputHealthMonitor`, so what the volunteer sees here is what the
 * interpreter would see mid-service.
 */
export function BoothPreflight({
  inputLabel,
  deviceId,
  onPermissionGranted,
  onReadyChange,
}: BoothPreflightProps) {
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [reading, setReading] = useState<InputLevelReading>(EMPTY_READING);
  const [health, setHealth] = useState<InputHealth>(NO_INPUT_HEALTH);
  const [silentSeconds, setSilentSeconds] = useState(0);
  const [opened, setOpened] = useState<OpenedTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mixMinusChecked, setMixMinusChecked] = useState(false);
  const [signalVerified, setSignalVerified] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const detachEndObserverRef = useRef<(() => void) | null>(null);
  const monitorRef = useRef(new InputHealthMonitor());
  const runRef = useRef(0);

  const ready = isBoothPreflightReady(signalVerified, mixMinusChecked);
  useEffect(() => onReadyChange?.(ready), [onReadyChange, ready]);

  const kind = describeAudioInput(opened?.label || inputLabel);

  const stopTest = useCallback((updateUi = true) => {
    runRef.current += 1;
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
    monitorRef.current.reset();
    if (updateUi) {
      setPhase("idle");
      setReading(EMPTY_READING);
      setHealth(NO_INPUT_HEALTH);
      setSilentSeconds(0);
    }
  }, []);

  useEffect(() => () => stopTest(false), [stopTest]);

  const startTest = useCallback(async () => {
    stopTest(false);
    const run = runRef.current;
    setError(null);
    setPhase("requesting");
    setReading(EMPTY_READING);
    setHealth(NO_INPUT_HEALTH);
    setSilentSeconds(0);
    setSignalVerified(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("이 브라우저에서는 오디오 입력을 로컬에서 점검할 수 없습니다.");
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
      if (runRef.current !== run) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      const settings = track && typeof track.getSettings === "function" ? track.getSettings() : {};
      setOpened({
        label: track?.label ?? "",
        sampleRate: settings.sampleRate,
        channelCount: settings.channelCount,
      });
      detachEndObserverRef.current = observeAudioInputEnd(stream, () => {
        if (runRef.current !== run) return;
        setSignalVerified(false);
        setError(
          "점검 중에 오디오 입력이 끊겼습니다. 다시 연결하거나 다른 입력을 고른 뒤 한 번 더 점검해 주세요.",
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
      if (runRef.current !== run) {
        if (context.state !== "closed") void context.close().catch(() => {});
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.7;
      analyserRef.current = analyser;

      const source = context.createMediaStreamSource(stream);
      sourceRef.current = source;
      source.connect(analyser);

      const monitor = monitorRef.current;
      monitor.start();
      const samples = new Float32Array(analyser.fftSize);
      let lastUiUpdate = 0;
      let lastHealth: InputHealth = NO_INPUT_HEALTH;
      let lastSilentSeconds = 0;
      const measure = (now: number) => {
        analyser.getFloatTimeDomainData(samples);
        if (now - lastUiUpdate >= 100) {
          const rms = rmsOf(samples);
          monitor.observe({ rms, peak: peakOf(samples), at: Date.now() });
          const nextReading = classifyInputLevel(rms);
          setReading(nextReading);
          if (nextReading.state === "good") setSignalVerified(true);
          const nextHealth = monitor.snapshot();
          if (!sameInputHealth(lastHealth, nextHealth)) {
            lastHealth = nextHealth;
            setHealth(nextHealth);
          }
          const seconds = Math.floor(nextHealth.silentForMs / 1000);
          if (seconds !== lastSilentSeconds) {
            lastSilentSeconds = seconds;
            setSilentSeconds(seconds);
          }
          lastUiUpdate = now;
        }
        frameRef.current = requestAnimationFrame(measure);
      };

      setPhase("listening");
      frameRef.current = requestAnimationFrame(measure);
    } catch (caught) {
      if (runRef.current !== run) return;
      setSignalVerified(false);
      const message =
        caught instanceof Error && caught.name === "NotAllowedError"
          ? "마이크 권한이 거부되었습니다. 브라우저 주소창의 자물쇠 아이콘에서 마이크를 허용한 뒤 다시 점검하세요."
          : caught instanceof Error &&
              (caught.name === "OverconstrainedError" || caught.name === "NotFoundError")
            ? "선택한 오디오 입력을 쓸 수 없습니다. 다시 연결하거나 다른 입력을 고르세요."
            : caught instanceof Error && caught.name === "NotReadableError"
              ? "다른 프로그램이 이 입력을 쓰고 있어 열지 못했습니다. 녹음·회의 앱을 닫고 다시 점검하세요."
              : caught instanceof Error
                ? caught.message
                : "이 오디오 입력을 열지 못했습니다.";
      setError(message);
      setPhase("error");
      stopTest(false);
    }
  }, [deviceId, onPermissionGranted, stopTest]);

  const meterPercent = Math.round(reading.meter * 100);
  const silenceWarning =
    phase === "listening" && health.state === "silent"
      ? `${Math.max(silentSeconds, Math.round(SILENCE_WARNING_MS / 1000))}초째 소리가 들어오지 않습니다. 콘솔 출력 볼륨, 케이블, 선택한 입력을 확인하세요.`
      : null;
  const clippingWarning =
    phase === "listening" && health.state === "clipping"
      ? "소리가 너무 커서 찌그러집니다. 콘솔이나 어댑터의 출력 볼륨을 낮추세요."
      : null;

  return (
    <section
      aria-label="부스 사전 점검"
      className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--fg)]">소리 확인</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--fg-muted)]">
            강단에서 말하는 동안 아래 막대가 움직이면 됩니다. 이 미터는 기기 안에서만 동작하고, 오디오는 어디로도 전송되지 않습니다.
          </p>
        </div>
        <span className="rounded-sm border border-[var(--line-strong)] px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--fg-dim)]">
          기기 안에서만
        </span>
      </div>

      <div className="mt-4 rounded-md border border-[var(--line)] bg-[var(--bg-overlay)] p-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="min-w-0 truncate font-medium text-[var(--fg)]" title={opened?.label || inputLabel}>
            {opened?.label || inputLabel}
          </span>
          <span aria-live="polite" className="shrink-0 text-[var(--fg-muted)]">
            {phase === "requesting"
              ? "여는 중…"
              : phase === "listening"
                ? reading.label
                : phase === "error"
                  ? "입력 사용 불가"
                  : signalVerified
                    ? "신호 확인됨"
                    : "점검 전"}
          </span>
        </div>
        <p
          className={
            kind.suitability === "bad"
              ? "mt-1 text-xs leading-relaxed text-[var(--warn)]"
              : "mt-1 text-xs leading-relaxed text-[var(--fg-dim)]"
          }
          data-input-kind={kind.kind}
        >
          {kind.note}
        </p>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--line)]"
          role="meter"
          aria-label="입력 레벨"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={phase === "listening" ? meterPercent : 0}
        >
          <div
            className={
              health.state === "clipping" || reading.state === "hot"
                ? "h-full rounded-full bg-[var(--danger)] transition-[width] duration-100"
                : "h-full rounded-full bg-[var(--accent)] transition-[width] duration-100"
            }
            style={{ width: `${phase === "listening" ? meterPercent : 0}%` }}
          />
        </div>
        {opened && phase === "listening" && (
          <p className="mt-2 text-[0.7rem] text-[var(--fg-dim)]">
            {opened.channelCount ? `${opened.channelCount}채널` : "채널 수 미확인"}
            {" · "}
            {opened.sampleRate ? `${Math.round(opened.sampleRate / 100) / 10} kHz` : "샘플레이트 미확인"}
            {" · 인식기로는 16 kHz 모노로 보냅니다"}
          </p>
        )}
        {silenceWarning && (
          <p role="status" className="mt-2 text-xs leading-relaxed text-[var(--warn)]">
            {silenceWarning}
          </p>
        )}
        {clippingWarning && (
          <p role="status" className="mt-2 text-xs leading-relaxed text-[var(--danger)]">
            {clippingWarning}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
            {error}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          {phase === "listening" ? (
            <Button tone="neutral" size="sm" onClick={() => stopTest()}>
              점검 중지
            </Button>
          ) : (
            <Button tone="primary" size="sm" onClick={() => void startTest()}>
              입력 점검
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
          <strong className="font-semibold text-[var(--fg)]">통역사 목소리는 안 들어옵니다.</strong>{" "}
          통역사가 마이크에 대고 말해도 위 막대가 움직이지 않는지 확인했습니다. 이 피드에는 한국어 강단 소리만 들어옵니다.
        </span>
      </label>

      <div
        aria-live="polite"
        className="mt-4 rounded-md border border-[var(--line)] bg-[var(--bg-overlay)] px-3 py-2.5 text-xs leading-relaxed"
      >
        {ready ? (
          <p className="font-semibold text-[var(--ok)]">통역 시작할 준비가 됐습니다.</p>
        ) : signalVerified ? (
          <p className="text-[var(--fg-muted)]">
            신호는 확인됐습니다. 통역사 목소리가 섞이지 않는 것까지 확인하면 부스 점검이 끝납니다.
          </p>
        ) : (
          <p className="text-[var(--fg-muted)]">
            미터에 쓸 만한 신호가 뜰 때까지 입력을 점검한 뒤, 통역사 목소리가 섞이지 않는지 확인해 주세요.
          </p>
        )}
      </div>
    </section>
  );
}
