"use client";

/**
 * The input bar: hold to speak, or type.
 *
 * Typing is always available and always first-class. Speech recognition is
 * missing or unreliable for several of the languages that turn up most often at
 * a Korean counter — Uzbek, Mongolian, Khmer, Burmese — and a visitor who
 * cannot get the microphone to work must not be stuck.
 *
 * Push-to-talk rather than continuous listening: at a counter there is a queue,
 * a radio, and two people talking. Holding a button is unambiguous about whose
 * turn it is.
 */
import { useCallback, useRef, useState } from "react";
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

  // Guards a double-fire when a device emits both pointer and mouse events.
  const holding = useRef(false);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft("");
    onSend(text, "text");
  }, [draft, disabled, onSend]);

  const beginHold = useCallback(() => {
    if (holding.current || disabled) return;
    holding.current = true;
    void voice.start().then((text) => {
      holding.current = false;
      const spoken = text.trim();
      if (spoken) onSend(spoken, "voice");
    });
  }, [disabled, onSend, voice]);

  const endHold = useCallback(() => {
    if (!holding.current) return;
    voice.stop();
  }, [voice]);

  return (
    <div
      className="border-t border-[var(--line)] bg-[var(--bg-raised)] px-3 pt-2.5 sm:px-5"
      style={{ paddingBottom: "calc(0.625rem + var(--safe-bottom))" }}
    >
      {/* What was heard so far, so the speaker can see it is working. */}
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
            // Pointer events cover mouse, touch and pen with one path, and
            // `pointercancel` matters: a scroll gesture must not leave the
            // microphone open.
            onPointerDown={beginHold}
            onPointerUp={endHold}
            onPointerCancel={endHold}
            onPointerLeave={endHold}
            // Stops iOS turning a long press into text selection or a callout.
            onContextMenu={(event) => event.preventDefault()}
            aria-label={strings.holdToSpeak}
            aria-pressed={voice.listening}
            className={cn(
              "flex h-12 w-12 shrink-0 touch-none items-center justify-center rounded-full border transition-colors select-none",
              "disabled:pointer-events-none disabled:opacity-40",
              voice.listening
                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--bg)]"
                : "border-[var(--line-strong)] bg-[var(--bg-overlay)] text-[var(--fg)]",
            )}
          >
            <MicIcon />
          </button>
        )}

        <form
          className="flex min-w-0 flex-1 items-end gap-2"
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
            disabled={disabled || busy || draft.trim().length === 0}
            className={cn(
              "h-12 shrink-0 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-5",
              "text-base font-semibold text-[var(--bg)] transition-opacity",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {busy ? "…" : strings.send}
          </button>
        </form>
      </div>

      {voice.supported && (
        <p className="mx-auto mt-1.5 max-w-3xl text-center text-[0.7rem] text-[var(--fg-dim)]">
          {strings.holdToSpeak}
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
