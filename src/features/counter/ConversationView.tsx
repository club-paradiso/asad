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
import { useEffect, useRef } from "react";
import type { CounterMessage, Participant, RiskSpan } from "@/counter/types";
import { findLanguage } from "@/counter/languages";
import { actionStringsFor, stringsFor, type CounterStrings } from "@/counter/ui-strings";
import { cn } from "@/lib/cn";

/** Highlight the spans worth reading back, without mangling the text. */
function withRisksHighlighted(
  text: string,
  risks: RiskSpan[] | undefined,
  checkLabel: string,
) {
  if (!risks?.length) return text;

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
        <span key={index}>{node}</span>
      ) : (
        <mark
          key={index}
          title={checkLabel}
          className="rounded bg-[var(--accent-dim)] px-1 font-semibold text-[var(--accent)] decoration-clone"
        >
          {node.text}
        </mark>
      ),
    );
}

export function ConversationView({
  messages,
  viewerRole,
  viewerLang,
  onSimplify,
  onRetry,
  onConfirm,
  emptyMessage,
  strings,
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
  emptyMessage?: string;
  /** Chrome in the viewer's language; defaults to the viewer's language tag. */
  strings?: CounterStrings;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const rtl = findLanguage(viewerLang)?.rtl ?? false;
  const t = strings ?? stringsFor(viewerLang);
  const actions = actionStringsFor(viewerLang);

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

          return (
            <div
              key={message.id}
              className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[88%] rounded-2xl border px-3.5 py-2.5 sm:max-w-[78%]",
                  mine
                    ? "border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--accent-dim)]"
                    : "border-[var(--line)] bg-[var(--bg-raised)]",
                  failed && "border-[color-mix(in_srgb,var(--danger)_50%,transparent)]",
                )}
                dir={findLanguage(primaryLang)?.rtl ? "rtl" : rtl ? "ltr" : undefined}
              >
                {failed ? (
                  <>
                    <p className="text-base leading-snug text-[var(--fg)]">
                      {message.originalText}
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-[var(--danger)]">
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
                      )}
                    </p>

                    {/* Secondary: always present, so either party can spot an error. */}
                    <p
                      className="mt-1.5 border-t border-[var(--line)] pt-1.5 text-sm leading-snug text-[var(--fg-muted)]"
                      dir={findLanguage(secondaryLang)?.rtl ? "rtl" : undefined}
                    >
                      {withRisksHighlighted(
                        secondary,
                        mine ? message.risks : undefined,
                        t.checkThis,
                      )}
                    </p>
                  </>
                )}

                {message.integrity?.status === "mismatch" && (
                  <div className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] p-2 text-xs leading-relaxed text-[var(--warn)]">
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

                {viewerRole === "host" && message.reviewFlags?.length ? (
                  <div
                    role="alert"
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
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] text-[var(--fg-dim)]">
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
                      className="ml-auto rounded border border-[var(--line-strong)] px-2 py-0.5 hover:text-[var(--fg)]"
                    >
                      {t.confirmNumbers}
                    </button>
                  ) : null}
                  {mine && message.status === "done" && message.source !== "quick-phrase" && message.source !== "confirm" && (
                    <button
                      type="button"
                      onClick={() => onSimplify?.(message)}
                      className={cn(
                        "rounded border border-[var(--line-strong)] px-2 py-0.5 hover:text-[var(--fg)]",
                        !message.criticalValues?.length && !message.risks?.length && "ml-auto",
                      )}
                    >
                      {actions.simplify}
                    </button>
                  )}
                  {mine && message.source !== "quick-phrase" && message.source !== "confirm" && (
                    <button
                      type="button"
                      onClick={() => onRetry?.(message)}
                      className={cn(
                        "rounded border border-[var(--line-strong)] px-2 py-0.5 hover:text-[var(--fg)]",
                        message.status !== "done" && "ml-auto",
                      )}
                    >
                      {actions.retry}
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
