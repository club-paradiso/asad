"use client";

/**
 * The launcher.
 *
 * Requirement: live interpretation in three interactions or fewer. This gets
 * there in two — pick a mode, press Start — with the best available audio
 * source selected automatically.
 *
 * Everything optional (prep, saved sessions, lag, view) is reachable but never
 * in the way. An interpreter opening this ninety seconds before a service
 * should not have to decide anything.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { InterpretationMode, StoredSession } from "@/types";
import { prepStore, settingsStore } from "@/lib/storage";
import { useLocalStore } from "@/lib/local-store";
import { useCapability } from "@/hooks/useCapability";
import { STT_PROVIDER_INFO, WebSpeechProvider, type SttProviderId } from "@/providers/stt";
import { LAG_PROFILES } from "@/interpreter/engine/lag";
import { Button, Label, Segmented } from "@/components/ui/primitives";
import type { AppConfig } from "@/app/api/config/route";
import { LiveConsole } from "./LiveConsole";
import { useLiveSession } from "./useLiveSession";
import { SessionSummary } from "@/features/sessions/SessionSummary";
import { cn } from "@/lib/cn";

type Screen = "start" | "live" | "review";

export function StartScreen() {
  const [screen, setScreen] = useState<Screen>("start");
  const [settings, updateSettings] = useLocalStore(settingsStore);
  const [prep] = useLocalStore(prepStore);
  const [sourceOverride, setSourceOverride] = useState<SttProviderId | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [finished, setFinished] = useState<StoredSession | null>(null);

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
    return () => {
      cancelled = true;
    };
  }, []);

  // Browser Speech is the zero-configuration live path. Prefer an explicitly
  // configured cloud provider when it is genuinely available; otherwise use
  // browser speech whenever the current browser supports it. This means a
  // deployment accidentally left on STT_PROVIDER=demo still opens ready for
  // live interpretation instead of forcing the operator into a fake session.
  // A manual choice always wins.
  const configuredSource = useMemo<SttProviderId>(() => {
    if (config?.stt.cloudAvailable) return config.stt.configured as SttProviderId;
    if (browserSttAvailable) return "webspeech";
    return "demo";
  }, [browserSttAvailable, config]);

  const source = sourceOverride ?? configuredSource;

  const session = useLiveSession({
    mode: settings.mode,
    lag: settings.lag,
    prep,
    source,
  });

  const sources = useMemo(() => {
    const list: SttProviderId[] = ["demo"];
    if (browserSttAvailable) list.push("webspeech");
    if (config?.stt.cloudAvailable) {
      list.push(config.stt.configured as SttProviderId);
    }
    return [...new Set(list)];
  }, [browserSttAvailable, config]);

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
    return <SessionSummary session={finished} onClose={() => setScreen("start")} />;
  }

  const llmDegraded = config ? !config.llm.modelAvailable : false;
  const llmCapacityNote = config && !config.llm.sustainsLiveSermon ? config.llm.capacityNote : null;

  const beginSession = () => {
    // start() is deliberately invoked inside the button's click handler. The
    // Web Speech API is permission-sensitive on Safari/iOS and other browsers;
    // deferring SpeechRecognition.start() to a mounted component effect loses
    // the transient user activation that came from this tap.
    setScreen("live");
    void session.start();
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col gap-8 px-5 py-8 sm:py-14">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">tong-yuck</h1>
        <p className="mt-1.5 text-sm text-[var(--fg-muted)]">
          A real-time copilot for human interpreters. Korean → English.
        </p>
      </header>

      {/* --- 1. Mode ------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <Label>1 · Mode</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["sermon", "general"] as InterpretationMode[]).map((mode) => {
            const selected = settings.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => updateSettings({ ...settings, mode })}
                aria-pressed={selected}
                className={cn(
                  "touch-manipulation rounded-lg border p-4 text-left transition-[color,background-color,border-color,transform] active:scale-[0.99]",
                  selected
                    ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                    : "border-[var(--line)] bg-[var(--bg-raised)] hover:border-[var(--line-strong)]",
                )}
              >
                <p className="text-base font-semibold">
                  {mode === "sermon" ? "Sermon" : "General"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--fg-muted)]">
                  {mode === "sermon"
                    ? "Scripture detection, theological terminology, church register, wordplay and cultural adaptation."
                    : "Meetings, lectures, interviews, public service. No theological assumptions applied."}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* --- 2. Audio source ---------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <Label>2 · Audio</Label>
        <div className="flex flex-wrap gap-2">
          {sources.map((id) => {
            const info = STT_PROVIDER_INFO[id];
            const selected = source === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSourceOverride(id)}
                aria-pressed={selected}
                className={cn(
                  "touch-manipulation min-h-12 flex-1 basis-56 rounded-md border px-3.5 py-2.5 text-left transition-[color,background-color,border-color,transform] active:scale-[0.99]",
                  selected
                    ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                    : "border-[var(--line)] bg-[var(--bg-raised)] hover:border-[var(--line-strong)]",
                )}
              >
                <p className="flex items-center gap-2 text-sm font-medium">
                  {info.label}
                  {id !== "demo" && <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--ok)]">Live</span>}
                </p>
                <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{info.detail}</p>
              </button>
            );
          })}
        </div>
        {sources.length === 1 && (
          <p className="text-xs leading-relaxed text-[var(--fg-dim)]">
            No live recogniser is available in this browser. Demo mode runs the full pipeline on a
            scripted Korean sermon — no microphone, no key, no network.
          </p>
        )}
      </section>

      {/* --- Start --------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <Button tone="primary" size="lg" onClick={beginSession} className="w-full">
          {source === "demo" ? "Run demo" : "Start live interpreting"}
        </Button>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--fg-dim)]">
          <span className="flex items-center gap-2">
            Lag
            <Segmented
              size="sm"
              label="Interpreter lag"
              value={settings.lag}
              onChange={(lag) => updateSettings({ ...settings, lag })}
              options={(["fast", "balanced", "safe"] as const).map((lag) => ({
                value: lag,
                label: LAG_PROFILES[lag].label,
                title: LAG_PROFILES[lag].description,
              }))}
            />
          </span>
          <span>{LAG_PROFILES[settings.lag].description}</span>
        </div>
      </section>

      {llmDegraded && (
        <p className="rounded-md border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-3.5 py-2.5 text-xs leading-relaxed text-[var(--warn)]">
          No interpretation model is configured. Scripture normalisation, terminology and wordplay
          detection still run locally, but English assistance will be rule-based rather than
          translated. Set a provider key — <code>GEMINI_API_KEY</code>, <code>GROQ_API_KEY</code> or{" "}
          <code>OPENROUTER_API_KEY</code> — for full output.
        </p>
      )}

      {/* Connected but not sufficient. Its own warning, because it is a
          different problem with a different fix, and because a free tier that
          runs out eight minutes into a service looks exactly like a broken
          deployment from the booth. */}
      {llmCapacityNote && (
        <p className="rounded-md border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-3.5 py-2.5 text-xs leading-relaxed text-[var(--warn)]">
          <span className="font-semibold">{config?.llm.configured}</span> is connected, but its free
          tier will not carry a whole service: {llmCapacityNote} The console keeps running on the
          local interpreter after that, showing <code>AI LOCAL</code>. Add a provider with more
          headroom, or use this for Counter Mode, which fits comfortably.
        </p>
      )}

      {/* A different job on the same footing, not a sub-feature: the console is
          for an interpreter working a room, the counter is for staff at a desk
          with a stranger in front of them. */}
      <Link
        href="/counter"
        className="touch-manipulation rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] p-4 transition-[color,background-color,border-color,transform] hover:border-[var(--line-strong)] active:scale-[0.99]"
      >
        <p className="text-base font-semibold">현장 응대 · Counter Mode</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--fg-muted)]">
          Show a QR code; the visitor joins on their own phone in their own
          language. Chat and voice, both languages visible to both sides, 24
          languages. No install.
        </p>
      </Link>

      <nav className="mt-auto flex flex-wrap gap-3 border-t border-[var(--line)] pt-5 text-sm">
        <Link
          href="/prep"
          className="text-[var(--fg-muted)] underline-offset-4 hover:text-[var(--fg)] hover:underline"
        >
          Prepare a session
          {prep.speaker || prep.title ? (
            <span className="ml-1.5 text-[var(--accent)]">· ready</span>
          ) : null}
        </Link>
        <Link
          href="/sessions"
          className="text-[var(--fg-muted)] underline-offset-4 hover:text-[var(--fg)] hover:underline"
        >
          Saved sessions
        </Link>
        <span className="ml-auto text-xs text-[var(--fg-dim)]">
          Space freeze · T teleprompter · K Korean · G glossary
        </span>
      </nav>
    </div>
  );
}
