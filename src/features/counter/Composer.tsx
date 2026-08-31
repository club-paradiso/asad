"use client";

/** Counter input zone: voice first, then typing, with no dead-end state. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findLanguage } from "@/counter/languages";
import { detectRisks } from "@/counter/risks";
import type { RiskSpan } from "@/counter/types";
import type { CounterStrings } from "@/counter/ui-strings";
import { cn } from "@/lib/cn";
import { useVoiceInput } from "./useVoiceInput";
import { voiceStringsFor } from "./voice-strings";

interface PendingVoice {
  text: string;
  risks: RiskSpan[];
}

export function Composer({
  lang,
  strings,
  onSend,
  disabled = false,
  busy = false,
}: {
  lang: string;
  strings: CounterStrings;
  onSend: (text: string, source: "voice" | "text") => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [recoverableText, setRecoverableText] = useState<string | null>(null);
  const [pendingVoice, setPendingVoice] = useState<PendingVoice | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const voice = useVoiceInput(lang);
  const copy = useMemo(() => voiceStringsFor(lang), [lang]);
  const rtl = findLanguage(lang)?.rtl ?? false;

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || disabled || composing.current) return;

    // Keep one in-memory recovery copy before clearing the field. This lets the
    // next turn be typed immediately while translation is still running, but a
    // dropped request never destroys the only copy of what the person typed.
    setRecoverableText(text);
    setDraft("");
    onSend(text, "text");
    queueMicrotask(() => inputRef.current?.focus());
  }, [draft, disabled, onSend]);

  const restoreTypedTurn = useCallback(() => {
    if (!recoverableText) return;
    setDraft(recoverableText);
    setRecoverableText(null);
    queueMicrotask(() => {
      inputRef.current?.focus();
      const end = recoverableText.length;
      inputRef.current?.setSelectionRange(end, end);
    });
  }, [recoverableText]);

  const startVoice = useCallback(() => {
    if (disabled) return;
    setPendingVoice(null);
    void voice.start().then((text) => {
      const spoken = text.trim();
      if (!spoken) return;
      const risks = detectRisks(spoken);
      if (risks.length > 0) {
        setPendingVoice({ text: spoken, risks });
        return;
      }
      onSend(spoken, "voice");
    });
  }, [disabled, onSend, voice]);

  const toggleVoice = useCallback(() => {
    if (voice.listening) voice.stop();
    else startVoice();
  }, [startVoice, voice]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    if (voice.phase === "listening") navigator.vibrate(12);
    if (voice.phase === "finishing") navigator.vibrate(8);
  }, [voice.phase]);

  const status =
    voice.phase === "connecting"
      ? copy.connecting
      : voice.phase === "listening"
        ? copy.listening
        : voice.phase === "finishing"
          ? copy.finishing
          : busy
            ? copy.translating
            : copy.speak;
  const failureCopy = voice.failure ? copy.failure(voice.failure) : null;
  const cleanDraft = draft.trim();

  return (
    <div
      className="border-t border-[var(--line)] bg-[var(--bg-raised)] px-3 pt-3 sm:px-5"
      style={{ paddingBottom: "calc(0.75rem + var(--safe-bottom))" }}
      aria-busy={busy || voice.listening}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {pendingVoice && (
          <div
            className="rounded-xl border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_9%,transparent)] p-3"
            role="alert"
            dir={rtl ? "rtl" : undefined}
          >
            <p className="text-sm font-medium text-[var(--fg)]">
              {copy.confirmTranscript(pendingVoice.risks.map((risk) => risk.text).join(" · "))}
            </p>
            <p className="mt-1 line-clamp-2 text-xs text-[var(--fg-muted)]">
              {pendingVoice.text}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="min-h-11 flex-1 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)]"
                onClick={() => {
                  onSend(pendingVoice.text, "voice");
                  setPendingVoice(null);
                  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
                    navigator.vibrate(8);
                  }
                }}
              >
                {copy.yes}
              </button>
              <button
                type="button"
                className="min-h-11 flex-1 rounded-lg border border-[var(--line-strong)] px-4 text-sm text-[var(--fg)]"
                onClick={startVoice}
              >
                {copy.speakAgain}
              </button>
            </div>
          </div>
        )}

        {(voice.listening || voice.partial) && (
          <p
            className="line-clamp-2 text-center text-sm text-[var(--fg-muted)]"
            dir={rtl ? "rtl" : undefined}
            aria-live="polite"
          >
            {voice.partial || status}
          </p>
        )}

        {voice.usedFallback && voice.listening && (
          <p className="text-center text-xs text-[var(--fg-dim)]" aria-live="polite">
            {copy.fallback}
          </p>
        )}

        {failureCopy && (
          <button
            type="button"
            onClick={voice.dismissError}
            className="block w-full rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] px-3 py-2 text-left text-sm text-[var(--danger)]"
            role="alert"
          >
            {failureCopy}
          </button>
        )}

        {voice.supported && (
          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={toggleVoice}
              aria-label={status}
              aria-pressed={voice.listening}
              className={cn(
                "flex size-20 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,box-shadow,transform]",
                "touch-manipulation disabled:pointer-events-none disabled:opacity-40 active:scale-[0.97]",
                voice.listening
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_0_0_6px_var(--accent-dim)]"
                  : "border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] bg-[var(--accent-dim)] text-[var(--accent)]",
              )}
            >
              <MicIcon />
            </button>
            <span className="min-h-5 text-sm font-semibold text-[var(--fg)]" aria-live="polite">
              {status}
            </span>
          </div>
        )}

        <form
          className="flex min-w-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              const value = event.target.value;
              setDraft(value);
              if (value.trim()) setRecoverableText(null);
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              // Korean/Chinese/Japanese IMEs use Enter to commit a composition.
              // Safari and some Android browsers can otherwise submit the form
              // at the same time, producing a truncated or accidental message.
              if (
                event.key === "Enter" &&
                (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
              ) {
                event.preventDefault();
              }
            }}
            placeholder={strings.typeHere}
            disabled={disabled}
            dir={rtl ? "rtl" : undefined}
            lang={lang}
            enterKeyHint="send"
            autoComplete="off"
            className={cn(
              "min-w-0 flex-1 rounded-full border border-[var(--line-strong)] bg-[var(--bg-overlay)]",
              "px-4 py-3 text-base text-[var(--fg)] placeholder:text-[var(--fg-dim)]",
              "focus:border-[var(--accent)] focus:outline-none disabled:opacity-40",
            )}
          />
          {recoverableText && cleanDraft.length === 0 && (
            <button
              type="button"
              onClick={restoreTypedTurn}
              aria-label={restoreLabel(lang)}
              title={restoreLabel(lang)}
              className="grid min-h-12 min-w-12 shrink-0 place-items-center rounded-full border border-[var(--line-strong)] text-xl text-[var(--fg-muted)]"
            >
              ↩
            </button>
          )}
          <button
            type="submit"
            disabled={disabled || cleanDraft.length === 0}
            className={cn(
              "min-h-12 shrink-0 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-5",
              "text-base font-semibold text-[var(--accent-contrast)] transition-opacity",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {strings.send}
          </button>
        </form>
      </div>
    </div>
  );
}

function restoreLabel(language: string): string {
  if (language.startsWith("ko")) return "방금 입력 복원";
  if (language.startsWith("zh")) return "恢复刚才的输入";
  if (language.startsWith("ja")) return "直前の入力を復元";
  return "Restore previous text";
}

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}
