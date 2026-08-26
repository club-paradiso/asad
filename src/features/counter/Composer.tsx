"use client";

/**
 * Counter input bar: tap once to speak, or type at any time.
 *
 * Typing stays first-class even while speech recognition or translation is in
 * progress. A microphone tap starts one browser-recognised utterance; a natural
 * pause ends it and sends the recognised text into the conversation. Tapping the
 * microphone again ends the utterance early.
 */
import { useCallback, useState } from "react";
import { findLanguage } from "@/counter/languages";
import type { CounterStrings } from "@/counter/ui-strings";
import { useVoiceInput } from "./useVoiceInput";
import { cn } from "@/lib/cn";

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
  const voice = useVoiceInput(lang);
  const rtl = findLanguage(lang)?.rtl ?? false;

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft("");
    onSend(text, "text");
  }, [draft, disabled, onSend]);

  const toggleVoice = useCallback(() => {
    if (disabled) return;

    if (voice.listening) {
      voice.stop();
      return;
    }

    void voice.start().then((text) => {
      const spoken = text.trim();
      if (spoken) onSend(spoken, "voice");
    });
  }, [disabled, onSend, voice]);

  return (
    <div
      className="border-t border-[var(--line)] bg-[var(--bg-raised)] px-3 pt-2.5 sm:px-5"
      style={{ paddingBottom: "calc(0.625rem + var(--safe-bottom))" }}
    >
      {/* Live transcript preview. The text field remains independently usable. */}
      {voice.listening && (
        <p
          className="mb-2 line-clamp-2 text-sm text-[var(--fg-muted)]"
          dir={rtl ? "rtl" : undefined}
          aria-live="polite"
        >
          {voice.partial || strings.listening}
        </p>
      )}

      {voice.error && (
        <button
          type="button"
          onClick={voice.dismissError}
          className="mb-2 block w-full rounded border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] px-2.5 py-1.5 text-left text-xs text-[var(--danger)]"
        >
          {voice.error}
        </button>
      )}

      <div className="mx-auto flex max-w-3xl items-end gap-2">
        {voice.supported && (
          <button
            type="button"
            disabled={disabled}
            onClick={toggleVoice}
            aria-label="Voice input"
            aria-pressed={voice.listening}
            title={voice.listening ? strings.listening : "Voice input"}
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-colors",
              "disabled:pointer-events-none disabled:opacity-40",
              voice.listening
                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--bg)] shadow-[0_0_0_4px_var(--accent-dim)]"
                : "border-[var(--line-strong)] bg-[var(--bg-overlay)] text-[var(--fg)]",
            )}
          >
            <MicIcon />
          </button>
        )}

        <form
          className="flex min-w-0 flex-1 items-end gap-2"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={strings.typeHere}
            disabled={disabled}
            dir={rtl ? "rtl" : undefined}
            lang={lang}
            enterKeyHint="send"
            autoComplete="off"
            className={cn(
              "min-w-0 flex-1 rounded-full border border-[var(--line-strong)] bg-[var(--bg-overlay)]",
              // 16px minimum, or iOS Safari zooms the whole page on focus.
              "px-4 py-3 text-base text-[var(--fg)] placeholder:text-[var(--fg-dim)]",
              "focus:border-[var(--accent)] focus:outline-none disabled:opacity-40",
            )}
          />
          <button
            type="submit"
            disabled={disabled || draft.trim().length === 0}
            className={cn(
              "h-12 shrink-0 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-5",
              "text-base font-semibold text-[var(--bg)] transition-opacity",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {strings.send}
          </button>
        </form>
      </div>

      {voice.supported && voice.listening && (
        <p className="mx-auto mt-1.5 max-w-3xl text-center text-[0.7rem] text-[var(--fg-dim)]">
          {strings.listening}
        </p>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
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
