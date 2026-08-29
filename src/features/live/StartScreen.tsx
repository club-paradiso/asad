"use client";

/**
 * The launcher.
 *
 * Requirement: live interpretation in three interactions or fewer, and an
 * honest answer to four questions before any of them —
 *
 *   Am I ready?   What am I interpreting?   Which microphone?   Can I start?
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
 *     starting, so the microphone opened and the first Korean of the sermon
 *     was sent before the interpreter was told it would be.
 *
 * They reconcile by resolving consent BEFORE the tap rather than after it.
 * The disclosure is settled here, on the launcher, while the interpreter is
 * still choosing a mode — and when it is outstanding, the interpreter's
 * "I understand" IS the user gesture that starts the session. Both constraints
 * hold, and neither is traded away.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { InterpretationMode, LagProfile, StoredSession } from "@/types";
import { prepStore, settingsStore } from "@/lib/storage";
import { useLocalStore } from "@/lib/local-store";
import { useCapability } from "@/hooks/useCapability";
import {
  STT_PROVIDER_INFO,
  WebSpeechProvider,
  type SttProviderId,
} from "@/providers/stt";
import { Button, Segmented } from "@/components/ui/primitives";
import { openSession, readSessionState } from "@/lib/session-client";
import type { AppConfig } from "@/app/api/config/route";
import { BRAND } from "@/lib/brand";
import { Wordmark } from "@/components/brand/Wordmark";
import { LiveConsole } from "./LiveConsole";
import { useLiveSession } from "./useLiveSession";
import { preferredSttSource } from "./sourcePreference";
import { useCloudConsent } from "./useCloudConsent";
import { PrivacyDisclosure } from "./PrivacyDisclosure";
import { Readiness, type ReadinessRow } from "./Readiness";
import { SessionSummary } from "@/features/sessions/SessionSummary";

type Screen = "start" | "live" | "review";

/**
 * Korean labels for the launcher.
 *
 * They live here rather than in `lag.ts` / `providers/stt` on purpose: those
 * modules are shared with the live console, which stays English because its
 * CONTENT is English. The interpreter reading the console is looking for the
 * next line they have to say; a Korean word in that chrome is a word in the
 * wrong language sitting next to the one thing they are reading at speed.
 *
 * The launcher is the opposite — nothing is being read aloud yet, the reader
 * is Korean, and the old screen mixed the two in a way that belonged to
 * neither. So: chrome follows the reader, content follows the work.
 *
 * Provider names stay Latin. "Deepgram" is a proper noun and transliterating
 * it helps nobody.
 */
const LAG_LABEL_KO: Record<LagProfile, string> = {
  fast: "빠르게",
  balanced: "기본",
  safe: "안전하게",
};

const LAG_DETAIL_KO: Record<LagProfile, string> = {
  fast: "약 1초 뒤따라갑니다 — 예측이 가장 많고, 고칠 일도 가장 많습니다",
  balanced: "약 2–3초 뒤따라갑니다 — 평소 작업용 기본값",
  safe: "약 4–6초 뒤따라갑니다 — 문장이 끝나길 기다리고, 예측하지 않습니다",
};

const SOURCE_LABEL_KO: Partial<Record<SttProviderId, string>> = {
  demo: "데모",
  webspeech: "브라우저",
};

const SOURCE_DETAIL_KO: Partial<Record<SttProviderId, string>> = {
  demo: "미리 녹음된 설교 — 마이크도 키도 필요 없고, 오프라인에서도 됩니다",
  webspeech:
    "기기 안에서 인식합니다 — 키 불필요. 크롬에서 가장 정확하고, 사파리는 일부만 됩니다",
  deepgram: "한국어 스트리밍 — 중간 결과와 용어 힌트를 지원합니다",
  openai: "웹소켓 기반 실시간 인식",
};

export function StartScreen() {
  const [screen, setScreen] = useState<Screen>("start");
  const [settings, updateSettings] = useLocalStore(settingsStore);
  const [prep] = useLocalStore(prepStore);
  const [sourceOverride, setSourceOverride] = useState<SttProviderId | null>(
    null,
  );
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [finished, setFinished] = useState<StoredSession | null>(null);
  const [advanced, setAdvanced] = useState(false);

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

  const session = useLiveSession({
    mode: settings.mode,
    lag: settings.lag,
    prep,
    source,
  });

  // Resolved here, before the tap, so pressing Start can never outrun it.
  const consent = useCloudConsent(source);

  const sources = useMemo(() => {
    const list: SttProviderId[] = ["demo"];
    if (browserSttAvailable) list.push("webspeech");
    if (config?.stt.cloudAvailable)
      list.push(config.stt.configured as SttProviderId);
    return [...new Set(list)];
  }, [browserSttAvailable, config]);

  const rows = useMemo(
    () => readinessRows({ config, source, consent: consent.phase }),
    [config, source, consent.phase],
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
    if (!consent.mayStart) return;
    setScreen("live");
    void session.start();
  };

  return (
    <div data-surface="launcher" className="min-h-[100dvh] w-full">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[80rem] flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-10">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--line)] pb-6">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 text-lg font-semibold tracking-[-0.02em]">
              <Wordmark variant="compact" />
              <span className="text-[var(--line-strong)]">/</span>
              <span>라이브 통역</span>
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
            모드 선택
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
            {/* --- Session configuration ----------------------------------------
              Segmented rows rather than description cards: the descriptions were
              prep-time reading occupying launch-time space, and they were what
              pushed Start below the fold on a phone. */}
            <section className="flex flex-col gap-4">
              <ControlRow label="모드">
                <Segmented
                  label="통역 모드"
                  indicator
                  value={settings.mode}
                  onChange={(mode) => updateSettings({ ...settings, mode })}
                  options={(["sermon", "general"] as InterpretationMode[]).map(
                    (mode) => ({
                      value: mode,
                      label: mode === "sermon" ? "설교" : "일반",
                      title:
                        mode === "sermon"
                          ? "성경 구절 인식, 신학 용어, 교회 말투, 말놀이까지 살핍니다."
                          : "회의 · 강연 · 인터뷰. 신학적 전제 없이 옮깁니다.",
                    }),
                  )}
                />
              </ControlRow>

              <ControlRow label="소리">
                <Segmented
                  label="소리 입력"
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
            </section>

            <Button
              tone="primary"
              size="lg"
              // Disabled only while we genuinely do not yet know what starting would
              // send. That window is short and it is the one the old race lived in.
              disabled={!consent.mayStart}
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

            {/* --- Everything optional ------------------------------------------ */}
            <details
              open={advanced}
              onToggle={(event) =>
                setAdvanced((event.target as HTMLDetailsElement).open)
              }
              className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)]"
            >
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-medium marker:content-none">
                <span>
                  <span className="font-semibold text-[var(--fg)]">
                    시작 전에 챙길 것
                  </span>
                  <span className="ml-2 text-sm text-[var(--fg-muted)]">
                    준비 시트 · 지난 세션
                  </span>
                </span>
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  className="size-4 shrink-0 text-[var(--accent)]"
                  fill="none"
                >
                  <path
                    d="m7.5 4.5 5.5 5.5-5.5 5.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </summary>
              <div className="flex flex-col gap-3 border-t border-[var(--line)] px-4 py-3.5">
                <Link
                  href="/prep"
                  className="text-sm text-[var(--fg-muted)] underline-offset-4 hover:text-[var(--fg)] hover:underline"
                >
                  준비 시트 작성
                  {prep.speaker || prep.title ? (
                    <span className="ml-1.5 font-semibold text-[var(--ok)]">
                      · 입력됨
                    </span>
                  ) : null}
                </Link>
                <Link
                  href="/sessions"
                  className="text-sm text-[var(--fg-muted)] underline-offset-4 hover:text-[var(--fg)] hover:underline"
                >
                  지난 세션 보기
                </Link>
                {/* Counter Mode is no longer buried here. It is a different job
                  on the same footing, and it now has its own entry alongside
                  this one on the home screen — which is what the comment that
                  used to sit above this link already claimed. */}
              </div>
            </details>

            <p className="mt-auto border-t border-[var(--line)] pt-5 text-xs leading-relaxed text-[var(--fg-dim)] sm:text-sm">
              통역 중 단축키 ·{" "}
              <strong className="font-semibold text-[var(--fg)]">Space</strong>{" "}
              멈춤 ·{" "}
              <strong className="font-semibold text-[var(--fg)]">T</strong>{" "}
              프롬프터 ·{" "}
              <strong className="font-semibold text-[var(--fg)]">K</strong>{" "}
              한국어 ·{" "}
              <strong className="font-semibold text-[var(--fg)]">G</strong>{" "}
              용어 ·{" "}
              <strong className="font-semibold text-[var(--fg)]">+/−</strong>{" "}
              글자 크기
            </p>
          </div>

          <aside className="min-w-0 lg:py-8">
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
 * remembering.
 */
export function readinessRows(input: {
  config: AppConfig | null;
  source: SttProviderId;
  consent?: string;
}): ReadinessRow[] {
  const { config, source } = input;
  const demo = source === "demo";
  const info = STT_PROVIDER_INFO[source];

  const audio: ReadinessRow = demo
    ? {
        label: "소리",
        value: "녹음된 한국어 설교 — 마이크 없음",
        level: "ready",
      }
    : {
        label: "소리",
        value: SOURCE_LABEL_KO[source] ?? info.label,
        level: "ready",
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
          value: "브라우저 안에서 인식합니다",
          // Genuinely a limitation, and one that bites mid-service: Safari's
          // recogniser stops on a long silence and has to be restarted.
          level: "limited",
          detail:
            "크롬에서 가장 정확합니다. 사파리는 일부만 지원하고, 오래 조용하면 멈출 수 있습니다.",
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
            "성경 구절 · 용어 · 말놀이는 그대로 짚어줍니다. 다만 영어 문장은 번역이 아니라 규칙으로 만들어집니다.",
        }
      : !config.llm.sustainsLiveSermon
        ? {
            label: "AI",
            value: `${config.llm.configured} — 용량 제한`,
            level: "limited",
            detail:
              `${config.llm.capacityNote ?? ""} 그 뒤로는 기기 안의 통역기로 이어서 돌아갑니다.`.trim(),
          }
        : { label: "AI", value: config.llm.configured, level: "ready" };

  const privacy: ReadinessRow = demo
    ? { label: "개인정보", value: "이 기기 밖으로 나가지 않습니다", level: "ready" }
    : !config || input.consent === "checking"
      ? { label: "개인정보", value: "확인 중…", level: "limited" }
      : config.llm.freeTierDisclosure.length > 0 && input.consent !== "granted"
        ? {
            label: "개인정보",
            value: "시작 전에 확인이 필요합니다",
            level: "limited",
            detail: `말한 내용이 ${config.llm.freeTierDisclosure
              .map((p) => p.label)
              .join(
                ", ",
              )}(으)로 전송되고, 해당 업체가 제품 개선에 활용할 수 있습니다. 시작 전에 다시 한 번 확인을 받습니다.`,
          }
        : {
            label: "개인정보",
            value: config.llm.modelAvailable
              ? "제공자가 이 세션으로 학습하지 않습니다"
              : "이 기기 밖으로 나가지 않습니다",
            level: "ready",
          };

  return [audio, recognition, interpretation, privacy];
}
