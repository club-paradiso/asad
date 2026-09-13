"use client";

/**
 * Settings, correction and session control — everything that must exist but
 * must not be on screen during interpretation.
 *
 * Opening this covers the console, which is intentional: if the interpreter is
 * in here they are not reading the translation, and pretending otherwise would
 * just make both surfaces worse.
 *
 * There is no Mode here. "맥락" (context) is the Context Engine's answer with
 * a manual override behind it; `자동` is the default and the normal case.
 */
import { useEffect, useRef, useState } from "react";
import type {
  ConsoleView,
  ContextDomain,
  CorrectionRecord,
  DomainInference,
  LagProfile,
  SessionSettings,
} from "@/types";
import { CONTEXT_DOMAINS } from "@/types";
import { LAG_PROFILES } from "@/interpreter/engine/lag";
import { romaniseName } from "@/lib/romanise";
import { cn } from "@/lib/cn";
import {
  Button,
  Field,
  Label,
  Segmented,
  TextInput,
  Toggle,
} from "@/components/ui/primitives";
import {
  CONTEXT_LABEL_KO,
  DOMAIN_SOURCE_KO,
  REMEMBER_CORRECTIONS_HINT,
  inferredContextLine,
} from "./live-strings";

export function SettingsSheet({
  open,
  onClose,
  settings,
  onSettingsChange,
  domain,
  onContextChange,
  focusContext = false,
  sourceIsKorean = true,
  corrections,
  onCorrect,
  onExport,
  onFontScale,
  wakeLockHeld,
  wakeLockSupported,
  degradedReason,
}: {
  open: boolean;
  onClose: () => void;
  settings: SessionSettings;
  onSettingsChange: (settings: SessionSettings) => void;
  /** The Context Engine's current answer. */
  domain: DomainInference;
  /** Manual override — the console pushes it to the session AND to settings. */
  onContextChange: (context: ContextDomain) => void;
  /** Scroll the context control into view on open (the status-strip chip). */
  focusContext?: boolean;
  sourceIsKorean?: boolean;
  corrections: CorrectionRecord[];
  onCorrect: (from: string, to: string, options?: { english?: string; remember?: boolean }) => void;
  onExport: () => void;
  onFontScale: (delta: number) => void;
  wakeLockHeld: boolean;
  wakeLockSupported: boolean;
  degradedReason?: string;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const contextRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !focusContext) return;
    const node = contextRef.current;
    node?.scrollIntoView({ block: "start" });
    node?.querySelector<HTMLElement>("[role=radio][aria-checked=true]")?.focus();
  }, [open, focusContext]);

  if (!open) return null;

  const patch = (next: Partial<SessionSettings>) => onSettingsChange({ ...settings, ...next });

  const submitCorrection = () => {
    if (!from.trim() || !to.trim()) return;
    onCorrect(from.trim(), to.trim(), {
      english: sourceIsKorean ? romaniseName(to.trim()) : undefined,
      remember: settings.rememberCorrections,
    });
    setFrom("");
    setTo("");
  };

  return (
    <div
      className="absolute inset-0 z-30 flex justify-end bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label="Session settings"
      onClick={onClose}
    >
      <div
        className="scroll-y flex w-full max-w-md flex-col gap-5 border-l border-[var(--line)] bg-[var(--bg-raised)] p-4 sm:p-5"
        style={{ paddingBottom: "calc(1.25rem + var(--safe-bottom))" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Session</h2>
          <Button size="sm" tone="quiet" onClick={onClose} ariaLabel="Close settings">
            Done
          </Button>
        </div>

        {degradedReason && (
          <p className="rounded-md border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-3 py-2 text-xs leading-relaxed text-[var(--warn)]">
            {degradedReason}
          </p>
        )}

        {/* The context control. A `Segmented` would be one row of nine
            options — too wide for a 390px sheet — so it wraps. */}
        <div ref={contextRef} className="flex flex-col gap-1.5">
          <Label>맥락</Label>
          <div
            role="radiogroup"
            aria-label="통역 맥락"
            className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--line)] bg-[var(--bg-overlay)] p-1"
          >
            {CONTEXT_DOMAINS.map((option) => {
              const selected = settings.context === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onContextChange(option)}
                  className={cn(
                    "min-h-11 rounded-lg px-2 text-sm transition-[color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                    selected
                      ? "bg-[var(--accent)] font-semibold text-[var(--accent-contrast)] shadow-sm"
                      : "text-[var(--fg-muted)] hover:bg-[color-mix(in_srgb,var(--bg-raised)_72%,transparent)] hover:text-[var(--fg)]",
                  )}
                >
                  {CONTEXT_LABEL_KO[option]}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-[var(--fg-dim)]" data-context-source={domain.source}>
            {settings.context === "auto"
              ? inferredContextLine(domain.domain, domain.confidence)
              : `${CONTEXT_LABEL_KO[settings.context]} · ${DOMAIN_SOURCE_KO.manual} — 자동으로 돌리면 다시 판단합니다`}
          </p>
        </div>

        <Field label="Lag" hint={LAG_PROFILES[settings.lag].description}>
          <Segmented<LagProfile>
            label="Interpreter lag"
            value={settings.lag}
            onChange={(lag) => patch({ lag })}
            options={(["fast", "balanced", "safe"] as LagProfile[]).map((lag) => ({
              value: lag,
              label: LAG_PROFILES[lag].label,
              title: LAG_PROFILES[lag].description,
            }))}
          />
        </Field>

        <Field label="View">
          <Segmented<ConsoleView>
            label="Console view"
            value={settings.view}
            onChange={(view) => patch({ view })}
            options={[
              { value: "console", label: "Console" },
              { value: "teleprompter", label: "Focus" },
            ]}
          />
        </Field>

        {/* Text size used to be two buttons on the live bar. It is set once, at
            the stand, for the distance the interpreter is reading from — so it
            belongs here, next to the other things decided before a service.
            The +/− shortcuts still work without opening this sheet. */}
        <Field label="Text size" hint="Shortcut: + and − during the session.">
          <div className="flex items-center gap-2">
            <Button
              size="md"
              className="min-w-14 flex-1"
              onClick={() => onFontScale(-0.1)}
              ariaLabel="Smaller text"
            >
              <span className="text-sm">A−</span>
            </Button>
            <span
              className="min-w-14 text-center text-sm tabular-nums text-[var(--fg-muted)]"
              aria-live="polite"
            >
              {Math.round(settings.fontScale * 100)}%
            </span>
            <Button
              size="md"
              className="min-w-14 flex-1"
              onClick={() => onFontScale(0.1)}
              ariaLabel="Larger text"
            >
              <span className="text-lg">A+</span>
            </Button>
          </div>
        </Field>

        <div className="flex flex-col gap-2">
          <Toggle
            checked={settings.showSource}
            onChange={(showSource) => patch({ showSource })}
            label="원문 자막"
          />
          <Toggle
            checked={settings.showGlossary}
            onChange={(showGlossary) => patch({ showGlossary })}
            label="Glossary"
          />
          <Toggle
            checked={settings.showScripture}
            onChange={(showScripture) => patch({ showScripture })}
            label="Scripture"
          />
          <Toggle
            checked={settings.rememberCorrections}
            onChange={(rememberCorrections) => patch({ rememberCorrections })}
            label="수정한 이름·용어 기억"
            hint={REMEMBER_CORRECTIONS_HINT}
          />
          <Toggle
            checked={settings.saveHistory}
            onChange={(saveHistory) => patch({ saveHistory })}
            label="Save this session"
            hint="Off by default. Stores the transcript in this browser only — never audio."
          />
        </div>

        {/* A correction is the interpreter overruling the recogniser, and it is
            permanent for the session. It belongs here, in reach, not buried.
            Long-pressing a line in the source pane opens the same thing. */}
        <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-4">
          <Label>Correct a name or term</Label>
          <p className="text-xs leading-relaxed text-[var(--fg-dim)]">
            Applies to everything already on screen and to every future mention.
          </p>
          <div className="flex items-center gap-2">
            <TextInput korean={sourceIsKorean} value={from} onChange={setFrom} placeholder={sourceIsKorean ? "유정길" : "heard"} />
            <span aria-hidden className="text-[var(--fg-dim)]">
              →
            </span>
            <TextInput korean={sourceIsKorean} value={to} onChange={setTo} placeholder={sourceIsKorean ? "류정길" : "correct"} />
          </div>
          {sourceIsKorean && to.trim() && (
            <p className="text-xs text-[var(--fg-dim)]">
              English: <span className="text-[var(--fg-muted)]">{romaniseName(to.trim())}</span>
            </p>
          )}
          <Button onClick={submitCorrection} disabled={!from.trim() || !to.trim()}>
            Apply correction
          </Button>

          {corrections.length > 0 && (
            <ul className="mt-1 space-y-1 text-xs text-[var(--fg-dim)]">
              {corrections.map((correction) => (
                <li
                  key={`${correction.from}-${correction.to}`}
                  className={sourceIsKorean ? "font-korean" : undefined}
                >
                  {correction.from} → {correction.to}
                  {correction.english && (
                    <span className="font-sans text-[var(--fg-muted)]"> · {correction.english}</span>
                  )}
                  {correction.remember && (
                    <span className="ml-1 font-sans text-[var(--fg-dim)]" title="Remembered for future sessions">
                      · 기억
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-4">
          <Button onClick={onExport}>Export session</Button>
          {!wakeLockSupported && (
            <p className="text-xs leading-relaxed text-[var(--fg-dim)]">
              This browser has no screen wake lock. Set the screen timeout manually before a long
              session.
            </p>
          )}
          {wakeLockSupported && (
            <p className="text-xs text-[var(--fg-dim)]">
              Screen wake lock: {wakeLockHeld ? "held" : "not held"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
