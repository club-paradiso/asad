"use client";

/**
 * The iPhone page: a microphone with one job.
 *
 * Opened from the QR code on the MacBook. Minimal and dark by default, large
 * touch targets, one meter, one status line. Everything that matters to a
 * volunteer holding the phone is said in plain words: is the microphone on, is
 * the MacBook receiving, what to do if it is not.
 *
 * What this page deliberately does not claim: that audio continues with Safari
 * in the background or the phone locked. iOS suspends capture for background
 * web pages, so the page asks the person to keep it open and holds a screen
 * wake lock where Safari supports one.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createRemoteMicApi } from "@/remote-mic/client";
import { parsePairingFragment } from "@/remote-mic/protocol";
import {
  RemoteMicSender,
  type SenderSnapshot,
  type StoredSenderCredential,
} from "@/remote-mic/sender";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useCapability } from "@/hooks/useCapability";
import { getMicrophonePermissionState, type MicrophonePermissionState } from "@/providers/stt";
import { useStreamLevel } from "./useStreamLevel";
import {
  SENDER_ERROR_TEXT,
  SENDER_PHASE_TEXT,
  SENDER_TEXT,
  type RemoteMicLang,
} from "./text";

const CREDENTIAL_KEY = "asad:remote-mic:sender:v1";

const INITIAL: SenderSnapshot = {
  phase: "idle",
  confirmCode: null,
  stream: null,
  muted: false,
  interrupted: false,
  trackLabel: "",
  error: null,
  endedReason: null,
  reconnectAttempts: 0,
};

function readCredential(): StoredSenderCredential | null {
  try {
    const raw = window.sessionStorage.getItem(CREDENTIAL_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as StoredSenderCredential;
    return typeof value?.id === "string" && typeof value?.token === "string" ? value : null;
  } catch {
    return null;
  }
}

function writeCredential(value: StoredSenderCredential | null) {
  try {
    if (value) window.sessionStorage.setItem(CREDENTIAL_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(CREDENTIAL_KEY);
  } catch {
    // Private mode: a reload will simply need a fresh QR scan.
  }
  if (value) {
    // The pairing secret is spent; take it out of the address bar so a
    // screenshot or a shared tab cannot carry it anywhere.
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      // Not fatal.
    }
  }
}

export function RemoteMicSenderScreen() {
  const [lang, setLang] = useState<RemoteMicLang>("ko");
  const [sender, setSender] = useState<RemoteMicSender | null>(null);
  const [hasPairing, setHasPairing] = useState(true);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [permission, setPermission] = useState<MicrophonePermissionState | null>(null);
  const [wasHidden, setWasHidden] = useState(false);
  const [routeChanged, setRouteChanged] = useState(false);
  const t = SENDER_TEXT[lang];

  const secure = useCapability(() => window.isSecureContext, true);
  const webRtc = useCapability(
    () => typeof RTCPeerConnection === "function" && !!navigator.mediaDevices?.getUserMedia,
    true,
  );

  // Build the sender from the URL fragment. No side effects happen here: the
  // microphone opens only from the Start button's click.
  useEffect(() => {
    const pairing = parsePairingFragment(window.location.hash);
    const stored = readCredential();
    const instance = new RemoteMicSender({
      api: createRemoteMicApi(),
      pairing,
      stored,
      saveCredential: writeCredential,
      voiceProcessing,
    });
    const publish = window.setTimeout(() => {
      setSender(instance);
      setHasPairing(!!pairing || !!stored);
    }, 0);
    (window as unknown as { __asadRemoteMicSender?: unknown }).__asadRemoteMicSender = {
      snapshot: () => {
        const s = instance.snapshot();
        return { phase: s.phase, error: s.error, muted: s.muted, live: !!s.stream };
      },
      simulateNetworkDrop: () => instance.simulateNetworkDrop(),
    };
    return () => {
      window.clearTimeout(publish);
      instance.dispose();
    };
    // Voice processing is read when the microphone is (re)opened; changing it
    // before Start rebuilds the idle sender, which has opened nothing yet.
  }, [voiceProcessing]);

  const subscribe = useCallback(
    (listener: () => void) => (sender ? sender.subscribe(listener) : () => {}),
    [sender],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => sender?.snapshot() ?? INITIAL,
    () => INITIAL,
  );

  const level = useStreamLevel(state.stream, true);
  const micOn = !!state.stream && state.stream.getAudioTracks().some((track) => track.readyState === "live");
  const sending = state.phase === "connected";
  const wakeLock = useWakeLock(micOn);

  useEffect(() => {
    let cancelled = false;
    void getMicrophonePermissionState().then((value) => {
      if (!cancelled) setPermission(value);
    });
    return () => {
      cancelled = true;
    };
  }, [state.phase]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && micOn) setWasHidden(true);
    };
    let clear: number | undefined;
    const onDeviceChange = () => {
      if (!micOn) return;
      setRouteChanged(true);
      window.clearTimeout(clear);
      clear = window.setTimeout(() => setRouteChanged(false), 10_000);
    };
    document.addEventListener("visibilitychange", onVisibility);
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      window.clearTimeout(clear);
      document.removeEventListener("visibilitychange", onVisibility);
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
    };
  }, [micOn]);

  const meter = Math.round(level.reading.meter * 100);
  const errorText = state.error ? SENDER_ERROR_TEXT[lang][state.error] : null;
  const capabilityError = !secure
    ? SENDER_ERROR_TEXT[lang].INSECURE_CONTEXT
    : !webRtc
      ? SENDER_ERROR_TEXT[lang].UNSUPPORTED
      : null;

  const permissionText = useMemo(() => {
    const map: Record<MicrophonePermissionState, [string, string]> = {
      granted: ["허용됨", "Allowed"],
      denied: ["거부됨", "Denied"],
      prompt: ["시작할 때 묻습니다", "Asked on start"],
      unavailable: ["사용 불가", "Unavailable"],
    };
    const value = micOn ? "granted" : permission;
    return value ? map[value][lang === "ko" ? 0 : 1] : "…";
  }, [permission, micOn, lang]);

  const ended = state.phase === "ended";
  const canStart = !!sender && !ended && !micOn && !capabilityError && hasPairing && state.phase !== "requesting-mic" && state.phase !== "claiming";

  return (
    <main
      data-surface="remote-mic"
      className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col gap-5 px-4 pb-8 pt-5"
      style={{ paddingTop: "max(1.25rem, var(--safe-top))" }}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">{t.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setLang(lang === "ko" ? "en" : "ko")}
          className="min-h-11 shrink-0 rounded-md border border-[var(--line)] px-3 text-sm text-[var(--fg-muted)]"
        >
          {t.language}
        </button>
      </header>

      {/* Status: what a person needs to know at a glance. */}
      <section
        aria-label={t.connection}
        className="rounded-xl border border-[var(--line)] bg-[var(--bg-raised)] p-4"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={
              micOn && !state.muted
                ? "size-4 shrink-0 rounded-full bg-[var(--danger)]"
                : "size-4 shrink-0 rounded-full border-2 border-[var(--line-strong)]"
            }
          />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold" data-testid="sender-mic-state">
              {micOn ? (state.muted ? t.mutedBadge : t.micActive) : t.micOff}
            </p>
            <p role="status" aria-live="polite" className="text-sm text-[var(--fg-muted)]" data-testid="sender-phase" data-phase={state.phase}>
              {SENDER_PHASE_TEXT[lang][state.phase]}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex justify-between text-xs text-[var(--fg-dim)]">
            <span>{t.level}</span>
            <span>{micOn ? level.reading.label : "—"}</span>
          </div>
          <div
            className="mt-1.5 h-4 overflow-hidden rounded-full bg-[var(--line)]"
            role="meter"
            aria-label={t.level}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={micOn ? meter : 0}
          >
            <div
              className={
                level.reading.state === "hot" || level.health.state === "clipping"
                  ? "h-full bg-[var(--danger)]"
                  : "h-full bg-[var(--accent)]"
              }
              style={{ width: `${micOn ? meter : 0}%` }}
            />
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-[var(--fg-dim)]">{t.permission}</dt>
          <dd className="text-right">{permissionText}</dd>
          {state.trackLabel && micOn ? (
            <>
              <dt className="text-[var(--fg-dim)]">{t.usingInput}</dt>
              <dd className="truncate text-right" title={state.trackLabel}>{state.trackLabel}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {state.confirmCode && (state.phase === "awaiting-approval" || state.phase === "connecting") && (
        <section className="rounded-xl border-2 border-[var(--accent)] p-4 text-center" aria-live="polite">
          <p className="text-sm font-medium">{t.confirmTitle}</p>
          <p className="mt-2 font-mono text-5xl font-semibold tracking-[0.25em]" data-testid="sender-confirm-code">
            {state.confirmCode}
          </p>
          <p className="mt-2 text-sm text-[var(--fg-muted)]">{t.confirmBody}</p>
        </section>
      )}

      {(capabilityError || errorText || (!hasPairing && !ended)) && (
        <p role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] px-3 py-2.5 text-sm leading-relaxed text-[var(--danger)]">
          {capabilityError ?? errorText ?? t.noPairing}
        </p>
      )}
      {ended && !errorText && <p role="status" className="text-sm text-[var(--fg-muted)]">{t.ended}</p>}
      {state.interrupted && micOn && <p role="status" className="text-sm text-[var(--warn)]">{t.interrupted}</p>}
      {routeChanged && <p role="status" className="text-sm text-[var(--warn)]">{t.routeChanged}</p>}
      {wasHidden && micOn && (
        <p role="status" className="text-sm text-[var(--warn)]">
          {t.hiddenWarning}{" "}
          <button type="button" className="underline" onClick={() => setWasHidden(false)}>
            OK
          </button>
        </p>
      )}

      {/* Controls. Start must be a direct tap: iOS requires it for the mic. */}
      <div className="flex flex-col gap-3">
        {micOn ? (
          <>
            <button
              type="button"
              onClick={() => sender?.setMuted(!state.muted)}
              className="min-h-16 rounded-xl border border-[var(--line-strong)] bg-[var(--bg-raised)] text-lg font-semibold"
            >
              {state.muted ? t.unmute : t.mute}
            </button>
            <button
              type="button"
              onClick={() => void sender?.stop()}
              className="min-h-16 rounded-xl border border-[color-mix(in_srgb,var(--danger)_55%,transparent)] text-lg font-semibold text-[var(--danger)]"
            >
              {t.stop}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!canStart}
            onClick={() => void sender?.start()}
            className="min-h-20 rounded-xl bg-[var(--accent)] text-xl font-semibold text-[var(--accent-contrast)] disabled:opacity-40"
          >
            {t.start}
          </button>
        )}
        {(state.phase === "failed" || state.phase === "reconnecting") && micOn && (
          <button
            type="button"
            onClick={() => void sender?.reconnect()}
            className="min-h-14 rounded-xl border border-[var(--line-strong)] text-base font-semibold"
          >
            {t.reconnect}
          </button>
        )}
        {!micOn && !ended && (
          <label className="flex min-h-11 items-center gap-3 text-sm text-[var(--fg-muted)]">
            <input
              type="checkbox"
              checked={voiceProcessing}
              onChange={(event) => setVoiceProcessing(event.target.checked)}
              className="size-5 accent-[var(--accent)]"
            />
            {t.voiceProcessing}
          </label>
        )}
      </div>

      <section className="rounded-xl border border-[var(--line)] p-4 text-sm leading-relaxed text-[var(--fg-muted)]">
        <p>{t.keepOpen}</p>
        <p className="mt-2 text-xs">
          {!wakeLock.supported ? t.wakeLockUnsupported : wakeLock.held ? t.wakeLockHeld : micOn ? t.wakeLockPending : null}
        </p>
        <p className="mt-2 text-xs text-[var(--fg-dim)]">{t.privacy}</p>
      </section>

      {!ended && (sending || state.phase === "stopped" || state.phase === "awaiting-approval") && (
        <button
          type="button"
          onClick={() => void sender?.leave()}
          className="mt-auto min-h-11 self-center px-3 text-sm text-[var(--fg-dim)] underline underline-offset-4"
        >
          {t.leave}
        </button>
      )}
    </main>
  );
}
