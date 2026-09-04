"use client";

/** Counter input zone: voice first, then typing, with no dead-end state. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findLanguage } from "@/counter/languages";
import { detectRisks } from "@/counter/risks";
import type { CounterMessage, RiskSpan } from "@/counter/types";
import type { CounterStrings } from "@/counter/ui-strings";
import { cn } from "@/lib/cn";
import { useVoiceInput } from "./useVoiceInput";
import { voiceStringsFor } from "./voice-strings";

interface PendingVoice {
  text: string;
  risks: RiskSpan[];
}

type DraftSource = "voice" | "text";
interface RecoverableDraft {
  text: string;
  source: DraftSource;
}

export function Composer({
  lang,
  strings,
  onSend,
  disabled = false,
  busy = false,
  counterCode,
  counterToken,
}: {
  lang: string;
  strings: CounterStrings;
  onSend: (text: string, source: "voice" | "text") => Promise<CounterMessage | null> | void;
  disabled?: boolean;
  busy?: boolean;
  /** Used only by the server to enforce the session's sensitive-data policy. */
  counterCode?: string;
  /** Session-scoped capability used for Counter speech endpoints. */
  counterToken?: string | null;
}) {
  const [draft, setDraft] = useState("");
  const [draftSource, setDraftSource] = useState<DraftSource>("text");
  const [recoverableDraft, setRecoverableDraft] = useState<RecoverableDraft | null>(null);
  const [pendingVoice, setPendingVoice] = useState<PendingVoice | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef("");
  const composing = useRef(false);
  const voice = useVoiceInput(lang, counterCode, counterToken ?? undefined);
  const copy = useMemo(() => voiceStringsFor(lang), [lang]);
  const rtl = findLanguage(lang)?.rtl ?? false;

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || disabled || composing.current) return;

    // Keep one in-memory recovery copy before clearing the field. This lets the
    // next turn be typed immediately while translation is still running, but a
    // dropped request never destroys the only copy of what the person entered.
    const source = draftSource;
    // When speech finished over a typed draft, startVoice already preserved
    // that earlier text. Sending the reviewed transcript must not replace it
    // with the transcript itself; the operator may restore and send both turns.
    const submitted = { text, source } satisfies RecoverableDraft;
    setRecoverableDraft((previous) => previous ?? submitted);
    draftRef.current = "";
    setDraft("");
    setDraftSource("text");
    setPendingVoice(null);
    const sent = onSend(text, source);
    if (sent && typeof sent.then === "function") {
      void sent.then((message) => {
        if (!message) setRecoverableDraft((previous) => previous ?? submitted);
      });
    }
    queueMicrotask(() => inputRef.current?.focus());
  }, [draft, draftSource, disabled, onSend]);

  const restoreTypedTurn = useCallback(() => {
    if (!recoverableDraft) return;
    draftRef.current = recoverableDraft.text;
    setDraft(recoverableDraft.text);
    setDraftSource(recoverableDraft.source);
    setPendingVoice(null);
    setRecoverableDraft(null);
    queueMicrotask(() => {
      inputRef.current?.focus();
      const end = recoverableDraft.text.length;
      inputRef.current?.setSelectionRange(end, end);
    });
  }, [recoverableDraft]);

  const startVoice = useCallback(() => {
    if (disabled) return;
    if (draft.trim()) setRecoverableDraft({ text: draft, source: draftSource });
    setPendingVoice(null);
    void voice.start().then((text) => {
      const spoken = text.trim();
      if (!spoken) return;

      const typedDraft = draftRef.current;
      const typedWhileListening = typedDraft.trim();
      if (typedWhileListening) {
        setRecoverableDraft((previous) => previous ?? { text: typedDraft, source: "text" });
      }
      const risks = detectRisks(spoken);
      draftRef.current = spoken;
      setDraft(spoken);
      setDraftSource("voice");
      setPendingVoice(risks.length > 0 ? { text: spoken, risks } : null);

      // Speech recognition is probabilistic, especially for names and proper
      // nouns. Always hand the transcript back to the user for correction
      // instead of treating ASR output as an unquestionable final message.
      queueMicrotask(() => {
        inputRef.current?.focus();
        const end = spoken.length;
        inputRef.current?.setSelectionRange(end, end);
      });
    });
  }, [disabled, draft, draftSource, voice]);

  const voiceFinishing = voice.phase === "finishing";
  const voiceActive = voice.active || voiceFinishing;

  const toggleVoice = useCallback(() => {
    if (voiceFinishing) return;
    if (voice.active) voice.stop();
    else startVoice();
  }, [startVoice, voice, voiceFinishing]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    // Haptic feedback is the physical signal that capture is genuinely ready.
    // Do not vibrate while permission/provider setup is merely connecting.
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
      aria-busy={busy || voiceActive}
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
                  setPendingVoice(null);
                  queueMicrotask(() => {
                    inputRef.current?.focus();
                    const end = draft.length;
                    inputRef.current?.setSelectionRange(end, end);
                  });
                }}
              >
                {editTranscriptLabel(lang)}
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

        {voiceActive && (
          <div
            className="rounded-xl border border-[color-mix(in_srgb,var(--accent)_32%,var(--line))] bg-[var(--accent-dim)] px-4 py-3 text-center"
            dir={rtl ? "rtl" : undefined}
            aria-live="polite"
          >
            <p className="text-sm font-semibold text-[var(--fg)]">{status}</p>
            {voice.partial && (
              <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[var(--fg-muted)]">
                {voice.partial}
              </p>
            )}
            {voice.listening && (
              <p className="mt-1 text-xs text-[var(--fg-dim)]">{voiceStopHint(lang)}</p>
            )}
          </div>
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
              disabled={disabled || voiceFinishing}
              onClick={toggleVoice}
              aria-label={voice.active ? voiceStopAriaLabel(lang) : status}
              aria-pressed={voice.listening}
              className={cn(
                "flex size-20 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,box-shadow,transform]",
                "touch-manipulation disabled:pointer-events-none disabled:opacity-55 active:scale-[0.97]",
                voice.listening
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_0_0_6px_var(--accent-dim)]"
                  : voice.active || voiceFinishing
                    ? "animate-pulse border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                    : "border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] bg-[var(--accent-dim)] text-[var(--accent)]",
              )}
            >
              {voice.listening ? <StopIcon /> : voice.active ? <PreparingIcon /> : <MicIcon />}
            </button>
            <span className="min-h-5 text-sm font-semibold text-[var(--fg)]" aria-live="polite">
              {status}
            </span>
          </div>
        )}

        {draftSource === "voice" && cleanDraft.length > 0 && (
          <div
            className="flex items-center justify-between gap-3 rounded-lg border border-[color-mix(in_srgb,var(--accent)_30%,var(--line))] bg-[var(--accent-dim)] px-3 py-2"
            dir={rtl ? "rtl" : undefined}
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--accent)]">{voiceReviewLabel(lang)}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--fg-dim)]">
                {voiceReviewHint(lang)}
              </p>
            </div>
            <button
              type="button"
              onClick={startVoice}
              disabled={disabled || voiceActive}
              className="min-h-10 shrink-0 rounded-full border border-[var(--line-strong)] px-3 text-xs font-semibold text-[var(--fg)] disabled:opacity-40"
            >
              {copy.speakAgain}
            </button>
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
              draftRef.current = value;
              setDraft(value);
              if (!value.trim()) {
                setDraftSource("text");
                setPendingVoice(null);
              }
              if (value.trim()) setRecoverableDraft(null);
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
              "min-w-0 flex-1 rounded-full border bg-[var(--bg-overlay)]",
              draftSource === "voice" && cleanDraft.length > 0
                ? "border-[var(--accent)] shadow-[0_0_0_2px_var(--accent-dim)]"
                : "border-[var(--line-strong)]",
              "px-4 py-3 text-base text-[var(--fg)] placeholder:text-[var(--fg-dim)]",
              "focus:border-[var(--accent)] focus:outline-none disabled:opacity-40",
            )}
          />
          {recoverableDraft && cleanDraft.length === 0 && (
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

function editTranscriptLabel(language: string): string {
  if (language.startsWith("ko")) return "직접 수정";
  if (language.startsWith("zh")) return "手动修改";
  if (language.startsWith("ja")) return "手動で修正";
  return "Edit transcript";
}

function voiceReviewLabel(language: string): string {
  if (language.startsWith("ko")) return "음성 인식 결과 · 수정 가능";
  if (language.startsWith("zh")) return "语音识别结果 · 可修改";
  if (language.startsWith("ja")) return "音声認識結果 · 編集できます";
  if (language.startsWith("vi")) return "Kết quả nhận dạng giọng nói · Có thể sửa";
  if (language.startsWith("th")) return "ผลการรู้จำเสียง · แก้ไขได้";
  if (language.startsWith("id")) return "Hasil pengenalan suara · Bisa diedit";
  if (language.startsWith("ru")) return "Результат распознавания · Можно исправить";
  if (language.startsWith("ar")) return "نتيجة التعرّف على الصوت · قابلة للتعديل";
  return "Speech transcript · Editable";
}

function voiceReviewHint(language: string): string {
  if (language.startsWith("ko")) {
    return "이름·고유명사나 잘못 인식된 부분을 바로 고친 뒤 전송하세요.";
  }
  if (language.startsWith("zh")) {
    return "请直接修改姓名、专有名词或识别错误后再发送。";
  }
  if (language.startsWith("ja")) {
    return "人名・固有名詞や誤認識された箇所を直してから送信してください。";
  }
  if (language.startsWith("vi")) {
    return "Sửa ngay tên riêng hoặc phần nhận dạng sai trước khi gửi.";
  }
  if (language.startsWith("th")) {
    return "แก้ชื่อ คำเฉพาะ หรือส่วนที่รู้จำผิดก่อนส่ง";
  }
  if (language.startsWith("id")) {
    return "Perbaiki nama, istilah khusus, atau bagian yang salah sebelum mengirim.";
  }
  if (language.startsWith("ru")) {
    return "Исправьте имена, термины и ошибки распознавания перед отправкой.";
  }
  if (language.startsWith("ar")) {
    return "صحّح الأسماء والمصطلحات وأخطاء التعرّف قبل الإرسال.";
  }
  return "Correct names, proper nouns, or recognition errors before sending.";
}

function voiceStopHint(language: string): string {
  if (language.startsWith("ko")) return "말이 끝났으면 마이크 버튼을 눌러 바로 멈출 수 있어요.";
  if (language.startsWith("zh")) return "说完后，再点一次麦克风即可立即停止。";
  if (language.startsWith("ja")) return "話し終えたら、マイクをもう一度押すとすぐ停止できます。";
  if (language.startsWith("vi")) return "Nói xong, chạm lại nút mic để dừng ngay.";
  if (language.startsWith("th")) return "พูดจบแล้ว แตะปุ่มไมค์อีกครั้งเพื่อหยุดได้ทันที";
  if (language.startsWith("id")) return "Setelah selesai bicara, ketuk mikrofon lagi untuk berhenti.";
  if (language.startsWith("ru")) return "Закончив говорить, нажмите микрофон ещё раз, чтобы остановить запись.";
  if (language.startsWith("ar")) return "بعد الانتهاء من الكلام، اضغط زر الميكروفون مرة أخرى للإيقاف.";
  return "When you finish speaking, tap the mic again to stop immediately.";
}

function voiceStopAriaLabel(language: string): string {
  if (language.startsWith("ko")) return "음성 입력 중지";
  if (language.startsWith("zh")) return "停止语音输入";
  if (language.startsWith("ja")) return "音声入力を停止";
  return "Stop voice input";
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

function PreparingIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-8 animate-spin" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M12 4a8 8 0 0 1 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-8" fill="currentColor" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  );
}
