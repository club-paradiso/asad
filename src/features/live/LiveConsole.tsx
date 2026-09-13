"use client";

/**
 * The interpreter console.
 *
 * Layout is a grid pinned to the viewport, with the translation stream taking
 * everything left over. That ordering is the product: translation dominant,
 * source available, context reachable, one control at the thumb.
 *
 *   ┌──────────────────────────────────────────┐  44px   status · pair · mic
 *   │                                          │
 *   │           TRANSLATION  (1fr)             │         the thing you say
 *   │                                          │
 *   ├──────────────────────────────────────────┤  ≤22%   source, checkable
 *   ├──────────────────────────────────────────┤  auto   context rail, when
 *   │                                          │         it has a cue
 *   └──────────────────────────────────────────┘  auto   FREEZE
 *
 * Every row except the translation earns its height or is not rendered: the
 * context rail is absent until there is something to put in it, and the
 * notice row above the translation exists only during a demo or while the
 * on-device backup is still coming up.
 *
 * On an iPhone in landscape the whole thing is about 390px tall, which is why
 * the source row is capped as a percentage, the context rail scrolls
 * horizontally rather than wrapping, and the chrome sheds padding below 480px.
 *
 * There is no mode. The pair label in the strip says what is being
 * interpreted into what; the context chip, when the Context Engine has an
 * answer worth showing, says what kind of room it thinks this is.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContextDomain, PrepSheet, SessionSettings, StoredSession } from "@/types";
import { layerForDomain } from "@/types";
import { activeChunk } from "@/interpreter/engine/chunks";
import type { EngineSnapshot } from "@/interpreter/engine/session";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useWakeLock } from "@/hooks/useWakeLock";
import type { SttProviderId } from "@/providers/stt";
import { languageBase, pairLabel } from "@/languages/registry";
import { saveSession } from "@/lib/storage";
import { downloadSession } from "@/lib/export";
import { Button } from "@/components/ui/primitives";
import type { LiveSession } from "./useLiveSession";
import { ConsoleTopBar } from "./ConsoleTopBar";
import { ControlBar } from "./ControlBar";
import { ContextRail } from "./ContextRail";
import { TargetStream } from "./TargetStream";
import { SourceStream } from "./SourceStream";
import { SettingsSheet } from "./SettingsSheet";
import { Teleprompter } from "./Teleprompter";
import { DemoRibbon } from "./DemoRibbon";
import { LiveRescueOverlay } from "./LiveRescueOverlay";
import { CorrectionPopover } from "./CorrectionPopover";
import { aiStateFrom } from "./AiStatus";
import { contextLabel } from "./live-strings";

const FONT_SCALE_RANGE = { min: 0.7, max: 1.9 } as const;

export function LiveConsole({
  settings,
  onSettingsChange,
  prep,
  source,
  session,
  onEnd,
}: {
  settings: SessionSettings;
  onSettingsChange: (settings: SessionSettings) => void;
  prep: PrepSheet;
  source: SttProviderId;
  session: LiveSession;
  onEnd: (session: StoredSession | null) => void;
}) {
  const [frozen, setFrozen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocusContext, setSettingsFocusContext] = useState(false);
  /** The source text the interpreter long-pressed; null while the box is closed. */
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const {
    snapshot,
    phase,
    error,
    demoBeat,
    startedAt,
    lastProvider,
    browserTranslatorStatus,
    audio,
    start,
    stop,
    correct,
    setContext,
  } = session;

  // NO DISCLOSURE FETCH HERE, deliberately.
  //
  // It used to live in this component, and by the time it resolved the session
  // had already started — the microphone was open and the first sentence had
  // reached a cloud provider before the interpreter was told it would. A
  // dialog that appears after the data has left is not consent.
  //
  // The gate is on the start screen now, where it runs BEFORE the tap that
  // opens anything, and where the interpreter's acknowledgement is itself the
  // user gesture that starts the session. See `useCloudConsent`.

  const wakeLock = useWakeLock(phase === "running");

  useEffect(() => {
    if (phase !== "running" || !startedAt) return;
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, [phase, startedAt]);

  const active = useMemo(() => activeChunk(snapshot.chunks), [snapshot.chunks]);

  const autoScroll = useAutoScroll<HTMLDivElement>({
    // Scrolling is keyed to the active chunk, so it moves once per stabilised
    // thought unit rather than once per token.
    activeKey: active?.id ?? "none",
    follow: !frozen,
  });

  const toggleFreeze = useCallback(() => {
    setFrozen((value) => {
      const next = !value;
      // Releasing the freeze returns to the live position smoothly rather than
      // snapping — a jump costs the interpreter their place.
      if (!next) window.setTimeout(() => autoScroll.returnToLive(), 20);
      return next;
    });
  }, [autoScroll]);

  const adjustFontScale = useCallback(
    (delta: number) => {
      const next = Math.min(
        FONT_SCALE_RANGE.max,
        Math.max(FONT_SCALE_RANGE.min, Number((settings.fontScale + delta).toFixed(2))),
      );
      onSettingsChange({ ...settings, fontScale: next });
    },
    [settings, onSettingsChange],
  );

  const { languagePair, domain } = snapshot;
  const sourceIsKorean = languageBase(languagePair.source) === "ko";

  const buildStoredSession = useCallback(
    (sourceSnapshot: EngineSnapshot = snapshot): StoredSession => ({
      id: `session-${startedAt ?? Date.now()}`,
      startedAt: startedAt ?? Date.now(),
      endedAt: Date.now(),
      sourceLanguage: languagePair.source,
      targetLanguage: languagePair.target,
      domain: domain.domain,
      title: prep.title,
      speaker: prep.speaker,
      segments: sourceSnapshot.segments,
      chunks: sourceSnapshot.chunks.filter((c) => c.state !== "anticipated"),
      scripture: sourceSnapshot.scripture,
      glossary: sourceSnapshot.glossary,
      culturalNotes: sourceSnapshot.culturalNotes,
      entities: sourceSnapshot.entities,
      corrections: sourceSnapshot.corrections,
    }),
    [snapshot, languagePair, domain.domain, prep, startedAt],
  );

  const handleEnd = useCallback(async () => {
    const finalSnapshot = await stop();
    const stored = buildStoredSession(finalSnapshot);
    // Nothing is written unless the interpreter asked for it.
    if (settings.saveHistory) saveSession(stored);
    onEnd(settings.saveHistory ? stored : null);
  }, [stop, buildStoredSession, settings.saveHistory, onEnd]);

  /** Manual override: the engine hears it now, settings remember it. */
  const changeContext = useCallback(
    (context: ContextDomain) => {
      setContext(context);
      onSettingsChange({ ...settings, context });
    },
    [setContext, settings, onSettingsChange],
  );

  const openContextOverride = useCallback(() => {
    setSettingsFocusContext(true);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsFocusContext(false);
  }, []);

  const closeCorrection = useCallback(() => setCorrecting(null), []);

  useHotkeys(
    useMemo(
      () => ({
        space: toggleFreeze,
        f: () => {
          setFrozen(false);
          autoScroll.returnToLive();
        },
        t: () =>
          onSettingsChange({
            ...settings,
            view: settings.view === "teleprompter" ? "console" : "teleprompter",
          }),
        k: () => onSettingsChange({ ...settings, showSource: !settings.showSource }),
        g: () => onSettingsChange({ ...settings, showGlossary: !settings.showGlossary }),
        b: () => onSettingsChange({ ...settings, showScripture: !settings.showScripture }),
        "+": () => adjustFontScale(0.1),
        "=": () => adjustFontScale(0.1),
        "-": () => adjustFontScale(-0.1),
        escape: closeSettings,
      }),
      [toggleFreeze, autoScroll, settings, onSettingsChange, adjustFontScale, closeSettings],
    ),
    // Off while any text box is open: a half-typed correction that the T key
    // turns into a teleprompter is worse than no shortcut at all.
    !settingsOpen && correcting === null,
  );

  const teleprompter = settings.view === "teleprompter";
  // Rescue is sermon intelligence. It follows the Context Engine's LAYER, not
  // a mode the interpreter chose — there is none.
  const rescueAvailable =
    layerForDomain(domain.domain) === "sermon" && source !== "demo" && phase === "running";

  // The chip is only worth a glance when the engine has actually decided
  // something: the default and "generic" are the absence of a decision.
  const contextChip =
    domain.source !== "default" && domain.domain !== "generic"
      ? contextLabel(domain.domain)
      : undefined;

  return (
    <div
      data-surface="live"
      className="relative grid h-[100dvh] w-full grid-rows-[auto_auto_1fr_auto_auto_auto] overflow-hidden bg-[var(--bg)]"
      style={
        {
          "--font-scale": settings.fontScale,
          paddingLeft: "var(--safe-left)",
          paddingRight: "var(--safe-right)",
          paddingTop: "var(--safe-top)",
        } as React.CSSProperties
      }
    >
      <ConsoleTopBar
        connection={snapshot.connection}
        health={snapshot.health}
        elapsedMs={elapsed}
        aiState={aiStateFrom({
          llmHealth: snapshot.health.llm,
          lastProvider,
          started: phase === "running",
        })}
        scripted={source === "demo"}
        pairLabel={pairLabel(languagePair)}
        audio={audio}
        context={contextChip}
        onOpenContext={openContextOverride}
        onOpenSettings={() => setSettingsOpen(true)}
        onEnd={() => void handleEnd()}
      />

      {source === "demo" && demoBeat ? (
        <DemoRibbon beat={demoBeat} />
      ) : browserTranslatorStatus === "preparing" ? (
        // The download percentage is gone. The session has already started by
        // the time this row can appear, interpretation never waits on the
        // pack, and there is nothing the interpreter can do with a number —
        // what they can use is knowing the offline backup is not ready yet.
        <div
          role="status"
          className="border-b border-[var(--line)] bg-[var(--bg-raised)] px-3 py-1.5 text-center text-[0.7rem] text-[var(--fg-muted)]"
        >
          Offline backup is still starting up
        </div>
      ) : (
        <div />
      )}

      {/* --- Translation: the dominant region ------------------------------ */}
      {/* `min-w-0` on every row: a grid item defaults to `min-width: auto`,
          which lets a long source segment push the row wider than the column
          instead of wrapping — the text then runs off the right edge. */}
      <main className="relative min-h-0 min-w-0">
        {teleprompter ? (
          <Teleprompter
            chunks={snapshot.chunks}
            segments={snapshot.segments}
            partial={snapshot.partial}
            showSource={settings.showSource}
            sourceLanguage={languagePair.source}
            targetLanguage={languagePair.target}
          />
        ) : (
          <TargetStream
            chunks={snapshot.chunks}
            activeId={active?.id}
            containerRef={autoScroll.containerRef}
            activeRef={autoScroll.activeRef}
            language={languagePair.target}
            // Short enough to take in without reading. The interpreter is
            // waiting for the speaker, not for an explanation of the product.
            emptyMessage={
              phase === "starting"
                ? "Connecting…"
                : phase === "idle" && source !== "demo"
                  ? "Not listening."
                  : "Waiting for the speaker."
            }
          />
        )}

        {rescueAvailable && !settingsOpen && correcting === null && (
          <LiveRescueOverlay snapshot={snapshot} prep={prep} startedAt={startedAt} />
        )}

        {frozen && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 flex justify-center pt-2"
          >
            <span className="rounded-full border border-[var(--accent)] bg-[var(--bg)] px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-widest text-[var(--accent)]">
              Frozen
            </span>
          </div>
        )}

        {error && (
          <div className="absolute inset-x-3 bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--danger)_50%,transparent)] bg-[var(--bg-overlay)] px-3 py-2 shadow-lg">
            <p className="min-w-48 flex-1 text-xs leading-relaxed text-[var(--danger)]">{error}</p>
            {phase === "idle" && (
              <Button
                size="md"
                tone="primary"
                onClick={() => {
                  session.dismissError();
                  void start();
                }}
              >
                Try again
              </Button>
            )}
            {phase !== "idle" && (
              <Button size="md" tone="quiet" onClick={session.dismissError}>
                Dismiss
              </Button>
            )}
          </div>
        )}
      </main>

      {/* --- Source: secondary, capped ------------------------------------- */}
      {settings.showSource && !teleprompter && (
        // Capped as a fraction of the viewport, and capped harder on a short
        // one: on an iPhone in landscape the source must not eat the
        // translation. `relative` so the correction box can anchor to its
        // bottom edge and grow upward over the translation — never the other
        // way round.
        <section className="relative max-h-[17dvh] min-h-0 min-w-0 border-t border-[var(--line)] bg-[var(--bg)] tall:max-h-[22dvh]">
          <SourceStream
            segments={snapshot.segments}
            partial={snapshot.partial}
            frozen={frozen}
            language={languagePair.source}
            onSelectText={(text) => setCorrecting(text)}
          />
          <div className="absolute inset-x-0 bottom-0 z-20 px-1 sm:px-4">
            <CorrectionPopover
              open={correcting !== null}
              heard={correcting ?? ""}
              defaultRemember={settings.rememberCorrections}
              sourceIsKorean={sourceIsKorean}
              onCancel={closeCorrection}
              onApply={({ from, to, english, remember }) => {
                correct(from, to, { english, remember });
                closeCorrection();
              }}
            />
          </div>
        </section>
      )}

      {/* --- Context rail --------------------------------------------------- */}
      {!teleprompter && (
        <ContextRail
          scripture={snapshot.scripture}
          glossary={snapshot.glossary}
          culturalNotes={snapshot.culturalNotes}
          showScripture={settings.showScripture}
          showGlossary={settings.showGlossary}
        />
      )}

      <ControlBar
        frozen={frozen}
        onToggleFreeze={toggleFreeze}
        atLive={autoScroll.atLive}
        onReturnToLive={() => {
          setFrozen(false);
          autoScroll.returnToLive();
        }}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={closeSettings}
        settings={settings}
        onSettingsChange={onSettingsChange}
        domain={domain}
        onContextChange={changeContext}
        focusContext={settingsFocusContext}
        sourceIsKorean={sourceIsKorean}
        corrections={snapshot.corrections}
        onCorrect={correct}
        onExport={() => downloadSession(buildStoredSession(), "markdown")}
        onFontScale={adjustFontScale}
        wakeLockHeld={wakeLock.held}
        wakeLockSupported={wakeLock.supported}
        degradedReason={snapshot.degradedReason}
      />
    </div>
  );
}
