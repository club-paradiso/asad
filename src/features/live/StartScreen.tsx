"use client";

/**
 * The launcher.
 *
 * Requirement: live interpretation in three interactions or fewer, and an
 * honest answer to four questions before any of them —
 *
 *   Am I ready?   What am I interpreting?   Which microphone?   Can I start?
 *
 * The previous version answered none of them. It opened with two paragraph-
 * sized mode cards that pushed Start below the fold on a phone, and its
 * loudest element was an amber block naming three environment variables. An
 * interpreter ninety seconds before a service cannot set an environment
 * variable; the person who can is not in the room and reads /diagnostics.
 *
 * So: readiness first, in English; controls as compact segmented rows; Start
 * above the fold on the smallest supported screen; everything optional behind
 * a disclosure.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { InterpretationMode, StoredSession } from "@/types";
import { prepStore, settingsStore } from "@/lib/storage";
import { useLocalStore } from "@/lib/local-store";
import { useCapability } from "@/hooks/useCapability";
import { STT_PROVIDER_INFO, WebSpeechProvider, type SttProviderId } from "@/providers/stt";
import { LAG_PROFILES } from "@/interpreter/engine/lag";
import { Button, Segmented } from "@/components/ui/primitives";
import { openSession, readSessionState } from "@/lib/session-client";
import type { AppConfig } from "@/app/api/config/route";
import { LiveConsole } from "./LiveConsole";
import { Readiness, type ReadinessRow } from "./Readiness";
import { SessionSummary } from "@/features/sessions/SessionSummary";

type Screen = "start" | "live" | "review";

export function StartScreen() {
  const [screen, setScreen] = useState<Screen>("start");
  const [settings, updateSettings] = useLocalStore(settingsStore);
  const [prep] = useLocalStore(prepStore);
  const [source, setSource] = useState<SttProviderId>("demo");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [finished, setFinished] = useState<StoredSession | null>(null);
  const [advanced, setAdvanced] = useState(false);

  /** Private-deployment gate, when one is configured. */
  const [gate, setGate] = useState<{ gated: boolean; authorised: boolean } | null>(null);
  const [accessKey, setAccessKey] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);

  const browserSttAvailable = useCapability(() => WebSpeechProvider.isSupported());

  // Ask the server once what it can actually do, so the launcher never offers
  // a provider that will fail the moment the interpreter presses Start.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: AppConfig | null) => {
        if (cancelled || !value) return;
        setConfig(value);
        if (value.stt.cloudAvailable) setSource(value.stt.configured as SttProviderId);
      })
      .catch(() => {});
    void readSessionState().then((state) => {
      if (!cancelled) setGate(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const sources = useMemo(() => {
    const list: SttProviderId[] = ["demo"];
    if (browserSttAvailable) list.push("webspeech");
    if (config?.stt.cloudAvailable) list.push(config.stt.configured as SttProviderId);
    return [...new Set(list)];
  }, [browserSttAvailable, config]);

  const rows = useMemo(
    () => readinessRows({ config, source, browserSttAvailable }),
    [config, source, browserSttAvailable],
  );

  if (screen === "live") {
    return (
      <LiveConsole
        settings={settings}
        onSettingsChange={updateSettings}
        prep={prep}
        source={source}
        onEnd={(session) => {
          setFinished(session);
          setScreen(session ? "review" : "start");
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
          <h1 className="text-2xl font-semibold tracking-tight">tong-yuck</h1>
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

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col gap-5 px-5 py-7 sm:py-10">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">tong-yuck</h1>
          <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
            Korean → English interpretation copilot
          </p>
        </div>
        <Link
          href="/diagnostics"
          className="shrink-0 text-xs text-[var(--fg-dim)] underline-offset-4 hover:text-[var(--fg)] hover:underline"
        >
          Diagnostics
        </Link>
      </header>

      <Readiness rows={rows} demo={source === "demo"} />

      {/* --- Session configuration ----------------------------------------
          Segmented rows rather than description cards: the descriptions were
          prep-time reading occupying launch-time space, and they were what
          pushed Start below the fold on a phone. */}
      <section className="flex flex-col gap-3">
        <ControlRow label="Mode">
          <Segmented
            label="Interpretation mode"
            value={settings.mode}
            onChange={(mode) => updateSettings({ ...settings, mode })}
            options={(["sermon", "general"] as InterpretationMode[]).map((mode) => ({
              value: mode,
              label: mode === "sermon" ? "Sermon" : "General",
              title:
                mode === "sermon"
                  ? "Scripture detection, theological terminology, church register, wordplay."
                  : "Meetings, lectures, interviews. No theological assumptions.",
            }))}
          />
        </ControlRow>

        <ControlRow label="Audio">
          <Segmented
            label="Audio source"
            value={source}
            onChange={setSource}
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
            value={settings.lag}
            onChange={(lag) => updateSettings({ ...settings, lag })}
            options={(["fast", "balanced", "safe"] as const).map((lag) => ({
              value: lag,
              label: LAG_PROFILES[lag].label,
              title: LAG_PROFILES[lag].description,
            }))}
          />
        </ControlRow>
        <p className="text-xs text-[var(--fg-muted)]">{LAG_PROFILES[settings.lag].description}</p>
      </section>

      <Button tone="primary" size="lg" onClick={() => setScreen("live")} className="w-full">
        Start interpreting
      </Button>

      {/* --- Everything optional ------------------------------------------ */}
      <details
        open={advanced}
        onToggle={(event) => setAdvanced((event.target as HTMLDetailsElement).open)}
        className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)]"
      >
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium marker:content-none">
          <span className="text-[var(--fg-muted)]">More</span>
          <span className="ml-2 text-xs text-[var(--fg-dim)]">
            prep sheet · saved sessions · counter mode
          </span>
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
          {/* A different job on the same footing, not a sub-feature: the
              console is for an interpreter working a room, the counter is for
              staff at a desk with a stranger in front of them. */}
          <Link
            href="/counter"
            className="rounded-md border border-[var(--line)] p-3 transition-colors hover:border-[var(--line-strong)]"
          >
            <p className="text-sm font-semibold">현장 응대 · Counter Mode</p>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--fg-muted)]">
              Show a QR code; the visitor joins on their own phone in their own language.
              24 languages, no install.
            </p>
          </Link>
        </div>
      </details>

      <p className="mt-auto pt-3 text-xs text-[var(--fg-dim)]">
        In session: Space freeze · T teleprompter · K Korean · G glossary · +/− text size
      </p>
    </div>
  );
}

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="w-14 shrink-0 text-xs font-medium uppercase tracking-wider text-[var(--fg-dim)]">
        {label}
      </span>
      {children}
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
  browserSttAvailable: boolean;
}): ReadinessRow[] {
  const { config, source } = input;
  const demo = source === "demo";
  const info = STT_PROVIDER_INFO[source];

  const audio: ReadinessRow = demo
    ? {
        label: "Audio",
        value: "Recorded Korean sermon — no microphone",
        level: "ready",
      }
    : {
        label: "Audio",
        value: info.label,
        level: "ready",
      };

  const recognition: ReadinessRow = demo
    ? { label: "Recognition", value: "Built into the recording", level: "ready" }
    : source === "webspeech"
      ? {
          label: "Recognition",
          value: "On-device, in your browser",
          // Genuinely a limitation, and one that bites mid-service: Safari's
          // recogniser stops on a long silence and has to be restarted.
          level: "limited",
          detail: "Best in Chrome. Safari support is partial and can stop on long silences.",
        }
      : { label: "Recognition", value: `${info.label} streaming`, level: "ready" };

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
            detail: `${config.llm.capacityNote ?? ""} After that the console keeps running on the local interpreter.`.trim(),
          }
        : { label: "AI", value: config.llm.configured, level: "ready" };

  const privacy: ReadinessRow = demo
    ? { label: "Privacy", value: "Nothing leaves this device", level: "ready" }
    : !config
      ? { label: "Privacy", value: "Checking…", level: "limited" }
      : config.llm.freeTierDisclosure.length > 0
        ? {
            label: "Privacy",
            value: "Confirmation needed before starting",
            level: "limited",
            detail: `What is said will be sent to ${config.llm.freeTierDisclosure
              .map((p) => p.label)
              .join(", ")}, which may use it to improve their products. You will be asked to confirm.`,
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
