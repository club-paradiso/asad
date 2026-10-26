"use client";

/**
 * The MacBook end of Remote Microphone, inside the launcher.
 *
 * Pair → approve → verify → start. The verification is the point: a paired
 * phone proves nothing about audio. The checklist distinguishes the five
 * things that can each be true while the next is false — paired, samples
 * actually arriving, a usable level, no clipping or weak signal, and the
 * operator's own confirmation that it is the right sound — and the meter is
 * the ACTUAL level of the received WebRTC track, not a decoration.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { QrCode } from "@/features/counter/QrCode";
import type { ReceiverPhase } from "@/remote-mic/receiver";
import type { RemoteMicReceiverHandle } from "./useRemoteMicReceiver";
import type { StreamLevel } from "./useStreamLevel";

const PHASE_KO: Record<ReceiverPhase, string> = {
  idle: "연결 전",
  creating: "QR 코드 만드는 중…",
  waiting: "휴대폰을 기다리는 중",
  "awaiting-approval": "승인 대기",
  connecting: "휴대폰과 연결하는 중…",
  connected: "연결됨",
  paused: "휴대폰에서 마이크를 멈춤",
  interrupted: "연결 끊김 · 다시 연결하는 중",
  failed: "연결 실패",
  ended: "연결 종료됨",
  error: "사용할 수 없음",
};

export interface RemotePreflight {
  paired: boolean;
  samples: boolean;
  usable: boolean;
  problem: "silent" | "weak" | "clipping" | null;
  sourceConfirmed: boolean;
  /** Paired AND samples arriving — the minimum to start a session. */
  canStart: boolean;
  /** Everything verified, including the operator's confirmation. */
  verified: boolean;
}

export function remotePreflight(
  remote: RemoteMicReceiverHandle["state"],
  level: StreamLevel,
  sourceConfirmed: boolean,
): RemotePreflight {
  const paired = remote.phase === "connected";
  // Both halves of the proof: RTP is arriving (or has), AND decoded samples
  // reached Web Audio. Either alone has fooled a meter before.
  const samples =
    paired &&
    remote.liveTracks > 0 &&
    level.samplesSeen &&
    (remote.stats.bytesReceived > 0 || remote.stats.packetsReceived > 0 || remote.stats.rttMs === null);
  const usable = samples && level.usableSeen;
  const problem: RemotePreflight["problem"] = !paired
    ? null
    : level.health.state === "clipping" || level.reading.state === "hot"
      ? "clipping"
      : level.health.state === "silent"
        ? "silent"
        : level.reading.state === "low"
          ? "weak"
          : null;
  return {
    paired,
    samples,
    usable,
    problem,
    sourceConfirmed,
    canStart: paired && samples,
    verified: paired && samples && usable && sourceConfirmed,
  };
}

function formatMs(value: number | null): string {
  if (value === null) return "—";
  return value >= 10_000 ? `${(value / 1000).toFixed(0)}초` : value >= 1000 ? `${(value / 1000).toFixed(1)}초` : `${value} ms`;
}

const CANDIDATE_KO: Record<string, string> = {
  host: "같은 네트워크 직접 연결",
  srflx: "직접 연결(NAT 통과)",
  prflx: "직접 연결(NAT 통과)",
  relay: "TURN 중계 서버 경유",
};

export function RemoteMicPanel({
  remote,
  level,
  preflight,
  onSourceConfirmedChange,
  sttCompatible,
  sttNotice,
  worship,
}: {
  remote: RemoteMicReceiverHandle;
  level: StreamLevel;
  preflight: RemotePreflight;
  onSourceConfirmedChange: (value: boolean) => void;
  sttCompatible: boolean;
  sttNotice?: React.ReactNode;
  worship: boolean;
}) {
  const { state } = remote;
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [localhost, setLocalhost] = useState(false);

  useEffect(() => {
    const check = window.setTimeout(
      () => setLocalhost(/^(localhost|127\.|\[::1\])/.test(window.location.hostname)),
      0,
    );
    return () => window.clearTimeout(check);
  }, []);

  useEffect(() => {
    if (state.phase !== "waiting" && state.phase !== "awaiting-approval") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.phase]);

  const secondsLeft = state.expiresAt ? Math.max(0, Math.round((state.expiresAt - now) / 1000)) : null;
  const meter = Math.round(level.reading.meter * 100);
  const showLevel = state.phase === "connected" || state.phase === "interrupted" || state.phase === "paused";
  const canPair = ["idle", "ended", "error", "failed"].includes(state.phase);

  const copy = async () => {
    if (!state.pairingUrl) return;
    try {
      await navigator.clipboard.writeText(state.pairingUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section
      aria-label="원격 마이크"
      data-testid="remote-mic-panel"
      data-phase={state.phase}
      className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">원격 마이크 · 휴대폰</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--fg-muted)]">
            남는 휴대폰(iPhone·Android 모두)을 무선 마이크로 씁니다. 앱 설치도, 같은 Wi-Fi도 필요 없습니다. 소리는 가능하면 휴대폰에서 이 컴퓨터로 직접(WebRTC, 암호화) 오고, 직접 연결이 안 되는 네트워크에서는 ASAD 서버를 거쳐 중계됩니다(최대 1분 임시 보관 후 삭제).
          </p>
        </div>
        <span
          role="status"
          aria-live="polite"
          data-testid="remote-mic-phase"
          className={
            state.phase === "connected"
              ? "rounded-sm border border-[var(--ok)] px-2 py-1 text-xs font-semibold text-[var(--ok)]"
              : state.phase === "interrupted" || state.phase === "failed" || state.phase === "error"
                ? "rounded-sm border border-[var(--danger)] px-2 py-1 text-xs font-semibold text-[var(--danger)]"
                : "rounded-sm border border-[var(--line-strong)] px-2 py-1 text-xs font-semibold text-[var(--fg-muted)]"
          }
        >
          {PHASE_KO[state.phase]}
        </span>
      </div>

      {!sttCompatible && (
        <div role="alert" className="mt-3 rounded-md border border-[var(--warn)] px-3 py-2.5 text-xs leading-relaxed text-[var(--warn)]">
          {sttNotice}
        </div>
      )}

      {localhost && canPair && (
        <p className="mt-3 rounded-md border border-[var(--warn)] px-3 py-2 text-xs leading-relaxed text-[var(--warn)]">
          지금 주소가 localhost라서 휴대폰에서 열 수 없습니다. 배포된 HTTPS 주소(또는 이 컴퓨터의 IP로 연 HTTPS 개발 서버)에서 페어링하세요.
        </p>
      )}

      {state.error && (
        <p role="alert" data-testid="remote-mic-error" className="mt-3 text-xs leading-relaxed text-[var(--danger)]">
          {state.error.message}
        </p>
      )}

      {canPair && (
        <div className="mt-4">
          <Button tone="primary" size="md" onClick={remote.pair}>
            {state.phase === "idle" ? "휴대폰 연결" : "새로 연결"}
          </Button>
        </div>
      )}

      {state.phase === "waiting" && state.pairingUrl && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,12rem)_1fr] sm:items-start">
          <div className="mx-auto w-full max-w-[12rem] rounded-md border border-[var(--line)] bg-white p-2">
            <QrCode value={state.pairingUrl} label="휴대폰 원격 마이크 연결 QR 코드" />
          </div>
          <div className="min-w-0 text-sm">
            <ol className="list-decimal space-y-1.5 pl-5 text-[var(--fg-muted)]">
              <li>휴대폰 카메라로 QR 코드를 비추고 브라우저(iPhone은 Safari, Android는 Chrome)로 엽니다. Wi-Fi든 모바일 데이터든 인터넷만 되면 됩니다.</li>
              <li>휴대폰에서 「마이크 시작」을 누르고 마이크를 허용합니다.</li>
              <li>이 화면에 뜨는 번호를 확인하고 「승인」을 누릅니다.</li>
            </ol>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button tone="neutral" size="sm" onClick={() => void copy()}>
                {copied ? "복사됨" : "연결 링크 복사"}
              </Button>
              <Button tone="quiet" size="sm" onClick={remote.end}>
                취소
              </Button>
              {secondsLeft !== null && (
                <span className="text-xs text-[var(--fg-dim)]">
                  {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} 후 만료
                </span>
              )}
            </div>
            <input
              readOnly
              aria-label="연결 링크"
              data-testid="remote-mic-link"
              value={state.pairingUrl}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-2 w-full truncate rounded border border-[var(--line)] bg-[var(--bg-overlay)] px-2 py-1.5 font-mono text-[0.7rem] text-[var(--fg-dim)]"
            />
            <p className="mt-1 text-[0.7rem] text-[var(--fg-dim)]">
              이 링크는 한 번만, 5분 안에만 쓸 수 있습니다. 다른 사람에게 보내지 마세요.
            </p>
          </div>
        </div>
      )}

      {state.phase === "awaiting-approval" && (
        <div className="mt-4 rounded-md border-2 border-[var(--accent)] p-4" aria-live="assertive">
          <p className="text-sm font-semibold">휴대폰이 연결을 요청했습니다.</p>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            휴대폰 화면의 번호가 아래와 같을 때만 승인하세요. 모르는 기기라면 거부하세요.
          </p>
          <p className="mt-3 font-mono text-4xl font-semibold tracking-[0.25em]" data-testid="remote-mic-confirm-code">
            {state.confirmCode}
          </p>
          <div className="mt-3 flex gap-2">
            <Button tone="primary" size="md" onClick={remote.approve}>
              승인
            </Button>
            <Button tone="danger" size="md" onClick={remote.reject}>
              거부
            </Button>
          </div>
        </div>
      )}

      {(state.phase === "connecting" || showLevel) && (
        <div className="mt-4">
          {state.phase === "paused" && (
            <p className="mb-2 text-xs text-[var(--warn)]">
              휴대폰에서 마이크를 멈췄습니다. 휴대폰에서 「마이크 시작」을 누르면 다시 연결됩니다.
            </p>
          )}
          {state.phase === "interrupted" && (
            <p className="mb-2 text-xs text-[var(--danger)]">
              휴대폰과의 연결이 끊겼습니다. 휴대폰이 자동으로 다시 연결하는 중입니다. 지금까지의 받아쓰기는 그대로 남습니다.
            </p>
          )}
          {state.sender?.muted && (
            <p className="mb-2 text-xs font-semibold text-[var(--warn)]">휴대폰이 음소거되어 있습니다.</p>
          )}
          {state.sender?.interrupted && (
            <p className="mb-2 text-xs text-[var(--warn)]">
              휴대폰 마이크가 전화·음성 비서 등으로 잠시 중단되었습니다.
            </p>
          )}

          <div className="rounded-md border border-[var(--line)] bg-[var(--bg-overlay)] p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">받는 소리 (휴대폰 → 이 컴퓨터)</span>
              <span aria-live="polite" data-testid="remote-mic-level-label">
                {showLevel && state.liveTracks > 0 ? level.reading.label : "소리 없음"}
              </span>
            </div>
            <div
              className="mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--line)]"
              role="meter"
              aria-label="원격 마이크 입력 레벨"
              data-testid="remote-mic-meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={showLevel && state.liveTracks > 0 ? meter : 0}
            >
              <div
                className={
                  preflight.problem === "clipping"
                    ? "h-full rounded-full bg-[var(--danger)]"
                    : "h-full rounded-full bg-[var(--accent)]"
                }
                style={{ width: `${showLevel && state.liveTracks > 0 ? meter : 0}%` }}
              />
            </div>
          </div>

          <ul className="mt-3 space-y-1.5 text-xs" aria-label="원격 마이크 점검">
            <Check ok={preflight.paired} label="1. 휴대폰 연결됨" />
            <Check ok={preflight.samples} label="2. 실제 오디오가 들어옴" />
            <Check ok={preflight.usable} label="3. 쓸 만한 크기의 신호를 확인함" />
            <li className="flex gap-2" data-testid="remote-mic-check-4">
              <span aria-hidden className={preflight.problem ? "text-[var(--warn)]" : "text-[var(--ok)]"}>
                {preflight.problem ? "!" : "✓"}
              </span>
              <span>
                4.{" "}
                {preflight.problem === "clipping"
                  ? "소리가 너무 커서 찌그러집니다. 휴대폰을 스피커에서 조금 떨어뜨리세요."
                  : preflight.problem === "silent"
                    ? "12초 이상 소리가 없습니다. 휴대폰 음소거, 위치, 연결 상태를 확인하세요."
                    : preflight.problem === "weak"
                      ? "신호가 약합니다. 휴대폰을 말하는 사람이나 스피커 쪽으로 더 가까이 두세요."
                      : "찌그러짐·약한 신호 없음"}
              </span>
            </li>
            <li>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={preflight.sourceConfirmed}
                  onChange={(event) => onSourceConfirmedChange(event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                />
                <span>
                  <strong className="font-semibold">5. 올바른 소리입니다.</strong> 레벨이 한국어 강단(설교자) 소리에 맞춰 움직이고, 통역사 목소리는 거의 들어가지 않는 것을 확인했습니다.
                </span>
              </label>
            </li>
          </ul>

          {worship && (
            <p className="mt-3 rounded-md border border-[var(--line)] px-3 py-2 text-xs leading-relaxed text-[var(--fg-muted)]">
              휴대폰 마이크는 콘솔 피드가 아니라 <strong className="text-[var(--fg)]">방 안의 소리</strong>를 듣습니다. 회중 소음·반향·통역사 목소리가 섞일 수 있으니, 가능하면 강단 스피커 가까이에 두고 통역사 자리에서 멀리 두세요. 깨끗한 믹서 피드가 있다면 그쪽이 더 정확합니다.
            </p>
          )}

          {state.phase === "connected" && (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[0.7rem] text-[var(--fg-dim)] sm:grid-cols-4" data-testid="remote-mic-stats">
              <dt>연결 방식</dt>
              <dd className="text-[var(--fg-muted)]" data-testid="remote-mic-transport" data-transport={state.transport ?? ""}>
                {state.transport === "relay"
                  ? "ASAD 서버 중계 (같은 Wi-Fi 불필요)"
                  : state.stats.localCandidateType
                    ? CANDIDATE_KO[state.stats.localCandidateType]
                    : "확인 중"}
              </dd>
              <dt>왕복 지연</dt>
              <dd className="text-[var(--fg-muted)]" data-testid="remote-mic-rtt">{formatMs(state.stats.rttMs)}</dd>
              <dt>추정 전송 지연</dt>
              <dd className="text-[var(--fg-muted)]" data-testid="remote-mic-transport-ms">
                {formatMs(state.stats.estimatedTransportMs)}
              </dd>
              <dt>패킷 손실</dt>
              <dd className="text-[var(--fg-muted)]">
                {state.stats.recentLossPct === null ? "—" : `${state.stats.recentLossPct}%`} ({state.stats.packetsLost})
              </dd>
              <dt>페어링</dt>
              <dd className="text-[var(--fg-muted)]">{formatMs(state.metrics.pairingMs)}</dd>
              <dt>{state.transport === "relay" ? "연결까지" : "WebRTC 연결"}</dt>
              <dd className="text-[var(--fg-muted)]" data-testid="remote-mic-connect-ms">{formatMs(state.metrics.connectMs)}</dd>
              <dt>재연결</dt>
              <dd className="text-[var(--fg-muted)]">{state.metrics.reconnects}회</dd>
              <dt>{state.transport === "relay" ? "재생 버퍼" : "지터 버퍼"}</dt>
              <dd className="text-[var(--fg-muted)]">{formatMs(state.stats.jitterBufferMs)}</dd>
            </dl>
          )}

          <div className="mt-3">
            <Button tone="quiet" size="sm" onClick={remote.end}>
              연결 끊기
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden className={ok ? "text-[var(--ok)]" : "text-[var(--fg-dim)]"}>
        {ok ? "✓" : "○"}
      </span>
      <span className={ok ? "" : "text-[var(--fg-muted)]"}>
        {label}
        <span className="sr-only">{ok ? " — 확인됨" : " — 아직 확인 안 됨"}</span>
      </span>
    </li>
  );
}
