"use client";

/**
 * The interpreter console.
 *
 * Layout is a four-row grid pinned to the viewport, with the English stream
 * taking everything left over. That ordering is the product: English dominant,
 * Korean available, context reachable, controls at the thumb.
 *
 *   ┌──────────────────────────────────────────┐  36px   status
 *   │                                          │
 *   │            ENGLISH  (1fr)                │         the thing you say
 *   │                                          │
 *   ├──────────────────────────────────────────┤  ≤22%   Korean, checkable
 *   ├──────────────────────────────────────────┤  auto   context rail
 *   └──────────────────────────────────────────┘  56px   FREEZE + toggles
 *
 * On an iPhone in landscape the whole thing is about 390px tall, which is why
 * the Korean row is capped as a percentage and the context rail scrolls
 * horizontally rather than wrapping.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionSettings, StoredSession } from "@/types";
import { activeChunk } from "@/interpreter/engine/chunks";
import { LAG_PROFILES } from "@/interpreter/engine/lag";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useWakeLock } from "@/hooks/useWakeLock";
import { STT_PROVIDER_INFO, type SttProviderId } from "@/providers/stt";
import { saveSession } from "@/lib/storage";
import { downloadSession } from "@/lib/export";
import { Button } from "@/components/ui/primitives";
import { useLiveSession } from "./useLiveSession";
import { ConsoleTopBar } from "./ConsoleTopBar";
import { ControlBar } from "./ControlBar";
import { ContextRail } from "./ContextRail";
import { EnglishStream } from "./EnglishStream";
import { KoreanStream } from "./KoreanStream";
import { SettingsSheet } from "./SettingsSheet";
import { Teleprompter } from "./Teleprompter";
import { DemoRibbon } from "./DemoRibbon";
import type { PrepSheet } from "@/types";

const FONT_SCALE_RANGE = { min: 0.7, max: 1.9 } as const;

export function LiveConsole({
  settings,
  onSettingsChange,
  prep,
  source,
  onEnd,
}: {
  settings: SessionSettings;
  onSettingsChange: (settings: SessionSettings) => void;
  prep: PrepSheet;
  source: SttProviderId;
  onEnd: (session: StoredSession | null) => void;
}) {
  const [frozen, setFrozen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedRef = useRef(false);

  const session = useLiveSession({
    mode: settings.mode,
    lag: settings.lag,
    prep,
    source,
  });

  const { snapshot, phase, error, demoBeat, startedAt, start, stop, correct } = session;

  const wakeLock = useWakeLock(phase === "running");

  // One start per mount. Getting to live in as few taps as possible is the
  // product requirement; the console starts itself.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start();
  }, [start]);

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

  const buildStoredSession = useCallback((): StoredSession => {
    return {
      id: `session-${startedAt ?? Date.now()}`,
      startedAt: startedAt ?? Date.now(),
      endedAt: Date.now(),
      mode: settings.mode,
      title: prep.title,
      speaker: prep.speaker,
      segments: snapshot.segments,
      chunks: snapshot.chunks.filter((c) => c.state !== "anticipated"),
      scripture: snapshot.scripture,
      glossary: snapshot.glossary,
      culturalNotes: snapshot.culturalNotes,
      entities: snapshot.entities,
      corrections: snapshot.corrections,
    };
  }, [snapshot, settings.mode, prep, startedAt]);

  const handleEnd = useCallback(async () => {
    await stop();
    const stored = buildStoredSession();
    // Nothing is written unless the interpreter asked for it.
    if (settings.saveHistory) saveSession(stored);
    onEnd(settings.saveHistory ? stored : null);
  }, [stop, buildStoredSession, settings.saveHistory, onEnd]);

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
        k: () => onSettingsChange({ ...settings, showKorean: !settings.showKorean }),
        g: () => onSettingsChange({ ...settings, showGlossary: !settings.showGlossary }),
        b: () => onSettingsChange({ ...settings, showScripture: !settings.showScripture }),
        "+": () => adjustFontScale(0.1),
        "=": () => adjustFontScale(0.1),
        "-": () => adjustFontScale(-0.1),
        escape: () => setSettingsOpen(false),
      }),
      [toggleFreeze, autoScroll, settings, onSettingsChange, adjustFontScale],
    ),
    !settingsOpen,
  );

  const teleprompter = settings.view === "teleprompter";
  const providerLabel = STT_PROVIDER_INFO[source]?.label ?? source;

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
        modeLabel={settings.mode === "sermon" ? "Sermon" : "General"}
        lagLabel={LAG_PROFILES[settings.lag].label}
        sourceLabel={providerLabel}
        thinking={snapshot.thinking}
        degradedReason={snapshot.degradedReason}
        onOpenSettings={() => setSettingsOpen(true)}
        onEnd={() => void handleEnd()}
      />

      {source === "demo" && demoBeat ? <DemoRibbon beat={demoBeat} /> : <div />}

      {/* --- English: the dominant region ---------------------------------- */}
      <main className="relative min-h-0">
        {teleprompter ? (
          <Teleprompter
            chunks={snapshot.chunks}
            segments={snapshot.segments}
            partial={snapshot.partial}
            showKorean={settings.showKorean}
          />
        ) : (
          <EnglishStream
            chunks={snapshot.chunks}
            activeId={active?.id}
            containerRef={autoScroll.containerRef}
            activeRef={autoScroll.activeRef}
            emptyMessage={
              phase === "starting"
                ? "Connecting…"
                : source === "demo"
                  ? "Starting the scripted session…"
                  : "English assistance will appear here as the speaker begins."
            }
          />
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
          <div className="absolute inset-x-3 bottom-3 flex items-start gap-3 rounded-md border border-[color-mix(in_srgb,var(--danger)_50%,transparent)] bg-[var(--bg-overlay)] px-3 py-2">
            <p className="flex-1 text-xs leading-relaxed text-[var(--danger)]">{error}</p>
            <Button size="sm" tone="quiet" onClick={session.dismissError}>
              Dismiss
            </Button>
          </div>
        )}
      </main>

      {/* --- Korean: secondary, capped ------------------------------------- */}
      {settings.showKorean && !teleprompter && (
        <section className="max-h-[22dvh] min-h-0 border-t border-[var(--line)] bg-[var(--bg)]">
          <KoreanStream
            segments={snapshot.segments}
            partial={snapshot.partial}
            frozen={frozen}
          />
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
        view={settings.view}
        onToggleView={() =>
          onSettingsChange({
            ...settings,
            view: teleprompter ? "console" : "teleprompter",
          })
        }
        showKorean={settings.showKorean}
        onToggleKorean={() => onSettingsChange({ ...settings, showKorean: !settings.showKorean })}
        showGlossary={settings.showGlossary}
        onToggleGlossary={() =>
          onSettingsChange({ ...settings, showGlossary: !settings.showGlossary })
        }
        onFontScale={adjustFontScale}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSettingsChange={onSettingsChange}
        corrections={snapshot.corrections}
        onCorrect={correct}
        onExport={() => downloadSession(buildStoredSession(), "markdown")}
        wakeLockHeld={wakeLock.held}
        wakeLockSupported={wakeLock.supported}
        degradedReason={snapshot.degradedReason}
      />
    </div>
  );
}
