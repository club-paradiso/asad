"use client";

/**
 * The launcher.
 *
 * Requirement: live interpretation in three interactions or fewer. This gets
 * there in two — pick a mode, press Start — with the audio source
 * pre-selected from what the deployment actually has configured.
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
import { SessionSummary } from "@/features/sessions/SessionSummary";
import { cn } from "@/lib/cn";

type Screen = "start" | "live" | "review";

export function StartScreen() {
  const [screen, setScreen] = useState<Screen>("start");
  const [settings, updateSettings] = useLocalStore(settingsStore);
  const [prep] = useLocalStore(prepStore);
  const [source, setSource] = useState<SttProviderId>("demo");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [finished, setFinished] = useState<StoredSession | null>(null);

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
    return () => {
      cancelled = true;
    };
  }, []);

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

  const llmDegraded = config ? !config.llm.modelAvailable : false;

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
                  "rounded-lg border p-4 text-left transition-colors",
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
                onClick={() => setSource(id)}
                aria-pressed={selected}
                className={cn(
                  "min-h-11 flex-1 basis-56 rounded-md border px-3.5 py-2.5 text-left transition-colors",
                  selected
                    ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                    : "border-[var(--line)] bg-[var(--bg-raised)] hover:border-[var(--line-strong)]",
                )}
              >
                <p className="text-sm font-medium">{info.label}</p>
                <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{info.detail}</p>
              </button>
            );
          })}
        </div>
        {sources.length === 1 && (
          <p className="text-xs leading-relaxed text-[var(--fg-dim)]">
            No live recogniser is available here. Demo mode runs the full pipeline on a scripted
            Korean sermon — no microphone, no key, no network. Set <code>STT_PROVIDER</code> to go
            live.
          </p>
        )}
      </section>

      {/* --- Start --------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <Button tone="primary" size="lg" onClick={() => setScreen("live")} className="w-full">
          Start interpreting
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
          translated. Set <code>LLM_PROVIDER</code> and <code>LLM_API_KEY</code> for full output.
        </p>
      )}

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
