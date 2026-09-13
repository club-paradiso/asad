"use client";

/**
 * The launcher.
 *
 * ONE QUESTION, ASKED ONCE: which language into which language. Everything
 * else the console used to demand before a word was spoken — sermon or
 * general, which recogniser, how far behind to run — is either inferred, or
 * decided for you and revisable later.
 *
 * "Sermon Mode" and "General Mode" are gone. They were a fork the product
 * carried in eleven places, made before anyone had spoken, and unrevisable
 * afterwards. The context is now inferred from the speech itself and is
 * visible in the console as a chip an interpreter can override in one tap.
 *
 * TWO CONSTRAINTS MEET HERE, and they look like they conflict:
 *
 *  1. `start()` must run inside the button's own click handler. The Web Speech
 *     API is permission-sensitive on Safari/iOS: deferring
 *     `SpeechRecognition.start()` to a mounted component effect loses the
 *     transient user activation from the tap, and recognition silently never
 *     begins.
 *
 *  2. Nothing may reach a cloud provider before the privacy disclosure has
 *     been acknowledged. The console used to fetch that disclosure after
 *     starting, so the microphone opened and the first words of the sermon
 *     were sent before the interpreter was told they would be.
 *
 * They reconcile by resolving consent BEFORE the tap rather than after it.
 * The disclosure is settled here, on the launcher, while the interpreter is
 * still choosing a language pair — and when it is outstanding, the
 * interpreter's "I understand" IS the user gesture that starts the session.
 * Both constraints hold, and neither is traded away.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ContextMode, ResolvedContext, StoredSession } from "@/types";
import { prepStore, settingsStore } from "@/lib/storage";
import { useLocalStore } from "@/lib/local-store";
import { useCapability } from "@/hooks/useCapability";
import {
  STT_PROVIDER_INFO,
  WebSpeechProvider,
  sttLanguageSupport,
  type CounterSttProvider,
  type SttProviderId,
} from "@/providers/stt";
import { Button } from "@/components/ui/primitives";
import { openSession, readSessionState } from "@/lib/session-client";
import type { AppConfig } from "@/app/api/config/route";
import { BRAND } from "@/lib/brand";
import { Wordmark } from "@/components/brand/Wordmark";
import {
  findLanguage,
  languageName,
  liveLanguagePairProblem,
  type LanguagePairProblem,
} from "@/lib/languages";
import { CONTEXT_LABEL_KO } from "@/interpreter/context/context-mode";
import { LiveConsole } from "./LiveConsole";
import { LanguagePair } from "./LanguagePair";
import { useLiveSession } from "./useLiveSession";
import { useBoothAudioInput } from "./useBoothAudioInput";
import { isBoothPreflightAcknowledged } from "./booth-preflight-ack";
import { preferredSttSource } from "./sourcePreference";
import { sttDisclosureFor, useCloudConsent } from "./useCloudConsent";
import { PrivacyDisclosure } from "./PrivacyDisclosure";
import { Readiness, type ReadinessRow } from "./Readiness";
import { SessionSummary } from "@/features/sessions/SessionSummary";

type Screen = "start" | "live" | "review";

/**
 * Korean labels for the launcher.
 *
 * They live here rather than in the shared modules on purpose: those are
 * shared with the live console, which stays in the TARGET language because its
 * CONTENT is the target language. The interpreter reading the console is
 * looking for the next line they have to say; a Korean word in that chrome is
 * a word in the wrong language sitting next to the one thing they are reading
 * at speed.
 *
 * The launcher is the opposite — nothing is being read aloud yet, the reader
 * is Korean, and the old screen mixed the two in a way that belonged to
 * neither. So: chrome follows the reader, content follows the work.
 *
 * Provider names stay Latin. "Deepgram" is a proper noun and transliterating
 * it helps nobody.
 */
const SOURCE_LABEL_KO: Partial<Record<SttProviderId, string>> = {
  demo: "데모",
  webspeech: "브라우저",
};

const PAIR_PROBLEM_KO: Record<LanguagePairProblem, string> = {
  "unknown-source": "이 언어는 라이브 통역의 입력으로 지원되지 않습니다.",
  "unknown-target": "이 언어는 통역 결과 언어로 지원되지 않습니다.",
  "same-language": "같은 언어끼리는 통역할 수 없습니다. 한쪽을 바꿔주세요.",
};

/** Which recogniser family a launcher source id corresponds to. */
const RECOGNISER: Partial<Record<SttProviderId, CounterSttProvider>> = {
  webspeech: "webspeech",
  deepgram: "deepgram",
  openai: "openai",
};

export function StartScreen() {
  const [screen, setScreen] = useState<Screen>("start");
  const [settings, updateSettings] = useLocalStore(settingsStore);
  const [prep] = useLocalStore(prepStore);
  const [sourceOverride, setSourceOverride] = useState<SttProviderId | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [finished, setFinished] = useState<StoredSession | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [boothPreflightVerified, setBoothPreflightVerified] = useState(false);

  /** Private-deployment gate, when one is configured. */
  const [gate, setGate] = useState<{ gated: boolean; authorised: boolean } | null>(null);
  const [accessKey, setAccessKey] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);

  const browserSttAvailable = useCapability(() => WebSpeechProvider.isSupported());

  // Ask the server once what it can actually do, so the launcher never offers
  // a cloud provider that will fail the moment the interpreter presses Start.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: AppConfig | null) => {
        if (cancelled || !value) return;
        setConfig(value);
      })
      .catch(() => {});
    void readSessionState().then((state) => {
      if (!cancelled) setGate(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const configuredSource = useMemo<SttProviderId>(
    () =>
      preferredSttSource({
        browserSttAvailable,
        cloudAvailable: config?.stt.cloudAvailable ?? false,
        configured: config?.stt.configured as SttProviderId | undefined,
      }),
    [browserSttAvailable, config],
  );

  const source = sourceOverride ?? configuredSource;
  const canChooseAudioInput = source !== "demo" && source !== "webspeech";
  const audioInputs = useBoothAudioInput(canChooseAudioInput);
  const audioDeviceId = audioInputs.deviceId;
  const selectedAudioLabel = audioInputs.selectedLabel;

  // The demo is an authored Korean sermon with authored English. Offering it on
  // any other pair would show an interpreter a translation of a language they
  // did not choose, so the pair is pinned while the demo is selected.
  const sourceLanguage = source === "demo" ? "ko-KR" : settings.sourceLanguage;
  const targetLanguage = source === "demo" ? "en-US" : settings.targetLanguage;
  const pairProblem = liveLanguagePairProblem(sourceLanguage, targetLanguage);

  useEffect(() => {
    const refresh = () =>
      setBoothPreflightVerified(
        settings.context === "worship" &&
          canChooseAudioInput &&
          audioInputs.selectionAvailable &&
          isBoothPreflightAcknowledged(audioDeviceId || undefined),
      );

    refresh();
    // The acknowledgement is intentionally short-lived. Re-check while the
    // launcher is left open so a four-hour-old sound check cannot remain green
    // forever just because nobody navigated away.
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [settings.context, canChooseAudioInput, audioDeviceId, audioInputs.selectionAvailable]);

  const session = useLiveSession({
    context: settings.context,
    sourceLanguage,
    targetLanguage,
    lag: settings.lag,
    prep,
    source,
    audioDeviceId: canChooseAudioInput ? audioDeviceId || undefined : undefined,
  });

  // Resolved here, before the tap, so pressing Start can never outrun it.
  const consent = useCloudConsent(source);

  const sources = useMemo(() => {
    const list: SttProviderId[] = ["demo"];
    if (browserSttAvailable) list.push("webspeech");
    if (config?.stt.cloudAvailable) list.push(config.stt.configured as SttProviderId);
    return [...new Set(list)];
  }, [browserSttAvailable, config]);

  const rows = useMemo(
    () =>
      readinessRows({
        config,
        context: settings.context === "auto" ? undefined : settings.context,
        source,
        sourceLanguage,
        targetLanguage,
        consent: consent.phase,
        audioInputLabel: selectedAudioLabel,
        audioInputSupported: audioInputs.supported,
        audioInputAvailable: audioInputs.selectionAvailable,
        boothPreflightVerified,
      }),
    [
      config,
      settings.context,
      source,
      sourceLanguage,
      targetLanguage,
      consent.phase,
      selectedAudioLabel,
      audioInputs.supported,
      audioInputs.selectionAvailable,
      boothPreflightVerified,
    ],
  );

  if (screen === "live") {
    return (
      <LiveConsole
        settings={{ ...settings, sourceLanguage, targetLanguage }}
        onSettingsChange={updateSettings}
        prep={prep}
        source={source}
        session={session}
        onEnd={(stored) => {
          setFinished(stored);
          setScreen(stored ? "review" : "start");
        }}
      />
    );
  }

  if (screen === "review" && finished) {
    return <SessionSummary session={finished} onClose={() => setScreen("start")} />;
  }

  /* --- Private deployment gate ------------------------------------------ */
  if (gate?.gated && !gate.authorised) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-sm flex-col justify-center gap-5 px-5 py-10">
        <header>
          <h1 className="break-all text-xl font-semibold tracking-tight">{BRAND.name}</h1>
          <p className="mt-1.5 text-sm text-[var(--fg-muted)]">
            This deployment is private. Enter its access key to continue.
          </p>
        </header>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setGateError(null);
            void openSession(accessKey).then((ok) => {
              if (ok) setGate({ gated: true, authorised: true });
              else setGateError("That key was not accepted.");
            });
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--fg-dim)]">
              Access key
            </span>
            <input
              type="password"
              value={accessKey}
              autoComplete="current-password"
              onChange={(event) => setAccessKey(event.target.value)}
              className="min-h-11 rounded-md border border-[var(--line-strong)] bg-[var(--bg-raised)] px-3 text-sm outline-none focus-visible:border-[var(--accent)]"
            />
          </label>
          {gateError && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {gateError}
            </p>
          )}
          <Button tone="primary" size="lg" type="submit">
            Continue
          </Button>
        </form>
      </div>
    );
  }

  const blocked = rows.some((row) => row.level === "blocked");
  const mayStart =
    consent.mayStart &&
    !pairProblem &&
    !blocked &&
    !(canChooseAudioInput && !audioInputs.selectionAvailable);

  /**
   * Start the session.
   *
   * Called synchronously from a click handler — the button's, or the
   * disclosure's "I understand". Both are user gestures, which is what keeps
   * Safari's recogniser permission alive.
   */
  const beginSession = () => {
    // Belt and braces around the invariant: nothing starts while consent is
    // unresolved, or on a pair that cannot work.
    if (!mayStart) return;
    setScreen("live");
    void session.start();
  };

  return (
    <div data-surface="launcher" className="min-h-[100dvh] w-full">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[80rem] flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-10">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--line)] pb-6">
          <div className="min-w-0">
            <h1 className="max-w-3xl break-all text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              <Wordmark variant="compact" />
              <span className="text-[var(--line-strong)]">/</span>
              <span>라이브 통역</span>
            </h1>
            <p className="mt-1 text-sm text-[var(--fg-muted)]">{BRAND.liveTagline}</p>
          </div>
          <Link
            href="/"
            className="ms-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 px-2 text-sm text-[var(--fg-muted)] underline-offset-4 hover:text-[var(--fg)] hover:underline"
          >
            <svg aria-hidden viewBox="0 0 20 20" className="size-4" fill="none">
              <path
                d="M12.5 4.5 7 10l5.5 5.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            홈
          </Link>
          <Link
            href="/diagnostics"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 px-2 text-sm font-medium text-[var(--accent)] underline-offset-4 hover:underline"
          >
            진단
            <svg aria-hidden viewBox="0 0 20 20" className="size-4" fill="none">
              <path
                d="m7.5 4.5 5.5 5.5-5.5 5.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </header>

        <main className="grid flex-1 gap-8 py-7 lg:grid-cols-[minmax(0,1.55fr)_minmax(22rem,1fr)] lg:gap-10 lg:py-0">
          <div className="flex min-w-0 flex-col gap-5 lg:py-8">
            {/* --- The one question ------------------------------------------ */}
            <LanguagePair
              source={sourceLanguage}
              target={targetLanguage}
              onSourceChange={(value) =>
                updateSettings({ ...settings, sourceLanguage: value })
              }
              onTargetChange={(value) =>
                updateSettings({ ...settings, targetLanguage: value })
              }
              onSwap={
                source === "demo"
                  ? undefined
                  : () =>
                      updateSettings({
                        ...settings,
                        sourceLanguage: targetLanguage,
                        targetLanguage: sourceLanguage,
                      })
              }
            />

            {pairProblem && (
              <p role="alert" className="text-sm font-medium text-[var(--danger)]">
                {PAIR_PROBLEM_KO[pairProblem]}
              </p>
            )}

            <Button
              tone="primary"
              size="lg"
              disabled={!mayStart}
              onClick={beginSession}
              className="w-full"
            >
              {consent.phase === "checking"
                ? "개인정보 설정 확인 중…"
                : consent.phase === "needed"
                  ? "개인정보 확인하고 시작"
                  : source === "demo"
                    ? "데모 실행"
                    : "통역 시작"}
            </Button>

            {/* --- Optional hints, never prerequisites ----------------------- */}
            <div className="flex flex-wrap items-center gap-2">
              <HintSelect
                label="상황"
                value={settings.context}
                onChange={(value) => updateSettings({ ...settings, context: value })}
                options={(Object.keys(CONTEXT_LABEL_KO) as ContextMode[]).map((mode) => ({
                  value: mode,
                  label: mode === "auto" ? `상황: ${CONTEXT_LABEL_KO.auto}` : CONTEXT_LABEL_KO[mode],
                }))}
                title="보통은 자동으로 두세요. ASAD가 말에서 상황을 알아서 읽습니다."
              />

              <Link
                href="/prep"
                className="inline-flex min-h-11 items-center rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-3 text-sm text-[var(--fg-muted)] hover:border-[var(--line-strong)] hover:text-[var(--fg)]"
              >
                용어·준비
                {prep.speaker || prep.title ? (
                  <span className="ml-1.5 text-[var(--accent)]">·</span>
                ) : null}
              </Link>

              {canChooseAudioInput && audioInputs.supported && (
                <select
                  aria-label="오디오 입력 장치"
                  value={audioDeviceId}
                  onChange={(event) => audioInputs.setDeviceId(event.target.value)}
                  className="min-h-11 max-w-[16rem] rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-3 text-sm text-[var(--fg-muted)] outline-none focus-visible:border-[var(--accent)]"
                >
                  {audioDeviceId && !audioInputs.selectionAvailable ? (
                    <option value={audioDeviceId} disabled>
                      이전에 선택한 입력 · 연결 끊김
                    </option>
                  ) : null}
                  <option value="">오디오: 시스템 기본값</option>
                  {audioInputs.devices
                    .filter((device) => device.deviceId !== "default")
                    .map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                </select>
              )}
            </div>

            {/* On a phone the readiness answers must be read before the action
                they qualify. The desktop copy stays in the sticky side rail. */}
            <div className="lg:hidden">
              <Readiness rows={rows} demo={source === "demo"} />
            </div>

            {/* --- Everything else ------------------------------------------- */}
            <details
              open={advanced}
              onToggle={(event) => setAdvanced((event.target as HTMLDetailsElement).open)}
              className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)]"
            >
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-medium marker:content-none">
                <span>
                  <span className="font-semibold text-[var(--accent)]">고급 설정</span>
                  <span className="ml-2 text-sm text-[var(--fg-muted)]">
                    인식 방식 · 지연 · 지난 세션
                  </span>
                </span>
                <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0 text-[var(--accent)]" fill="none">
                  <path
                    d="m7.5 4.5 5.5 5.5-5.5 5.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </summary>
              <div className="flex flex-col gap-4 border-t border-[var(--line)] px-4 py-3.5">
                <HintSelect
                  label="인식"
                  value={source}
                  onChange={(value) => setSourceOverride(value)}
                  options={sources.map((id) => ({
                    value: id,
                    label: `인식: ${SOURCE_LABEL_KO[id] ?? STT_PROVIDER_INFO[id].label}`,
                  }))}
                  title="음성 인식을 어디서 할지 고릅니다."
                />
                <HintSelect
                  label="지연"
                  value={settings.lag}
                  onChange={(value) => updateSettings({ ...settings, lag: value })}
                  options={[
                    { value: "fast", label: "지연: 빠르게 (~1초)" },
                    { value: "balanced", label: "지연: 기본 (~2–3초)" },
                    { value: "safe", label: "지연: 안전하게 (~4–6초)" },
                  ]}
                  title="화자보다 얼마나 뒤에서 따라갈지 정합니다."
                />
                <Link
                  href="/sessions"
                  className="text-sm text-[var(--fg-muted)] underline-offset-4 hover:text-[var(--fg)] hover:underline"
                >
                  지난 세션 보기
                </Link>
              </div>
            </details>

            <p className="mt-auto border-t border-[var(--line)] pt-5 text-xs leading-relaxed text-[var(--fg-dim)] sm:text-sm">
              통역 중 단축키 ·{" "}
              <strong className="font-semibold text-[var(--fg)]">Space</strong> 멈춤 ·{" "}
              <strong className="font-semibold text-[var(--fg)]">T</strong> 프롬프터 ·{" "}
              <strong className="font-semibold text-[var(--fg)]">K</strong> 원문 ·{" "}
              <strong className="font-semibold text-[var(--fg)]">G</strong> 용어 ·{" "}
              <strong className="font-semibold text-[var(--fg)]">+/−</strong> 글자 크기
            </p>
          </div>

          <aside className="hidden min-w-0 lg:block lg:py-8">
            <Readiness rows={rows} demo={source === "demo"} />
          </aside>
        </main>

        {/* Shown BEFORE anything opens. Accepting is the user gesture that
          starts the session, so consent and Safari's permission model are
          satisfied by the same tap. */}
        {consent.phase === "needed" && (
          <PrivacyDisclosure
            providers={consent.providers}
            onAccept={() => {
              consent.grant();
              // Not `beginSession()`: `consent` is the value captured by this
              // render, where the phase is still "needed", so the guard inside
              // it would refuse. Acknowledging IS the gesture, so start here.
              setScreen("live");
              void session.start();
            }}
            onUseLocalOnly={() => {
              consent.decline();
              setSourceOverride("demo");
            }}
          />
        )}
      </div>
    </div>
  );
}

/** A secondary control: one select, labelled in place, no surrounding card. */
function HintSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  title,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  title?: string;
}) {
  return (
    <select
      aria-label={label}
      title={title}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="min-h-11 rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-3 text-sm text-[var(--fg-muted)] outline-none hover:border-[var(--line-strong)] hover:text-[var(--fg)] focus-visible:border-[var(--accent)]"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The readiness answers.
 *
 * Exported for tests: "the launcher never tells an interpreter to set an
 * environment variable", and "an unsupported language pair is refused before
 * the microphone opens", are product rules worth asserting rather than
 * remembering.
 */
export function readinessRows(input: {
  config: AppConfig | null;
  context?: ResolvedContext;
  source: SttProviderId;
  sourceLanguage?: string;
  targetLanguage?: string;
  consent?: string;
  audioInputLabel?: string;
  audioInputSupported?: boolean;
  audioInputAvailable?: boolean;
  boothPreflightVerified?: boolean;
}): ReadinessRow[] {
  const { config, source } = input;
  const demo = source === "demo";
  const info = STT_PROVIDER_INFO[source];
  const sourceLanguage = input.sourceLanguage ?? "ko-KR";
  const targetLanguage = input.targetLanguage ?? "en-US";

  const language = languageRow({ demo, source, sourceLanguage, targetLanguage });

  const audio: ReadinessRow = demo
    ? { label: "입력", value: "녹음된 한국어 설교", level: "ready" }
    : source === "webspeech"
      ? {
          label: "입력",
          value: "시스템 기본 마이크",
          level: "limited",
          detail:
            "입력 장치는 브라우저 음성 인식이 고릅니다. 교회 믹서를 써야 한다면 예배 전에 시스템 입력을 먼저 지정해 두세요.",
        }
      : input.audioInputSupported === false
        ? {
            label: "입력",
            value: "이 브라우저는 오디오 입력 목록을 읽지 못합니다",
            level: "limited",
          }
        : input.audioInputAvailable === false
          ? {
              label: "입력",
              value: "이전에 선택한 오디오 입력의 연결이 끊겼습니다",
              level: "blocked",
              detail: "입력을 다시 연결하거나 시스템 기본값 또는 다른 입력을 선택하세요.",
            }
          : input.context === "worship" && input.boothPreflightVerified !== true
            ? {
                label: "입력",
                value: `${input.audioInputLabel ?? "시스템 기본값"} · 사전 점검 안 됨`,
                level: "limited",
                detail:
                  "부스 사전 점검으로 프로그램 피드와 mix-minus가 쓸 만한지 확인하세요. 지금 바로 부스를 돌려야 한다면 그대로 시작해도 됩니다.",
              }
            : {
                label: "입력",
                value: input.audioInputLabel ?? "시스템 기본값",
                level: "ready",
                detail:
                  "부스에서는 실내 마이크보다 교회 믹서나 USB 오디오 인터페이스 피드를 쓰는 편이 낫습니다.",
              };

  const recognition: ReadinessRow = demo
    ? { label: "인식", value: "녹음에 포함되어 있습니다", level: "ready" }
    : source === "webspeech"
      ? {
          label: "인식",
          value: "브라우저가 인식을 관리합니다",
          // Genuinely a limitation, and one that bites mid-service: Safari's
          // recogniser stops on a long silence and has to be restarted.
          level: "limited",
          detail:
            "브라우저 제공자의 서버로 음성이 전송될 수 있습니다. 크롬에서 가장 정확하고, 사파리는 일부만 지원하며 오래 조용하면 멈출 수 있습니다.",
        }
      : { label: "인식", value: `${info.label} 스트리밍`, level: "ready" };

  // The line that used to name environment variables. It now describes what
  // the interpreter will see on screen.
  const interpretation: ReadinessRow = !config
    ? { label: "AI", value: "확인 중…", level: "limited" }
    : !config.llm.modelAvailable
      ? {
          label: "AI",
          value: "규칙 기반만 사용",
          level: "limited",
          detail:
            "성경 구절 · 용어 · 말놀이는 그대로 짚어줍니다. 다만 통역 문장은 번역이 아니라 규칙으로 만들어집니다.",
        }
      : !config.llm.sustainsLiveSermon
        ? {
            label: "AI",
            value: `${config.llm.configured} — 용량 제한`,
            level: "limited",
            detail:
              `${config.llm.capacityNote ?? ""} 지원되는 데스크톱 Chrome에서는 기기 내 번역으로 전환되며, 그 외 브라우저에서는 규칙 기반 보조만 남습니다.`.trim(),
          }
        : { label: "AI", value: config.llm.configured, level: "ready" };

  const disclosure = [
    ...sttDisclosureFor(source),
    ...(config?.llm.freeTierDisclosure ?? []),
  ];
  const disclosureAcknowledged =
    input.consent === "granted" || input.consent === "clear";

  const privacy: ReadinessRow = demo
    ? { label: "개인정보", value: "이 기기 밖으로 나가지 않습니다", level: "ready" }
    : !config || input.consent === "checking"
      ? { label: "개인정보", value: "확인 중…", level: "limited" }
      : disclosure.length > 0 && !disclosureAcknowledged
        ? {
            label: "개인정보",
            value: "시작 전에 확인이 필요합니다",
            level: "limited",
            detail: `음성과 말한 내용이 ${disclosure
              .map((p) => p.label)
              .join(", ")}(으)로 전송될 수 있습니다. 시작 전에 제공자별 처리 정책을 다시 한 번 확인합니다.`,
          }
        : disclosure.length > 0
          ? {
              label: "개인정보",
              value: "외부 제공자 정책 확인됨",
              level: "limited",
              detail: `음성과 말한 내용이 ${disclosure
                .map((p) => p.label)
                .join(", ")}(으)로 전송됩니다. ${disclosure.map((p) => p.note).join(" ")}`,
            }
          : { label: "개인정보", value: "외부 전송 없음", level: "ready" };

  return [language, audio, recognition, interpretation, privacy];
}

/**
 * Whether the chosen pair can actually be served, and by what.
 *
 * The whole point of this row is that it answers BEFORE the microphone opens.
 * An unsupported pair, a language no configured recogniser covers, and a
 * recogniser that will lose the script variant are three different answers and
 * the interpreter can act on each of them differently.
 */
function languageRow(input: {
  demo: boolean;
  source: SttProviderId;
  sourceLanguage: string;
  targetLanguage: string;
}): ReadinessRow {
  const pair = `${languageName(input.sourceLanguage)} → ${languageName(input.targetLanguage)}`;
  const problem = liveLanguagePairProblem(input.sourceLanguage, input.targetLanguage);
  if (problem) {
    return { label: "언어", value: pair, level: "blocked", detail: PAIR_PROBLEM_KO[problem] };
  }

  if (input.demo) {
    return { label: "언어", value: "한국어 → English (데모 고정)", level: "ready" };
  }

  const recogniser = RECOGNISER[input.source];
  const support = recogniser ? sttLanguageSupport(recogniser, input.sourceLanguage) : "unsupported";

  if (support === "unsupported") {
    return {
      label: "언어",
      value: pair,
      level: "blocked",
      detail: `선택한 인식 방식은 ${languageName(input.sourceLanguage)} 음성을 처리하지 못합니다. 고급 설정에서 인식 방식을 바꾸거나 다른 입력 언어를 고르세요.`,
    };
  }

  if (support === "variant-lossy") {
    const definition = findLanguage(input.sourceLanguage);
    return {
      label: "언어",
      value: `${pair} · 표기 주의`,
      level: "limited",
      detail: `선택한 인식 방식은 ${definition?.base ?? ""} 기본 언어만 받습니다. 소리는 인식되지만 원문 표기가 ${definition?.endonym ?? ""} 쪽 표기와 다를 수 있습니다.`,
    };
  }

  if (support === "experimental") {
    return {
      label: "언어",
      value: `${pair} · 실험적`,
      level: "limited",
      detail: "이 언어의 인식 품질은 아직 검증되지 않았습니다. 이름과 숫자는 한 번 더 확인하세요.",
    };
  }

  return { label: "언어", value: pair, level: "ready" };
}
