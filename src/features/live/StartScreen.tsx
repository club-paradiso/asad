"use client";

/**
 * The launcher.
 *
 * Requirement: live interpretation in three interactions or fewer, and an
 * honest answer to four questions before any of them —
 *
 *   Am I ready?   What am I interpreting?   Which input?   Can I start?
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
import type { InterpretationMode, StoredSession } from "@/types";
import { prepStore, settingsStore } from "@/lib/storage";
import { useLocalStore } from "@/lib/local-store";
import { useCapability } from "@/hooks/useCapability";
import {
  STT_PROVIDER_INFO,
  WebSpeechProvider,
  type SttProviderId,
} from "@/providers/stt";
import { LAG_PROFILES } from "@/interpreter/engine/lag";
import { Button, Segmented } from "@/components/ui/primitives";
import { openSession, readSessionState } from "@/lib/session-client";
import type { AppConfig } from "@/app/api/config/route";
import { BRAND } from "@/lib/brand";
import { LiveConsole } from "./LiveConsole";
import { useLiveSession } from "./useLiveSession";
import { useAudioInputs } from "./useAudioInputs";
import { preferredSttSource } from "./sourcePreference";
import { useCloudConsent } from "./useCloudConsent";
import { PrivacyDisclosure } from "./PrivacyDisclosure";
import { Readiness, type ReadinessRow } from "./Readiness";
import { SessionSummary } from "@/features/sessions/SessionSummary";

type Screen = "start" | "live" | "review";

export function StartScreen() {
  const [screen, setScreen] = useState<Screen>("start");
  const [settings, updateSettings] = useLocalStore(settingsStore);
  const [prep] = useLocalStore(prepStore);
  const [sourceOverride, setSourceOverride] = useState<SttProviderId | null>(
    null,
  );
  const [audioDeviceId, setAudioDeviceId] = useState("");
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
  const canChooseAudioInput = source !== "demo" && source !== "webspeech";
  const audioInputs = useAudioInputs(canChooseAudioInput);
  const selectedAudioLabel =
    audioInputs.devices.find((device) => device.deviceId === audioDeviceId)?.label ??
    "System default";

  const session = useLiveSession({
    mode: settings.mode,
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
    if (config?.stt.cloudAvailable)
      list.push(config.stt.configured as SttProviderId);
    return [...new Set(list)];
  }, [browserSttAvailable, config]);

  const rows = useMemo(
    () =>
      readinessRows({
        config,
        source,
        consent: consent.phase,
        audioInputLabel: selectedAudioLabel,
        audioInputSupported: audioInputs.supported,
      }),
    [
      config,
      source,
      consent.phase,
      selectedAudioLabel,
      audioInputs.supported,
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
            <h1 className="max-w-3xl break-all text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              {BRAND.name}
            </h1>
            <p className="mt-1 text-sm text-[var(--fg-muted)] sm:text-base">
              {BRAND.shortName} · {BRAND.liveTagline}
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
            Diagnostics
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
              <ControlRow label="Mode">
                <Segmented
                  label="Interpretation mode"
                  indicator
                  value={settings.mode}
                  onChange={(mode) => updateSettings({ ...settings, mode })}
                  options={(["sermon", "general"] as InterpretationMode[]).map(
                    (mode) => ({
                      value: mode,
                      label: mode === "sermon" ? "Sermon" : "General",
                      title:
                        mode === "sermon"
                          ? "For a human interpreter working in an existing church interpretation booth."
                          : "Meetings, lectures, interviews. No theological assumptions.",
                    }),
                  )}
                />
              </ControlRow>

              <ControlRow label="Input">
                {source === "demo" ? (
                  <p className="min-h-11 py-2.5 text-sm text-[var(--fg-muted)]">
                    Recorded Korean sermon
                  </p>
                ) : source === "webspeech" ? (
                  <p className="min-h-11 py-2.5 text-sm text-[var(--fg-muted)]">
                    System default · Browser recognition controls the microphone
                  </p>
                ) : (
                  <select
                    aria-label="Audio input device"
                    value={audioDeviceId}
                    onChange={(event) => setAudioDeviceId(event.target.value)}
                    className="min-h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--bg-overlay)] px-3 text-sm text-[var(--fg)] outline-none focus-visible:border-[var(--accent)]"
                  >
                    <option value="">System default</option>
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

              <ControlRow label="Recognition">
                <Segmented
                  label="Speech recognition"
                  indicator
                  value={source}
                  onChange={setSourceOverride}
                  options={sources.map((id) => ({
                    value: id,
                    label: STT_PROVIDER_INFO[id].label,
                    title: STT_PROVIDER_INFO[id].detail,
                  }))}
                />
              </ControlRow>

              <ControlRow label="Lag">
                <Segmented
                  label="Interpreter lag"
                  indicator
                  value={settings.lag}
                  onChange={(lag) => updateSettings({ ...settings, lag })}
                  options={(["fast", "balanced", "safe"] as const).map(
                    (lag) => ({
                      value: lag,
                      label: LAG_PROFILES[lag].label,
                      title: LAG_PROFILES[lag].description,
                    }),
                  )}
                />
              </ControlRow>
              <p className="text-sm text-[var(--fg-muted)] sm:pl-28">
                {LAG_PROFILES[settings.lag].description}
              </p>
            </section>

            {settings.mode === "sermon" && (
              <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-3 text-sm leading-relaxed text-[var(--fg-muted)]">
                <strong className="font-semibold text-[var(--fg)]">
                  Booth mode.
                </strong>{" "}
                ASAD assumes an existing human interpreter and church simultaneous-interpretation audio system. It supports the interpreter; it does not transmit translation directly to the congregation.
              </div>
            )}

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
                ? "Checking privacy settings…"
                : consent.phase === "needed"
                  ? "Confirm privacy to continue"
                  : source === "demo"
                    ? "Run demo"
                    : "Start live interpreting"}
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
                  <span className="font-semibold text-[var(--accent)]">
                    More
                  </span>
                  <span className="ml-2 text-sm text-[var(--fg-muted)]">
                    prep sheet · saved sessions · counter mode
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
                  Prepare a session
                  {prep.speaker || prep.title ? (
                    <span className="ml-1.5 text-[var(--accent)]">· ready</span>
                  ) : null}
                </Link>
                <Link
                  href="/sessions"
                  className="text-sm text-[var(--fg-muted)] underline-offset-4 hover:text-[var(--fg)] hover:underline"
                >
                  Saved sessions
                </Link>
                {/* Counter Mode is no longer buried here. It is a different job
                  on the same footing, and it now has its own entry alongside
                  this one on the home screen — which is what the comment that
                  used to sit above this link already claimed. */}
              </div>
            </details>

            <p className="mt-auto border-t border-[var(--line)] pt-5 text-xs leading-relaxed text-[var(--fg-dim)] sm:text-sm">
              In session:{" "}
              <strong className="font-semibold text-[var(--fg)]">Space</strong>{" "}
              freeze ·{" "}
              <strong className="font-semibold text-[var(--fg)]">T</strong>{" "}
              teleprompter ·{" "}
              <strong className="font-semibold text-[var(--fg)]">K</strong>{" "}
              Korean ·{" "}
              <strong className="font-semibold text-[var(--fg)]">G</strong>{" "}
              glossary ·{" "}
              <strong className="font-semibold text-[var(--fg)]">+/−</strong>{" "}
              text size
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
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fg-dim)]">
        {label}
      </span>
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
  audioInputLabel?: string;
  audioInputSupported?: boolean;
}): ReadinessRow[] {
  const { config, source } = input;
  const demo = source === "demo";
  const info = STT_PROVIDER_INFO[source];

  const audio: ReadinessRow = demo
    ? {
        label: "Input",
        value: "Recorded Korean sermon",
        level: "ready",
      }
    : source === "webspeech"
      ? {
          label: "Input",
          value: "System default microphone",
          level: "limited",
          detail: "Browser speech recognition chooses the input device. Select the system input before the service if you need the church mixer.",
        }
      : input.audioInputSupported === false
        ? {
            label: "Input",
            value: "Browser cannot enumerate audio inputs",
            level: "limited",
          }
        : {
            label: "Input",
            value: input.audioInputLabel ?? "System default",
            level: "ready",
            detail: "For a booth, prefer the church mixer or USB audio interface feed over room audio.",
          };

  const recognition: ReadinessRow = demo
    ? {
        label: "Recognition",
        value: "Built into the recording",
        level: "ready",
      }
    : source === "webspeech"
      ? {
          label: "Recognition",
          value: "On-device, in your browser",
          // Genuinely a limitation, and one that bites mid-service: Safari's
          // recogniser stops on a long silence and has to be restarted.
          level: "limited",
          detail:
            "Best in Chrome. Safari support is partial and can stop on long silences.",
        }
      : {
          label: "Recognition",
          value: `${info.label} streaming`,
          level: "ready",
        };

  // The line that used to name environment variables. It now describes what
  // the interpreter will see on screen.
  const interpretation: ReadinessRow = !config
    ? { label: "AI", value: "Checking…", level: "limited" }
    : !config.llm.modelAvailable
      ? {
          label: "AI",
          value: "Rule-based only",
          level: "limited",
          detail:
            "Scripture, terminology and wordplay are still detected; the English is built from rules rather than translated.",
        }
      : !config.llm.sustainsLiveSermon
        ? {
            label: "AI",
            value: `${config.llm.configured} — limited capacity`,
            level: "limited",
            detail:
              `${config.llm.capacityNote ?? ""} After that the console keeps running on the local interpreter.`.trim(),
          }
        : { label: "AI", value: config.llm.configured, level: "ready" };

  const privacy: ReadinessRow = demo
    ? { label: "Privacy", value: "Nothing leaves this device", level: "ready" }
    : !config || input.consent === "checking"
      ? { label: "Privacy", value: "Checking…", level: "limited" }
      : config.llm.freeTierDisclosure.length > 0 && input.consent !== "granted"
        ? {
            label: "Privacy",
            value: "Confirmation needed before starting",
            level: "limited",
            detail: `What is said will be sent to ${config.llm.freeTierDisclosure
              .map((p) => p.label)
              .join(
                ", ",
              )}, which may use it to improve their products. You will be asked to confirm.`,
          }
        : {
            label: "Privacy",
            value: config.llm.modelAvailable
              ? "Provider does not train on this session"
              : "Nothing leaves this device",
            level: "ready",
          };

  return [audio, recognition, interpretation, privacy];
}