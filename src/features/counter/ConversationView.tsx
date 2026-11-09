"use client";

/**
 * The bilingual conversation.
 *
 * The load-bearing decision here: EVERY bubble shows both languages. Your own
 * language large, the other language underneath, smaller but fully legible.
 *
 * That is what lets either party catch an error. A visitor who reads a little
 * Korean, or who can simply recognise that a number looks wrong, has no way to
 * do that when one phone shows one language. It costs vertical space and is
 * worth every pixel.
 */
import { useEffect, useRef, useState } from "react";
import type { Participant, RiskSpan } from "@/counter/types";
import { findLanguage } from "@/counter/languages";
import { actionStringsFor, stringsFor, type CounterStrings } from "@/counter/ui-strings";
import { BidiText } from "@/lib/bidi";
import { cn } from "@/lib/cn";
import type { ClientCounterMessage as CounterMessage } from "./client-message";
import { voiceStringsFor } from "./voice-strings";
import { AdminAssist } from "./AdminAssist";
import { correctionStringsFor } from "./admin-strings";
import type { StaffDecision } from "./useCounterSession";

/** Inline editor for correcting one's own message. Sends a NEW message; the original stays visible. */
function CorrectionEditor({
  initial,
  lang,
  rtl,
  onSend,
  onCancel,
}: {
  initial: string;
  lang: string;
  rtl: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const c = correctionStringsFor(lang);
  const trimmed = text.trim();
  return (
    <form
      className="mt-2 space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed && trimmed !== initial.trim()) onSend(trimmed);
      }}
    >
      <label className="sr-only" htmlFor="counter-correction">
        {c.correct}
      </label>
      <textarea
        id="counter-correction"
        dir={rtl ? "rtl" : "ltr"}
        value={text}
        rows={2}
        maxLength={2000}
        autoFocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        className="w-full resize-y rounded-lg border border-[var(--line-strong)] bg-[var(--bg)] p-2 text-base text-[var(--fg)]"
      />
      <div className="flex flex-wrap justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-9 rounded-lg border border-[var(--line-strong)] px-3 text-xs hover:text-[var(--fg)]"
        >
          {c.cancel}
        </button>
        <button
          type="submit"
          disabled={!trimmed || trimmed === initial.trim()}
          className="min-h-9 rounded-lg border border-[var(--accent)] px-3 text-xs font-semibold text-[var(--accent)] disabled:opacity-50"
        >
          {c.send}
        </button>
      </div>
    </form>
  );
}

/** Highlight the spans worth reading back, without mangling the text. */
function withRisksHighlighted(
  text: string,
  risks: RiskSpan[] | undefined,
  checkLabel: string,
  rtl: boolean,
) {
  if (!risks?.length) return <BidiText text={text} rtl={rtl} />;

  // Longest first so a date containing a number is not split by it.
  const ordered = [...risks].sort((a, b) => b.text.length - a.text.length);
  const nodes: Array<string | RiskSpan> = [text];

  for (const risk of ordered) {
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (typeof node !== "string") continue;
      const at = node.indexOf(risk.text);
      if (at === -1) continue;
      nodes.splice(
        i,
        1,
        node.slice(0, at),
        risk,
        node.slice(at + risk.text.length),
      );
      break;
    }
  }

  return nodes
    .filter((node) => node !== "")
    .map((node, index) =>
      typeof node === "string" ? (
        <span key={index}>
          <BidiText text={node} rtl={rtl} />
        </span>
      ) : (
        <mark
          key={index}
          title={checkLabel}
          className="rounded bg-[var(--accent-dim)] px-1 font-semibold text-[var(--accent)] decoration-clone"
        >
          {/* A highlighted span is very often exactly the thing that reorders:
              a status code, a date, an office number. */}
          <BidiText text={node.text} rtl={rtl} />
        </mark>
      ),
    );
}

/**
 * "Translating…" plus the seconds it has taken, once it has taken a while.
 *
 * A bare pulsing dot looks identical at one second and at eight. Two people
 * staring at a counter need to see that it is still alive, so after the first
 * couple of seconds a plain counter appears. Numerals and "s" read the same in
 * every supported language, so no new strings are needed.
 */
function PendingStatus({ since, label, rtl }: { since: number; label: string; rtl: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <p
      className="mt-1.5 flex items-center gap-1.5 border-t border-[var(--line)] pt-1.5 text-sm text-[var(--fg-dim)]"
      dir={rtl ? "rtl" : "ltr"}
      role="status"
    >
      <span aria-hidden className="inline-block size-2 animate-pulse rounded-full bg-[var(--accent)]" />
      {label}
      {seconds >= 2 && (
        <span aria-hidden className="tabular-nums" dir="ltr">
          {seconds}s
        </span>
      )}
    </p>
  );
}

export function ConversationView({
  messages,
  viewerRole,
  viewerLang,
  onSimplify,
  onRetry,
  onConfirm,
  onDiscard,
  emptyMessage,
  strings,
  onReview,
  onCorrect,
  onAskClarification,
}: {
  messages: CounterMessage[];
  viewerRole: Participant;
  viewerLang: string;
  /** Re-run an own message with simpler wording while preserving facts. */
  onSimplify?: (message: CounterMessage) => void;
  /** Retry an own message's translation from its stored original text. */
  onRetry?: (message: CounterMessage) => void;
  /** Send just the flagged values back for verbal read-back. */
  onConfirm?: (message: CounterMessage) => void;
  /** Drop a message this device never managed to send. */
  onDiscard?: (message: CounterMessage) => void;
  emptyMessage?: string;
  /** Chrome in the viewer's language; defaults to the viewer's language tag. */
  strings?: CounterStrings;
  /** Staff only: record an explicit human decision on a turn. */
  onReview?: (messageId: string, decision: StaffDecision, conceptId?: string) => Promise<string | null>;
  /** Send a corrected version of an own message as a new, labelled message. */
  onCorrect?: (message: CounterMessage, text: string) => void;
  /** Staff only: send a suggested clarification question as the staff member's own words. */
  onAskClarification?: (message: CounterMessage, question: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const rtl = findLanguage(viewerLang)?.rtl ?? false;
  const t = strings ?? stringsFor(viewerLang);
  const actions = actionStringsFor(viewerLang);
  const translatingLabel = voiceStringsFor(viewerLang).translating;
  const c = correctionStringsFor(viewerLang);
  const correctedIds = new Set(
    messages.map((message) => message.correctionOf).filter((id): id is string => !!id),
  );

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="max-w-sm text-sm leading-relaxed text-[var(--fg-dim)]">
          {emptyMessage ?? t.emptyConversation}
        </p>
      </div>
    );
  }

  return (
    <div className="scroll-y h-full px-3 py-3 sm:px-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {messages.map((message) => {
          const mine = message.from === viewerRole;
          // What the viewer reads first depends on who said it: their own words
          // as they typed them, or the incoming message translated for them.
          const primary = mine ? message.originalText : message.translatedText;
          const secondary = mine ? message.translatedText : message.originalText;
          const primaryLang = mine ? message.originalLang : message.targetLang;
          const secondaryLang = mine ? message.targetLang : message.originalLang;
          const failed = message.status === "failed";
          const pending = message.status === "pending";
          // The direction each half is actually rendered in, which is what
          // decides whether its Latin runs need isolating.
          const primaryRtl = findLanguage(primaryLang)?.rtl ?? false;
          const secondaryRtl = findLanguage(secondaryLang)?.rtl ?? false;
          const originalRtl = findLanguage(message.originalLang)?.rtl ?? false;

          return (
            <div
              key={message.id}
              className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
            >
              <div
                data-status={message.status}
                aria-busy={pending || undefined}
                className={cn(
                  "max-w-[88%] rounded-2xl border px-3.5 py-2.5 sm:max-w-[78%]",
                  mine
                    ? "border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--accent-dim)]"
                    : "border-[var(--line)] bg-[var(--bg-raised)]",
                  failed && "border-[color-mix(in_srgb,var(--danger)_50%,transparent)]",
                  pending && "border-dashed",
                  correctedIds.has(message.id) && "opacity-60",
                )}
                dir={
                  (failed || pending ? originalRtl : primaryRtl) ? "rtl" : rtl ? "ltr" : undefined
                }
              >
                {(message.correctionOf || message.clarifies || correctedIds.has(message.id)) && (
                  <p
                    dir={rtl ? "rtl" : "ltr"}
                    className="mb-1 text-xs font-semibold text-[var(--fg-muted)]"
                  >
                    {correctedIds.has(message.id)
                      ? c.replaced
                      : message.correctionOf
                        ? c.correctedVersion
                        : c.clarifying}
                  </p>
                )}
                {pending ? (
                  <>
                    {/* The sender's own words, the moment they pressed Send.
                        The translation line is a status until the server
                        answers, so "sent" and "translated" never look alike. */}
                    <p className="text-lg leading-snug text-[var(--fg)] sm:text-xl">
                      <BidiText text={message.originalText} rtl={originalRtl} />
                    </p>
                    <PendingStatus since={message.at} label={translatingLabel} rtl={rtl} />
                  </>
                ) : failed ? (
                  <>
                    <p className="text-base leading-snug text-[var(--fg)]">
                      <BidiText text={message.originalText} rtl={originalRtl} />
                    </p>
                    <p
                      className="mt-1.5 text-xs leading-relaxed text-[var(--danger)]"
                      dir={rtl ? "rtl" : "ltr"}
                    >
                      {t.translationFailed}.
                    </p>
                  </>
                ) : (
                  <>
                    {/* Primary: the language this viewer reads. */}
                    <p className="text-lg leading-snug text-[var(--fg)] sm:text-xl">
                      {withRisksHighlighted(
                        primary,
                        mine ? undefined : message.risks,
                        t.checkThis,
                        primaryRtl,
                      )}
                    </p>

                    {/* Secondary: always present, so either party can spot an error. */}
                    <p
                      className="mt-1.5 border-t border-[var(--line)] pt-1.5 text-sm leading-snug text-[var(--fg-muted)]"
                      // Explicit, never inherited. The bubble carries the
                      // PRIMARY language's direction, so an undefined dir here
                      // rendered a Korean line right-to-left inside an Uyghur
                      // bubble and moved its full stop to the wrong end.
                      dir={secondaryRtl ? "rtl" : "ltr"}
                    >
                      {withRisksHighlighted(
                        secondary,
                        mine ? message.risks : undefined,
                        t.checkThis,
                        secondaryRtl,
                      )}
                    </p>
                  </>
                )}

                {message.integrity?.status === "mismatch" && (
                  <div
                    dir={rtl ? "rtl" : "ltr"}
                    className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] p-2 text-xs leading-relaxed text-[var(--warn)]"
                  >
                    <p>{actions.integrityWarning}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {message.integrity.issues.slice(0, 4).map((issue, index) => (
                        <span
                          key={`${issue.kind}-${index}`}
                          className="rounded border border-[color-mix(in_srgb,var(--warn)_35%,transparent)] px-1.5 py-0.5 font-mono"
                        >
                          {issue.sourceText || "—"}
                          {issue.targetText ? ` → ${issue.targetText}` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {viewerRole === "host" && !pending && !message.local && (
                  <AdminAssist
                    message={message}
                    staffLang={viewerLang}
                    onReview={onReview}
                    onAskClarification={onAskClarification}
                  />
                )}

                {editing === message.id && onCorrect && (
                  <CorrectionEditor
                    initial={message.originalText}
                    lang={viewerLang}
                    rtl={originalRtl}
                    onCancel={() => setEditing(null)}
                    onSend={(text) => {
                      setEditing(null);
                      onCorrect(message, text);
                    }}
                  />
                )}

                {viewerRole === "host" && message.reviewFlags?.length ? (
                  <div
                    role="alert"
                    dir="ltr"
                    className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_7%,transparent)] p-2 text-xs leading-relaxed text-[var(--danger)]"
                  >
                    <p className="font-semibold">직원 확인 필요</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {message.reviewFlags.map((flag, index) => (
                        <li key={`${flag.kind}-${index}`}>{flag.reason}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-[var(--fg-dim)]">
                      이 표시는 현재 발화만 확인하라는 신호이며, 개인 위험도나 자동 행정판단에 사용되지 않습니다.
                    </p>
                  </div>
                ) : null}

                {/* Metadata row: only what is actionable. */}
                <div
                  dir={rtl ? "rtl" : "ltr"}
                  className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-[var(--fg-dim)]"
                >
                  {message.source === "quick-phrase" && (
                    <span className="text-[var(--ok)]">{t.fixedPhrase}</span>
                  )}
                  {message.confidence === "low" && message.integrity?.status !== "mismatch" && (
                    <span className="text-[var(--warn)]">{actions.lowConfidence}</span>
                  )}
                  {message.note && <span>{message.note}</span>}

                  {mine && (message.criticalValues?.length || message.risks?.length) ? (
                    <button
                      type="button"
                      onClick={() => onConfirm?.(message)}
                      className="ml-auto min-h-9 rounded-lg border border-[var(--line-strong)] px-3 hover:text-[var(--fg)]"
                    >
                      {t.confirmNumbers}
                    </button>
                  ) : null}
                  {mine && message.status === "done" && !pending && message.source !== "quick-phrase" && message.source !== "confirm" && (
                    <button
                      type="button"
                      onClick={() => onSimplify?.(message)}
                      className={cn(
                        "min-h-9 rounded-lg border border-[var(--line-strong)] px-3 hover:text-[var(--fg)]",
                        !message.criticalValues?.length && !message.risks?.length && "ml-auto",
                      )}
                    >
                      {actions.simplify}
                    </button>
                  )}
                  {mine && !pending && message.source !== "quick-phrase" && message.source !== "confirm" && (
                    <button
                      type="button"
                      onClick={() => onRetry?.(message)}
                      className={cn(
                        "min-h-9 rounded-lg border border-[var(--line-strong)] px-3 hover:text-[var(--fg)]",
                        message.status !== "done" && "ml-auto",
                        failed && "border-[var(--fg-muted)] font-semibold text-[var(--fg)]",
                      )}
                    >
                      {actions.retry}
                    </button>
                  )}
                  {mine &&
                    onCorrect &&
                    !pending &&
                    !message.local &&
                    editing !== message.id &&
                    !correctedIds.has(message.id) &&
                    (message.source === "voice" || message.source === "text") && (
                      <button
                        type="button"
                        onClick={() => setEditing(message.id)}
                        className="min-h-9 rounded-lg border border-[var(--line-strong)] px-3 hover:text-[var(--fg)]"
                      >
                        {c.correct}
                      </button>
                    )}
                  {mine && failed && message.local && onDiscard && (
                    <button
                      type="button"
                      onClick={() => onDiscard(message)}
                      aria-label={actions.discard}
                      title={actions.discard}
                      className="grid min-h-9 min-w-9 place-items-center rounded border border-[var(--line-strong)] text-base leading-none hover:text-[var(--fg)]"
                    >
                      <span aria-hidden>×</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
