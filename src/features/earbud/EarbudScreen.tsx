"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig } from "@/app/api/config/route";
import { LIVE_SOURCE_LANGUAGES, findLanguage, liveLanguagePairProblem } from "@/lib/languages";
import { openSession, readSessionState, type SessionState } from "@/lib/session-client";
import {
  STT_PROVIDER_INFO,
  WebSpeechProvider,
  sttLanguageSupport,
  type SttProviderId,
} from "@/providers/stt";
import { useBoothAudioInput } from "@/features/live/useBoothAudioInput";
import { preferredSttSource } from "@/features/live/sourcePreference";
import { useCloudConsent } from "@/features/live/useCloudConsent";
import { useLiveSession } from "@/features/live/useLiveSession";
import { unspokenCommitted } from "./speakable";
import { useSpeechPlayback } from "./useSpeechPlayback";

const LANGUAGE_PRIORITY = ["en-US", "zh-CN", "ja-JP", "vi-VN", "id-ID", "uz-UZ", "mn-MN", "ru-RU"];
const AUDIO_STATES: Record<string, string> = {
  unavailable: "음성 출력 미지원",
  idle: "음성 대기",
  speaking: "한국어 음성 재생 중",
  error: "음성 출력 오류",
};

export function EarbudScreen() {
  const [language, setLanguage] = useState("en-US");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [browserSupported, setBrowserSupported] = useState(false);
  const [sourceOverride, setSourceOverride] = useState<SttProviderId | null>(null);
  const [testConfirmed, setTestConfirmed] = useState(false);
  const [syntheticOnly, setSyntheticOnly] = useState(false);
  const [gate, setGate] = useState<SessionState | null>(null);
  const [gateKey, setGateKey] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const playedIds = useRef(new Set<string>());
  const ending = useRef(false);
  const audio = useSpeechPlayback();

  useEffect(() => {
    let mounted = true;
    setBrowserSupported(WebSpeechProvider.isSupported());
    fetch("/api/config", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("설정을 조회하지 못했습니다.");
        return response.json() as Promise<AppConfig>;
      })
      .then((value) => { if (mounted) setConfig(value); })
      .catch(() => { if (mounted) setConfigFailed(true); });
    void readSessionState().then((value) => { if (mounted) setGate(value); });
    return () => { mounted = false; };
  }, []);

  const configured = useMemo(() => preferredSttSource({
    browserSttAvailable: browserSupported,
    cloudAvailable: config?.stt.cloudAvailable ?? false,
    configured: config?.stt.configured as SttProviderId | undefined,
  }), [browserSupported, config]);

  const source = sourceOverride ?? configured;
  const audioInputs = useBoothAudioInput(source !== "demo" && source !== "webspeech");
  const consent = useCloudConsent(source);
  const session = useLiveSession({
    context: "conversation",
    sourceLanguage: language,
    targetLanguage: "ko-KR",
    lag: "fast",
    source,
    audioDeviceId:
      source === "webspeech" || source === "demo" ? undefined : audioInputs.deviceId || undefined,
    resolveScripture: false,
  });

  const active = ["running", "starting", "recovering", "interrupted"].includes(session.phase);
  const sources = useMemo(() => {
    const list: SttProviderId[] = [];
    if (config?.stt.cloudAvailable && (configured === "deepgram" || configured === "openai"))
      list.push(configured);
    if (browserSupported) list.push("webspeech");
    return list;
  }, [browserSupported, config, configured]);

  const sttSupport = source === "demo" ? "unsupported" : sttLanguageSupport(source, language);
  const pairError = liveLanguagePairProblem(language, "ko-KR");
  const inputLost = source !== "webspeech" && source !== "demo"
    && !!audioInputs.deviceId && !audioInputs.selectionAvailable;
  const mayStart = !active && config !== null && config.llm.modelAvailable
    && !gate?.gated || false;
  // The gate and source are checked independently; a truthy model alone is not enough.
  const canStart = !!mayStart && consent.mayStart && source !== "demo"
    && sttSupport !== "unsupported" && !pairError && !inputLost
    && audio.supported && testConfirmed && syntheticOnly;

  const start = () => {
    if (!canStart) return;
    playedIds.current.clear();
    ending.current = false;
    audio.stop();
    // Must be called inside the physical tap handler for iOS Safari's STT activation.
    void session.start();
  };

  const stop = () => {
    ending.current = true;
    audio.stop();
    void session.stop();
  };

  useEffect(() => {
    if (session.phase !== "running" || ending.current) return;
    const chunks = unspokenCommitted(session.snapshot.chunks, playedIds.current);
    for (const chunk of chunks) {
      playedIds.current.add(chunk.id);
      // The local failover is deterministic assistance, not reliable translation.
      if (audio.enabled && session.lastProvider !== "local") audio.enqueue(chunk.text);
    }
  }, [session.snapshot.chunks, session.phase, session.lastProvider, audio.enqueue, audio.enabled]);

  const latest = [...session.snapshot.chunks].reverse()
    .find((chunk) => chunk.state === "committed" && !chunk.provisional);
  const original = session.snapshot.partial?.text
    || session.snapshot.segments.at(-1)?.text || "";
  const disabledReason =
    configFailed ? "서버 설정을 확인하지 못했어. 새로고침 후 다시 시도해."
    : !config ? "서버에서 인식·번역 설정을 확인하는 중..."
    : gate === null ? "접근 권한 확인 중..."
    : gate.gated && !gate.authorised ? "접근 키 인증이 필요해."
    : !config.llm.modelAvailable ? "실제 번역 모델이 설정되지 않았어. 데모나 규칙 기반 출력은 음성 통역으로 사용하지 않아."
    : source === "demo" ? "실제 마이크 입력을 제공하는 음성 인식기가 없어."
    : pairError ? "선택한 입력 언어는 한국어 통역과 연결할 수 없어."
    : sttSupport === "unsupported" ? "현재 음성 인식기에서 이 언어를 지원하지 않아."
    : inputLost ? "선택했던 오디오 입력 장치가 연결되어 있지 않아."
    : !audio.supported ? "이 브라우저는 음성 합성을 지원하지 않아."
    : consent.phase === "checking" ? "외부 음성·번역 공급자의 데이터 정책 확인 중..."
    : consent.phase === "needed" ? "먼저 데이터 전송 안내를 확인해."
    : consent.phase === "declined" ? "데이터 전송 동의 없이 클라우드 통역을 시작할 수 없어."
    : !testConfirmed ? "이어폰 출력 테스트를 먼저 완료해."
    : !syntheticOnly ? "개인정보 없는 테스트 대화만 사용할 수 있어."
    : null;

  const authenticate = useCallback(async () => {
    setGateError(null);
    const accepted = await openSession(gateKey);
    if (accepted) setGate({ gated: true, authorised: true });
    else setGateError("접근 키가 올바르지 않아.");
  }, [gateKey]);

  return (
    <div data-surface="launcher" className="min-h-[100dvh] bg-[var(--bg)] text-[var(--fg)]">
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-7"
        style={{ paddingTop: "calc(1.5rem + var(--safe-top))", paddingBottom: "calc(1.5rem + var(--safe-bottom))" }}>
        <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
          <div>
            <Link href="/" className="text-xs font-semibold tracking-widest text-[var(--fg-dim)]">ASAD / HOME ↗</Link>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">이어폰 통역</h1>
            <p className="mt-1 text-sm text-[var(--fg-muted)]">Earbud Mode · 외국어를 듣고 한국어로 확인하기</p>
          </div>
          <span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold text-[var(--fg-muted)]">BETA · MVP</span>
        </header>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--bg-raised)] p-4">
          <p className="text-xs font-bold tracking-wide text-[var(--fg-dim)]">1. 언어와 음성 인식</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium">
              민원인이 말하는 언어
              <select value={language} disabled={active} onChange={(event) => setLanguage(event.target.value)}
                className="min-h-12 rounded-lg border border-[var(--line-strong)] bg-[var(--bg)] px-3 text-base">
                {[...LIVE_SOURCE_LANGUAGES]
                  .filter((item) => item.id !== "ko-KR")
                  .sort((a, b) => {
                    const aIndex = LANGUAGE_PRIORITY.indexOf(a.id);
                    const bIndex = LANGUAGE_PRIORITY.indexOf(b.id);
                    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
                  })
                  .map((item) => <option key={item.id} value={item.id}>{item.ko} · {item.endonym}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              통역 음성
              <div className="flex min-h-12 items-center rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 text-base">한국어 · 한쪽 에어팟</div>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              음성 인식 엔진
              <select value={source} disabled={active} onChange={(event) => setSourceOverride(event.target.value as SttProviderId)}
                className="min-h-12 rounded-lg border border-[var(--line-strong)] bg-[var(--bg)] px-3 text-sm">
                {source === "demo" && <option value="demo">인식기 미설정</option>}
                {sources.map((option) => <option key={option} value={option}>{STT_PROVIDER_INFO[option].label}</option>)}
              </select>
            </label>
            <div className="flex flex-col gap-2 text-sm font-medium">
              출력 상태
              <div role="status" className="flex min-h-12 items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 text-sm">
                <span>{AUDIO_STATES[audio.status]}</span>
                <button type="button" onClick={audio.test} disabled={!audio.supported}
                  className="min-h-10 rounded-md border border-[var(--line-strong)] px-3 text-xs font-semibold">음성 테스트</button>
              </div>
            </div>
            {source !== "webspeech" && source !== "demo" && audioInputs.supported && (
              <label className="flex flex-col gap-2 text-sm font-medium sm:col-span-2">
                마이크 입력 선택 (지원되는 브라우저에서만)
                <select value={audioInputs.deviceId} disabled={active}
                  onChange={(event) => audioInputs.setDeviceId(event.target.value)}
                  className="min-h-12 rounded-lg border border-[var(--line-strong)] bg-[var(--bg)] px-3 text-sm">
                  <option value="">시스템 기본 입력 · 아이폰 마이크 보장 안 됨</option>
                  {audioInputs.devices.filter((item) => item.deviceId !== "default")
                    .map((item) => <option key={item.deviceId} value={item.deviceId}>{item.label}</option>)}
                </select>
              </label>
            )}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--fg-muted)]">
            오디오는 iOS의 현재 기본 출력으로 재생돼. AirPods 한쪽 연결, 아이폰 마이크 입력 분리, 화면 잠금 상태 동작은 아직 기기에서 검증하지 않았어.
          </p>
          {audio.notice && <p role="alert" className="mt-2 text-sm text-[var(--warn)]">{audio.notice}</p>}
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--bg-raised)] p-4">
          <p className="text-xs font-bold tracking-wide text-[var(--fg-dim)]">2. 실제 기기 테스트와 개인정보</p>
          <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed">
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={testConfirmed} onChange={(event) => setTestConfirmed(event.target.checked)} disabled={active}
                className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
              음성 테스트 버튼을 눌러 한쪽 AirPods에서 한국어 음성이 들리는 걸 직접 확인했어.
            </label>
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={syntheticOnly} onChange={(event) => setSyntheticOnly(event.target.checked)} disabled={active}
                className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
              현재 테스트에는 가상 문장만 사용하고 여권번호, 외국인등록번호, 실제 민원·난민 진술 등 민감정보는 입력하지 않을게.
            </label>
          </div>
          {consent.phase === "needed" && (
            <div className="mt-4 rounded-xl border border-[var(--line-strong)] p-3">
              <strong className="text-sm">클라우드 전송 안내</strong>
              <p className="mt-1 text-xs text-[var(--fg-muted)]">
                음성과 번역용 텍스트가 아래 외부 공급자로 전달될 수 있어. 먼저 내용을 확인해야 시작할 수 있어.
              </p>
              <ul className="mt-2 space-y-2 text-xs text-[var(--fg-muted)]">
                {consent.providers.map((provider) => <li key={provider.label}>
                  <strong className="block text-[var(--fg)]">{provider.label}</strong>
                  {provider.note}
                </li>)}
              </ul>
              <button type="button" onClick={consent.grant}
                className="mt-3 min-h-11 w-full rounded-lg border border-[var(--accent)] px-3 text-sm font-semibold text-[var(--accent)]">
                안내를 확인했어 (다음에 통역 시작)
              </button>
            </div>
          )}
          {gate?.gated && !gate.authorised && (
            <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); void authenticate(); }}>
              <input type="password" aria-label="비공개 배포 접근 키" placeholder="배포 접근 키" value={gateKey}
                onChange={(event) => setGateKey(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3" />
              <button type="submit" className="min-h-11 rounded-lg border border-[var(--line-strong)] px-3 text-sm">인증</button>
              {gateError && <p role="alert">{gateError}</p>}
            </form>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--bg-raised)] p-4" aria-label="라이브 통역 결과">
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--fg-muted)]">
            <span>{active ? "● 마이크 세션" : "○ 대기 중"} · {findLanguage(language)?.ko ?? language} → 한국어</span>
            <span>{session.snapshot.connection}</span>
          </div>
          <div className="mt-4 rounded-xl bg-[var(--bg)] p-4">
            <p className="text-xs font-semibold text-[var(--fg-dim)]">한국어 번역 · 확정된 문장</p>
            <p aria-live="polite" className="mt-3 min-h-20 text-xl font-semibold leading-relaxed">
              {latest?.text ?? "통역 시작 후 확정된 문장이 여기에 표시돼."}
            </p>
            {session.lastProvider === "local" && (
              <p role="alert" className="mt-2 text-xs text-[var(--warn)]">실제 번역 모델이 아닌 로컬 대체 출력이야. 음성 재생하지 않아.</p>
            )}
            {session.snapshot.thinking && <p className="mt-2 text-xs text-[var(--fg-dim)]">문장 번역 중...</p>}
          </div>
          <div className="mt-3 border-t border-[var(--line)] pt-3">
            <p className="text-xs font-semibold text-[var(--fg-dim)]">들은 말 · 잠정 인식</p>
            <p className="mt-2 min-h-10 text-sm leading-relaxed text-[var(--fg-muted)]">{original || "인식된 말이 없어."}</p>
          </div>
          {session.error && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{session.error}</p>}
          {session.fault?.message && !session.error && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{session.fault.message}</p>}
          {disabledReason && !active && <p role="status" className="mt-3 text-sm text-[var(--fg-muted)]">{disabledReason}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {active ? (
              <>
                <button type="button" onClick={() => audio.setPlayback(!audio.enabled)}
                  className="min-h-14 rounded-xl border border-[var(--line-strong)] px-3 font-semibold">
                  {audio.enabled ? "음성 끄기" : "음성 켜기"}
                </button>
                {session.phase === "interrupted" ? (
                  <button type="button" onClick={() => void session.resume()}
                    className="min-h-14 rounded-xl border border-[var(--accent)] px-3 font-semibold text-[var(--accent)]">인식 재개</button>
                ) : (
                  <button type="button" onClick={stop}
                    className="min-h-14 rounded-xl bg-[var(--brand-ink)] px-3 font-semibold text-[var(--brand-paper)]">통역 종료</button>
                )}
              </>
            ) : (
              <button type="button" disabled={!canStart} onClick={start}
                className="col-span-2 min-h-14 rounded-xl bg-[var(--brand-ink)] px-3 font-semibold text-[var(--brand-paper)] disabled:cursor-not-allowed disabled:opacity-40">
                통역 시작
              </button>
            )}
          </div>
          {session.phase === "interrupted" && (
            <button type="button" onClick={stop} className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] text-sm">세션 완전히 종료</button>
          )}
        </section>
        <p className="text-xs leading-relaxed text-[var(--fg-dim)]">
          실험용 보조 통역 기능이야. 음성 지연·오역·소리 출력 경로를 보증하지 않으며, 처분·신청·신원 확인에 대한 공식 통역으로 사용하면 안 돼.
          화면을 켜 둔 상태에서 테스트해. 실시간 음성은 기기와 브라우저 정책상 중단될 수 있어.
        </p>
      </main>
    </div>
  );
}
