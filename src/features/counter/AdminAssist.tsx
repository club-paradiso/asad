"use client";

/**
 * Staff-only assistance under one conversation turn.
 *
 * Information order is the order a staff member needs it in:
 *   1. Is this translation safe to rely on?   (automatic check verdict)
 *   2. Is there more than one procedure this could mean?   (ambiguity + question)
 *   3. Which administrative terms were used, and how?   (terminology)
 *   4. What did a person decide?   (staff review controls)
 *
 * Nothing here changes the translation. A suggested question is sent only if
 * the staff member presses the button, and it goes out as THEIR utterance,
 * through the normal translation and checks, labelled as a clarifying question.
 */
import { useId, useState } from "react";
import type { CounterMessage } from "@/counter/types";
import type { SemanticIssue, SemanticSeverity } from "@/counter/admin/semantic";
import type { StaffDecision } from "./useCounterSession";
import { cn } from "@/lib/cn";

type Lang = "ko" | "en";

const T = {
  ko: {
    checks: "자동 검사",
    passed: "자동 검사 통과 (사람 검토 아님)",
    review: "확인 권장",
    blocked: "의미·값 불일치 — 그대로 믿지 마세요",
    unverified: "의미 검사 미지원 언어 — 값만 검사함",
    unchecked: "미검사 항목",
    ambiguity: "어느 절차인지 확인 필요",
    candidates: "후보",
    evidence: "근거 표현",
    confirmCandidate: "방문자가 이 절차라고 확인함",
    question: "추천 확인 질문",
    askQuestion: "이 질문 보내기",
    asked: "보냄",
    terms: "행정 용어",
    provisional: "임시 번역어",
    curated: "기존 대역어",
    uncertainty: "불확실성 구분",
    acoustic: "음성인식",
    terminology: "용어",
    procedural: "절차",
    translation: "번역",
    confirmed: "직원 확인함",
    confirmedAs: "직원 확인: ",
    rejected: "직원이 틀렸다고 표시함",
    markConfirmed: "확인함",
    markRejected: "틀림 표시",
    clear: "표시 취소",
    noHuman: "아직 사람이 확인하지 않았습니다.",
    severity: { critical: "치명", high: "중대", medium: "주의", low: "참고" } as Record<SemanticSeverity, string>,
    kinds: { term: "공식어", alternative: "대체어", colloquial: "구어", "asr-error": "인식오류?", "mt-error": "오역 표현" } as Record<string, string>,
  },
  en: {
    checks: "Automatic checks",
    passed: "Automatic checks passed (not reviewed by a person)",
    review: "Please check",
    blocked: "Meaning or value mismatch — do not rely on this",
    unverified: "Meaning checks not available for this language — values only",
    unchecked: "Not checked",
    ambiguity: "Which procedure? Needs clarifying",
    candidates: "Candidates",
    evidence: "Triggered by",
    confirmCandidate: "Visitor confirmed this procedure",
    question: "Suggested question",
    askQuestion: "Ask this question",
    asked: "Sent",
    terms: "Administrative terms",
    provisional: "provisional translation",
    curated: "established pairing",
    uncertainty: "Uncertainty by source",
    acoustic: "Speech recognition",
    terminology: "Terminology",
    procedural: "Procedure",
    translation: "Translation",
    confirmed: "Confirmed by staff",
    confirmedAs: "Staff confirmed: ",
    rejected: "Marked wrong by staff",
    markConfirmed: "Confirm",
    markRejected: "Mark wrong",
    clear: "Undo",
    noHuman: "No person has confirmed this yet.",
    severity: { critical: "critical", high: "high", medium: "medium", low: "low" } as Record<SemanticSeverity, string>,
    kinds: { term: "official", alternative: "variant", colloquial: "colloquial", "asr-error": "misheard?", "mt-error": "mistranslation" } as Record<string, string>,
  },
};

const SEVERITY_TONE: Record<SemanticSeverity, string> = {
  critical: "text-[var(--danger)] border-[color-mix(in_srgb,var(--danger)_45%,transparent)]",
  high: "text-[var(--danger)] border-[color-mix(in_srgb,var(--danger)_30%,transparent)]",
  medium: "text-[var(--warn)] border-[color-mix(in_srgb,var(--warn)_40%,transparent)]",
  low: "text-[var(--fg-dim)] border-[var(--line)]",
};

export function AdminAssist({
  message,
  staffLang,
  onReview,
  onAskClarification,
}: {
  message: CounterMessage;
  staffLang: string;
  onReview?: (messageId: string, decision: StaffDecision, conceptId?: string) => Promise<string | null>;
  onAskClarification?: (message: CounterMessage, question: string) => void;
}) {
  const lang: Lang = staffLang.toLowerCase().startsWith("ko") ? "ko" : "en";
  const t = T[lang];
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<Set<string>>(() => new Set());

  const analysis = message.analysis;
  const integrity = message.integrity;
  const semanticIssues: SemanticIssue[] = integrity?.semantic?.issues ?? [];
  const visibleIssues = semanticIssues.filter((issue) => issue.severity !== "low");
  const review = message.staffReview;
  const done = message.status === "done";

  if (!done && !analysis) return null;

  const decide = async (decision: StaffDecision, conceptId?: string) => {
    if (!onReview || busy) return;
    setBusy(true);
    setError(null);
    const failure = await onReview(message.id, decision, conceptId);
    setBusy(false);
    if (failure) setError(failure);
  };

  const assessment = integrity?.assessment;
  const verdict =
    assessment === "blocked"
      ? { label: t.blocked, tone: "text-[var(--danger)]", icon: "✕" }
      : assessment === "review"
        ? { label: t.review, tone: "text-[var(--warn)]", icon: "!" }
        : assessment === "unverified"
          ? { label: t.unverified, tone: "text-[var(--fg-muted)]", icon: "?" }
          : assessment === "passed"
            ? { label: t.passed, tone: "text-[var(--ok)]", icon: "✓" }
            : null;

  const candidateLabel = (conceptId: string) => {
    for (const finding of analysis?.ambiguities ?? []) {
      const hit = finding.candidates.find((candidate) => candidate.conceptId === conceptId);
      if (hit) return lang === "ko" ? hit.ko : hit.en;
    }
    return conceptId;
  };

  return (
    <section
      aria-labelledby={headingId}
      dir="ltr"
      lang={lang}
      className="mt-2 space-y-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2.5 text-xs leading-relaxed text-[var(--fg-muted)]"
    >
      <h3 id={headingId} className="sr-only">
        {t.checks}
      </h3>

      {/* 1. Verdict */}
      {verdict && (
        <div>
          <p className={cn("flex items-center gap-1.5 font-semibold", verdict.tone)}>
            <span aria-hidden className="inline-grid size-4 place-items-center rounded-full border border-current text-[10px]">
              {verdict.icon}
            </span>
            {verdict.label}
          </p>
          {visibleIssues.length > 0 && (
            <ul className="mt-1 space-y-1">
              {visibleIssues.slice(0, 4).map((issue, index) => (
                <li
                  key={`${issue.check}-${index}`}
                  className={cn("rounded border px-1.5 py-1", SEVERITY_TONE[issue.severity])}
                >
                  <span className="font-semibold">[{t.severity[issue.severity]}]</span> {issue.message}
                  {(issue.sourceEvidence || issue.targetEvidence) && (
                    <span className="ml-1 font-mono text-[var(--fg-dim)]">
                      {issue.sourceEvidence ?? "—"} → {issue.targetEvidence ?? "—"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {integrity?.semantic && integrity.semantic.unchecked.length > 0 && integrity.semantic.status !== "unsupported" && (
            <p className="mt-0.5 text-[var(--fg-dim)]">
              {t.unchecked}: {integrity.semantic.unchecked.join(", ")}
            </p>
          )}
        </div>
      )}

      {/* 2. Ambiguity */}
      {analysis?.ambiguities.map((finding) => {
        const clarification = analysis.clarifications.find((item) => item.ruleId === finding.ruleId);
        const question = clarification ? clarification[lang] : null;
        const wasAsked = asked.has(finding.ruleId);
        return (
          <div
            key={finding.ruleId}
            role="note"
            className="rounded-lg border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] p-2"
          >
            <p className="font-semibold text-[var(--warn)]">{t.ambiguity}</p>
            <p className="mt-0.5 text-[var(--fg)]">{finding.explanation}</p>
            <p className="mt-1 text-[var(--fg-dim)]">
              {t.evidence}: <span className="font-mono">{finding.evidence.join(" · ")}</span>
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label={t.candidates}>
              {finding.candidates.map((candidate) => {
                const chosen = review?.decision === "confirmed" && review.conceptId === candidate.conceptId;
                return (
                  <button
                    key={candidate.conceptId}
                    type="button"
                    disabled={busy || !done || !onReview}
                    aria-pressed={chosen}
                    title={t.confirmCandidate}
                    onClick={() => void decide(chosen ? "cleared" : "confirmed", chosen ? undefined : candidate.conceptId)}
                    className={cn(
                      "min-h-9 rounded-lg border px-2.5 text-left text-[var(--fg)] disabled:opacity-50",
                      chosen
                        ? "border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_12%,transparent)]"
                        : "border-[var(--line-strong)] hover:border-[var(--fg-muted)]",
                    )}
                  >
                    {chosen && <span aria-hidden>✓ </span>}
                    {lang === "ko" ? candidate.ko : candidate.en}{" "}
                    <span className="text-[var(--fg-dim)]">{lang === "ko" ? candidate.en : candidate.ko}</span>
                  </button>
                );
              })}
            </div>
            {question && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 basis-48">
                  <span className="text-[var(--fg-dim)]">{t.question}: </span>
                  <span className="text-[var(--fg)]">{question}</span>
                </p>
                {onAskClarification && (
                  <button
                    type="button"
                    disabled={wasAsked}
                    onClick={() => {
                      setAsked((current) => new Set(current).add(finding.ruleId));
                      onAskClarification(message, question);
                    }}
                    className="min-h-9 rounded-lg border border-[var(--accent)] px-3 font-semibold text-[var(--accent)] disabled:opacity-60"
                  >
                    {wasAsked ? t.asked : t.askQuestion}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* 3. Terminology */}
      {analysis && analysis.terms.length > 0 && (
        <div>
          <p className="font-semibold text-[var(--fg-muted)]">{t.terms}</p>
          <ul className="mt-0.5 flex flex-wrap gap-1">
            {analysis.terms.map((term) => (
              <li
                key={`${term.conceptId}-${term.heard}`}
                className={cn(
                  "rounded border px-1.5 py-0.5",
                  term.kind === "term" || term.kind === "alternative"
                    ? "border-[var(--line)]"
                    : "border-[color-mix(in_srgb,var(--warn)_45%,transparent)]",
                )}
                title={term.note}
              >
                <span className="text-[var(--fg)]">{term.heard}</span>
                <span className="text-[var(--fg-dim)]"> · {t.kinds[term.kind]} → </span>
                <span className="text-[var(--fg)]">{term.ko}</span>
                <span className="text-[var(--fg-dim)]"> / {term.en}</span>
                {term.target && term.target.lang.split("-")[0] !== "en" && term.target.lang.split("-")[0] !== "ko" && (
                  <span className="text-[var(--fg-dim)]">
                    {" "}/ {term.target.term}{" "}
                    <em className="not-italic">({term.target.status === "provisional" ? t.provisional : t.curated})</em>
                  </span>
                )}
                {term.note && <span className="block text-[var(--warn)]">{term.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Uncertainty, kept separate rather than one misleading percentage. */}
      {analysis && (
        <details>
          <summary className="cursor-pointer select-none text-[var(--fg-dim)]">{t.uncertainty}</summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            {(["acoustic", "terminology", "procedural", "translation"] as const).map((key) => (
              <div key={key} className="contents">
                <dt className="text-[var(--fg-dim)]">{t[key]}</dt>
                <dd className={analysis.uncertainty[key].level === "present" ? "text-[var(--warn)]" : ""}>
                  {analysis.uncertainty[key].reason}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {/* 4. Human decision */}
      {done && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] pt-2">
          <p role="status" className="mr-auto">
            {review?.decision === "confirmed"
              ? review.conceptId
                ? `${t.confirmedAs}${candidateLabel(review.conceptId)}`
                : t.confirmed
              : review?.decision === "rejected"
                ? t.rejected
                : t.noHuman}
          </p>
          {!onReview ? null : review ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide("cleared")}
              className="min-h-9 rounded-lg border border-[var(--line-strong)] px-3 hover:text-[var(--fg)] disabled:opacity-50"
            >
              {t.clear}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void decide("confirmed")}
                className="min-h-9 rounded-lg border border-[var(--line-strong)] px-3 hover:text-[var(--fg)] disabled:opacity-50"
              >
                {t.markConfirmed}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void decide("rejected")}
                className="min-h-9 rounded-lg border border-[var(--line-strong)] px-3 hover:text-[var(--danger)] disabled:opacity-50"
              >
                {t.markRejected}
              </button>
            </>
          )}
          {error && (
            <p role="alert" className="basis-full text-[var(--danger)]">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
