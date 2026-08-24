"use client";

/**
 * Settings, correction and session control — everything that must exist but
 * must not be on screen during interpretation.
 *
 * Opening this covers the console, which is intentional: if the interpreter is
 * in here they are not reading English, and pretending otherwise would just
 * make both surfaces worse.
 */
import { useEffect, useState } from "react";
import type {
  ConsoleView,
  CorrectionRecord,
  InterpretationMode,
  LagProfile,
  SessionSettings,
} from "@/types";
import { LAG_PROFILES } from "@/interpreter/engine/lag";
import { romaniseName } from "@/lib/romanise";
import {
  Button,
  Field,
  Label,
  Segmented,
  TextInput,
  Toggle,
} from "@/components/ui/primitives";

export function SettingsSheet({
  open,
  onClose,
  settings,
  onSettingsChange,
  corrections,
  onCorrect,
  onExport,
  wakeLockHeld,
  wakeLockSupported,
  degradedReason,
}: {
  open: boolean;
  onClose: () => void;
  settings: SessionSettings;
  onSettingsChange: (settings: SessionSettings) => void;
  corrections: CorrectionRecord[];
  onCorrect: (from: string, to: string, english?: string) => void;
  onExport: () => void;
  wakeLockHeld: boolean;
  wakeLockSupported: boolean;
  degradedReason?: string;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const patch = (next: Partial<SessionSettings>) => onSettingsChange({ ...settings, ...next });

  const submitCorrection = () => {
    if (!from.trim() || !to.trim()) return;
    onCorrect(from.trim(), to.trim(), romaniseName(to.trim()));
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

        <Field label="Mode">
          <Segmented<InterpretationMode>
            label="Interpretation mode"
            value={settings.mode}
            onChange={(mode) => patch({ mode })}
            options={[
              { value: "sermon", label: "Sermon" },
              { value: "general", label: "General" },
            ]}
          />
        </Field>

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
              { value: "teleprompter", label: "Teleprompter" },
            ]}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <Toggle
            checked={settings.showKorean}
            onChange={(showKorean) => patch({ showKorean })}
            label="Korean transcript"
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
            checked={settings.saveHistory}
            onChange={(saveHistory) => patch({ saveHistory })}
            label="Save this session"
            hint="Off by default. Stores the transcript in this browser only — never audio."
          />
        </div>

        {/* A correction is the interpreter overruling the recogniser, and it is
            permanent for the session. It belongs here, in reach, not buried. */}
        <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-4">
          <Label>Correct a name or term</Label>
          <p className="text-xs leading-relaxed text-[var(--fg-dim)]">
            Applies to everything already on screen and to every future mention.
          </p>
          <div className="flex items-center gap-2">
            <TextInput korean value={from} onChange={setFrom} placeholder="유정길" />
            <span aria-hidden className="text-[var(--fg-dim)]">
              →
            </span>
            <TextInput korean value={to} onChange={setTo} placeholder="류정길" />
          </div>
          {to.trim() && (
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
                <li key={`${correction.from}-${correction.to}`} className="font-korean">
                  {correction.from} → {correction.to}
                  {correction.english && (
                    <span className="font-sans text-[var(--fg-muted)]"> · {correction.english}</span>
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
