"use client";

/**
 * The launcher.
 *
 * Requirement: live interpretation in three interactions or fewer — pick the
 * languages, press Start, speak — and an honest answer to four questions
 * before any of them:
 *
 *   Am I ready?   Which languages?   Which input?   Can I start?
 *
 * There is no Mode. Sermon intelligence is something the Context Engine
 * switches on when the room turns out to be a service; the interpreter is
 * never asked to declare it. "맥락" exists as a secondary control for the
 * case where they want to override that judgement, and it defaults to 자동.
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
 *     starting, so the microphone opened and the first sentence was sent
 *     before the interpreter was told it would be.
 *
 * They reconcile by resolving consent BEFORE the tap rather than after it.
 * The disclosure is settled here, on the launcher, while the interpreter is
 * still choosing languages — and when it is outstanding, the interpreter's
 * "I understand" IS the user gesture that starts the session. Both constraints
 * hold, and neither is traded away.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ContextDomain, StoredSession } from "@/types";
import { CONTEXT_DOMAINS } from "@/types";
import { prepStore, settingsStore } from "@/lib/storage";
import { useLocalStore } from "@/lib/local-store";
import { useCapability } from "@/hooks/useCapability";
import {
  STT_PROVIDER_INFO,
  WebSpeechProvider,
  type SttProviderId,
} from "@/providers/stt";
import { canonicalPair, isKoreanToEnglish, type LanguagePairIds } from "@/languages/registry";
import { Button, Segmented } from "@/components/ui/primitives";
import { openSession, readSessionState } from "@/lib/session-client";
import type { AppConfig } from "@/app/api/config/route";
import { BRAND } from "@/lib/brand";
import { Wordmark } from "@/components/brand/Wordmark";
import { cn } from "@/lib/cn";
import { LiveConsole } from "./LiveConsole";
import { useLiveSession } from "./useLiveSession";
import { useBoothAudioInput } from "./useBoothAudioInput";
import { isBoothPreflightAcknowledged } from "./booth-preflight-ack";
import { preferredSttSource } from "./sourcePreference";
import { sttDisclosureFor, useCloudConsent } from "./useCloudConsent";
import { PrivacyDisclosure } from "./PrivacyDisclosure";
import { Readiness, type ReadinessRow } from "./Readiness";
import { LanguagePairPicker } from "./LanguagePairPicker";
import {
  CONTEXT_LABEL_KO,
  LAG_DETAIL_KO,
  LAG_LABEL_KO,
  SOURCE_DETAIL_KO,
  SOURCE_LABEL_KO,
} from "./live-strings";
import { SessionSummary } from "@/features/sessions/SessionSummary";

type Screen = "start" | "live" | "review";

const CLOUD_SOURCES: readonly SttProviderId[] = ["deepgram", "openai"];

/**
 * Whether the booth sound check is worth insisting on.
 *
 * Simple on purpose: a service (the interpreter said so), or a cloud
 * recogniser fed from a physical input someone chose — which is what a booth
 * looks like from here. A laptop microphone in a meeting is not asked to
 * check a mix-minus it does not have.
 */
export function boothPreflightApplies(input: {
  context: ContextDomain;
  source: SttProviderId;
  audioDeviceSelected?: boolean;
}): boolean {
  const worship = input.context === "worship" || input.context === "sermon";
  const boothInput = CLOUD_SOURCES.includes(input.source) && input.audioDeviceSelected === true;
  return worship || boothInput;
}

export function StartScreen() {
  const [screen, setScreen] = useState<Screen>("start");
  const [settings, updateSettings] = useLocalStore(settingsStore);
  const [prep] = useLocalStore(prepStore);
  const [sourceOverride, setSourceOverride] = useState<SttProviderId | null>(
    null,
  );
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [finished, setFinished] = useState<StoredSession | null>(null);
  const [boothPreflightVerified, setBoothPreflightVerified] = useState(false);

  /** Private-deployment gate, when one is configured. */
  const [gate, setGate] = useState<{
    gated: boolean;
    authorised: boolean;
  } | null>(null);
  const [accessKey, setAccessKey] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);

  const browserSttAvailable = useCapability(() =>
    WebSpeechProvider.isSupported(),
  );

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

  const languagePair = useMemo<LanguagePairIds>(
    () => canonicalPair({ source: settings.sourceLanguage, target: settings.targetLanguage }),
    [settings.sourceLanguage, settings.targetLanguage],
  );
  // The scripted demo is a Korean sermon. Any other pair has no demo.
  const demoAvailable = isKoreanToEnglish(languagePair);

  const configuredSource = useMemo<SttProviderId>(
    () =>
      preferredSttSource({
        browserSttAvailable,
        cloudAvailable: config?.stt.cloudAvailable ?? false,
        configured: config?.stt.configured as SttProviderId | undefined,
      }),
    [browserSttAvailable, config],
  );

  const chosenSource = sourceOverride ?? configuredSource;
  // A pair with no demo silently prefers the browser recogniser; failing
  // that, whatever cloud recogniser the deployment has. Only when there is
  // nothing else does it stay on demo — and then Start says why it is off.
  const source: SttProviderId =
    chosenSource === "demo" && !demoAvailable
      ? browserSttAvailable
        ? "webspeech"
        : config?.stt.cloudAvailable
          ? (config.stt.configured as SttProviderId)
          : "demo"
      : chosenSource;
  const demoMismatch = source === "demo" && !demoAvailable;

  const canChooseAudioInput = source !== "demo" && source !== "webspeech";
  const audioInputs = useBoothAudioInput(canChooseAudioInput);
  const audioDeviceId = audioInputs.deviceId;
  const selectedAudioLabel = audioInputs.selectedLabel;
  const boothPreflightExpected = boothPreflightApplies({
    context: settings.context,
    source,
    audioDeviceSelected: !!audioDeviceId,
  });

  useEffect(() => {
    const refresh = () =>
      setBoothPreflightVerified(
        boothPreflightExpected &&
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
  }, [boothPreflightExpected, canChooseAudioInput, audioDeviceId, audioInputs.selectionAvailable]);

  const session = useLiveSession({
    languagePair,
    context: settings.context,
    lag: settings.lag,
    prep,
    source,
    audioDeviceId: canChooseAudioInput ? audioDeviceId || undefined : undefined,
    rememberCorrections: settings.rememberCorrections,
  });

  // Resolved here, before the tap, so pressing Start can never outrun it.
  const consent = useCloudConsent(source);

  const sources = useMemo(() => {
    const list: SttProviderId[] = demoAvailable ? ["demo"] : [];
    if (browserSttAvailable) list.push("webspeech");
    if (config?.stt.cloudAvailable)
      list.push(config.stt.configured as SttProviderId);
    if (list.length === 0) list.push("demo");
    return [...new Set(list)];
  }, [browserSttAvailable, config, demoAvailable]);

  const rows = useMemo(
    () =>
      readinessRows({
        config,
        context: settings.context,
        source,
        consent: consent.phase,
        audioInputLabel: selectedAudioLabel,
        audioInputSupported: audioInputs.supported,
        audioInputAvailable: audioInputs.selectionAvailable,
        audioDeviceSelected: !!audioDeviceId,
        boothPreflightVerified,
      }),
    [
      config,
      settings.context,
      source,
      consent.phase,
      selectedAudioLabel,
      audioInputs.supported,
      audioInputs.selectionAvailable,
      audioDeviceId,
      boothPreflightVerified,
    ],
  );

  if (screen === "live") {
    return (
      <LiveConsole
        settings={settings}
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
    return (
      <SessionSummary session={finished} onClose={() => setScreen("start")} />
    );
  }

  /* --- Private deployment gate ------------------------------------------ */
  if (gate?.gated && !gate.authorised) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-sm flex-col justify-center gap-5 px-5 py-10">
        <header>
          <h1 className="break-all text-xl font-semibold tracking-tight">
            {BRAND.name}
          </h1>
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

  const startBlocked =
    !consent.mayStart ||
    demoMismatch ||
    (canChooseAudioInput && !audioInputs.selectionAvailable);

  /**
   * Start the session.
   *
   * Called synchronously from a click handler — the button's, or the
   * disclosure's "I understand". Both are user gestures, which is what keeps
   * Safari's recogniser permission alive.
   */
  const beginSession = () => {
    // Belt and braces around the invariant: nothing starts while consent is
    // unresolved or outstanding, whatever the button happens to be doing.
    if (startBlocked) return;
    setScreen("live");
    void session.start();
  };

  const prepReady = !!(prep.speaker || prep.title || prep.glossary.length > 0);
  const audioSummary = [
    SOURCE_LABEL_KO[source] ?? STT_PROVIDER_INFO[source].label,
    canChooseAudioInput ? selectedAudioLabel : null,
    LAG_LABEL_KO[settings.lag],
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div data-surface="launcher" className="min-h-[100dvh] w-full">
      <div
        className="mx-auto flex min-h-[100dvh] w-full max-w-[80rem] flex-col px-5 sm:px-8 lg:px-10"
        style={{
          paddingTop: "calc(1.5rem + var(--safe-top))",
          paddingBottom: "calc(1.5rem + var(--safe-bottom))",
        }}
      >
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--line)] pb-6">
          <div className="min-w-0">
            <h1 className="flex max-w-3xl flex-wrap items-baseline gap-x-2 text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              <Wordmark variant="compact" />
              <span className="type-display">Live</span>
            </h1>
            <p className="mt-1 text-sm text-[var(--fg-muted)]">
              {BRAND.liveTagline}
            </p>
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
            {/* --- 1. Languages ------------------------------------------- */}
            <section aria-label="언어" className="flex flex-col gap-2">
              <LanguagePairPicker
                value={languagePair}
                onChange={(pair) =>
                  updateSettings({
                    ...settings,
                    sourceLanguage: pair.source,
                    targetLanguage: pair.target,
                  })
                }
              />
            </section>

            {/* --- 2. Start ---------------------------------------------- */}
            <Button
              tone="primary"
              size="lg"
              // Disabled only while we genuinely do not yet know what starting
              // would send. That window is short and it is the one the old
              // race lived in.
              disabled={startBlocked}
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
            {demoMismatch && (
              <p className="text-sm text-[var(--warn)]" role="status">
                이 언어 쌍에는 데모가 없고, 이 브라우저에는 쓸 수 있는 음성 인식이 없습니다. Chrome에서
                열거나 한국어 → 영어로 바꿔 데모를 실행하세요.
              </p>
            )}

            {/* --- 3. Everything secondary -------------------------------- */}
            <div className="flex flex-wrap items-start gap-2">
              <details className="group min-w-0 open:basis-full">
                <summary className={quietSummary}>
                  <span className="text-[var(--fg-dim)]">맥락:</span>{" "}
                  {CONTEXT_LABEL_KO[settings.context]}
                  <Chevron />
                </summary>
                <div
                  role="radiogroup"
                  aria-label="통역 맥락"
                  className="mt-2 grid grid-cols-3 gap-1 rounded-xl border border-[var(--line)] bg-[var(--bg-raised)] p-1 sm:grid-cols-5"
                >
                  {CONTEXT_DOMAINS.map((option) => {
                    const selected = settings.context === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => updateSettings({ ...settings, context: option })}
                        className={cn(
                          "min-h-11 rounded-lg px-2 text-sm transition-[color,background-color]",
                          selected
                            ? "bg-[var(--accent)] font-semibold text-[var(--accent-contrast)] shadow-sm"
                            : "text-[var(--fg-muted)] hover:bg-[var(--accent-dim)] hover:text-[var(--fg)]",
                        )}
                      >
                        {CONTEXT_LABEL_KO[option]}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 px-1 text-xs leading-relaxed text-[var(--fg-dim)]">
                  자동이면 준비 시트와 들리는 내용으로 예배·회의·강의를 스스로 알아차립니다. 직접
                  고르면 그 판단을 덮어씁니다.
                </p>
              </details>

              <Link href="/prep" className={quietSummary}>
                용어집
                {prepReady ? (
                  <span className="ml-1.5 text-[var(--accent)]">· ready</span>
                ) : null}
              </Link>

              <details className="group min-w-0 open:basis-full">
                <summary className={quietSummary}>
                  <span className="text-[var(--fg-dim)]">오디오 입력:</span> {audioSummary}
                  <Chevron />
                </summary>
                <div className="mt-2 flex flex-col gap-4 rounded-xl border border-[var(--line)] bg-[var(--bg-raised)] p-4">
                  <ControlRow label="입력">
                    {source === "demo" ? (
                      <p className="min-h-11 py-2.5 text-sm text-[var(--fg-muted)]">
                        녹음된 한국어 설교
                      </p>
                    ) : source === "webspeech" ? (
                      <p className="min-h-11 py-2.5 text-sm text-[var(--fg-muted)]">
                        시스템 기본값 · 마이크는 브라우저 인식이 제어합니다
                      </p>
                    ) : (
                      <select
                        aria-label="오디오 입력 장치"
                        value={audioDeviceId}
                        onChange={(event) => audioInputs.setDeviceId(event.target.value)}
                        className="min-h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--bg-overlay)] px-3 text-sm text-[var(--fg)] outline-none focus-visible:border-[var(--accent)]"
                      >
                        {audioDeviceId && !audioInputs.selectionAvailable ? (
                          <option value={audioDeviceId} disabled>
                            이전에 선택한 입력 · 연결 끊김
                          </option>
                        ) : null}
                        <option value="">시스템 기본값</option>
                        {audioInputs.devices
                          .filter((device) => device.deviceId !== "default")
                          .map((device) => (
                            <option key={device.deviceId} value={device.deviceId}>
                              {device.label}
                            </option>
                          ))}
                      </select>
                    )}
                  </ControlRow>

                  <ControlRow label="인식">
                    <Segmented
                      label="음성 인식"
                      indicator
                      value={source}
                      onChange={setSourceOverride}
                      options={sources.map((id) => ({
                        value: id,
                        label: SOURCE_LABEL_KO[id] ?? STT_PROVIDER_INFO[id].label,
                        title: SOURCE_DETAIL_KO[id] ?? STT_PROVIDER_INFO[id].detail,
                      }))}
                    />
                  </ControlRow>

                  <ControlRow label="지연">
                    <Segmented
                      label="통역 지연"
                      indicator
                      value={settings.lag}
                      onChange={(lag) => updateSettings({ ...settings, lag })}
                      options={(["fast", "balanced", "safe"] as const).map(
                        (lag) => ({
                          value: lag,
                          label: LAG_LABEL_KO[lag],
                          title: LAG_DETAIL_KO[lag],
                        }),
                      )}
                    />
                  </ControlRow>
                  <p className="text-sm text-[var(--fg-muted)] sm:pl-28">
                    {LAG_DETAIL_KO[settings.lag]}
                  </p>

                  {/* On a phone the readiness answers live here, next to the
                      controls that change them. The desktop copy stays in the
                      sticky side rail. */}
                  <div className="lg:hidden">
                    <Readiness rows={rows} demo={source === "demo"} />
                  </div>
                </div>
              </details>
            </div>

            <div className="mt-auto flex flex-col gap-3 border-t border-[var(--line)] pt-5 text-xs leading-relaxed text-[var(--fg-dim)] sm:text-sm">
              <p>
                통역 중 단축키 ·{" "}
                <strong className="font-semibold text-[var(--fg)]">Space</strong>{" "}
                멈춤 ·{" "}
                <strong className="font-semibold text-[var(--fg)]">T</strong>{" "}
                프롬프터 ·{" "}
                <strong className="font-semibold text-[var(--fg)]">K</strong>{" "}
                원문 ·{" "}
                <strong className="font-semibold text-[var(--fg)]">G</strong>{" "}
                용어 ·{" "}
                <strong className="font-semibold text-[var(--fg)]">+/−</strong>{" "}
                글자 크기 · 원문을 길게 누르면 이름·용어를 고칠 수 있습니다
              </p>
              <Link
                href="/sessions"
                className="self-start underline-offset-4 hover:text-[var(--fg)] hover:underline"
              >
                지난 세션 보기
              </Link>
            </div>
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

/** The three quiet controls under Start share one look: a chip, not a button. */
const quietSummary =
  "inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--bg-raised)] px-3.5 text-sm text-[var(--fg)] shadow-sm transition-[background-color,border-color] hover:border-[var(--line-strong)] hover:bg-[var(--accent-dim)] marker:content-none [&::-webkit-details-marker]:hidden";

function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="ml-0.5 size-3.5 shrink-0 text-[var(--fg-dim)] transition-transform group-open:rotate-180"
      fill="none"
    >
      <path
        d="m6.5 8 3.5 3.5L13.5 8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ControlRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
      <span className="brand-caption">{label}</span>
      <div className="min-w-0 [&_[role=radio]]:flex-1 [&_[role=radiogroup]]:flex [&_[role=radiogroup]]:w-full">
        {children}
      </div>
    </div>
  );
}

/**
 * The four readiness answers.
 *
 * Exported for tests: "the launcher never tells an interpreter to set an
 * environment variable" is a product rule worth asserting rather than
 * remembering. So is "no Mode": the rows take a context, never a mode.
 */
export function readinessRows(input: {
  config: AppConfig | null;
  /** The interpreter's context override; `auto` normally. */
  context?: ContextDomain;
  source: SttProviderId;
  consent?: string;
  audioInputLabel?: string;
  audioInputSupported?: boolean;
  audioInputAvailable?: boolean;
  /** True when a specific physical input (not the system default) is chosen. */
  audioDeviceSelected?: boolean;
  boothPreflightVerified?: boolean;
}): ReadinessRow[] {
  const { config, source } = input;
  const demo = source === "demo";
  const info = STT_PROVIDER_INFO[source];
  const preflightExpected = boothPreflightApplies({
    context: input.context ?? "auto",
    source,
    audioDeviceSelected: input.audioDeviceSelected,
  });

  const audio: ReadinessRow = demo
    ? {
        label: "입력",
        value: "녹음된 한국어 설교",
        level: "ready",
      }
    : source === "webspeech"
      ? {
          label: "입력",
          value: "시스템 기본 마이크",
          level: "limited",
          detail:
            "입력 장치는 브라우저 음성 인식이 고릅니다. 믹서를 써야 한다면 시작 전에 시스템 입력을 먼저 지정해 두세요.",
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
        : preflightExpected && input.boothPreflightVerified !== true
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
                "부스에서는 실내 마이크보다 믹서나 USB 오디오 인터페이스 피드를 쓰는 편이 낫습니다.",
            };

  const recognition: ReadinessRow = demo
    ? {
        label: "인식",
        value: "녹음에 포함되어 있습니다",
        level: "ready",
      }
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
      : {
          label: "인식",
          value: `${info.label} 스트리밍`,
          level: "ready",
        };

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
            "성경 구절 · 용어 · 말놀이는 그대로 짚어줍니다. 다만 번역문은 번역이 아니라 규칙으로 만들어집니다.",
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
                .join(", ")}(으)로 전송됩니다. ${disclosure
                .map((p) => p.note)
                .join(" ")}`,
            }
          : {
              label: "개인정보",
              value: "외부 전송 없음",
              level: "ready",
            };

  return [audio, recognition, interpretation, privacy];
}
