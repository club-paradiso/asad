"use client";

/**
 * Post-session review.
 *
 * The interpreter has just finished; they are tired and they want two things:
 * a record they can hand over, and a short list of what to prepare differently
 * next time. Everything here is derived locally from the session data.
 */
import { useMemo } from "react";
import type { StoredSession } from "@/types";
import { buildReview } from "./review";
import { downloadSession } from "@/lib/export";
import { Button, Label } from "@/components/ui/primitives";

const duration = (ms: number) => {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}분 ${seconds.toString().padStart(2, "0")}초`;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-[var(--line)] pt-5">
      <Label>{title}</Label>
      {children}
    </section>
  );
}

export function SessionSummary({
  session,
  onClose,
}: {
  session: StoredSession;
  onClose: () => void;
}) {
  const review = useMemo(() => buildReview(session), [session]);

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col gap-5 px-5 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {session.title || "세션 복기"}
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            {session.speaker ? `${session.speaker} · ` : ""}
            {duration(review.durationMs)} · 세그먼트 {review.segmentCount}개 ·{" "}
            영어 {review.chunkCount}줄 · 한국어 {review.koreanCharacters.toLocaleString()}자
          </p>
        </div>
        <Button tone="quiet" onClick={onClose}>
          닫기
        </Button>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => downloadSession(session, "markdown")}>
          Markdown 내보내기
        </Button>
        <Button size="sm" onClick={() => downloadSession(session, "txt")}>
          TXT 내보내기
        </Button>
        <Button size="sm" onClick={() => downloadSession(session, "json")}>
          JSON 내보내기
        </Button>
      </div>

      <Section title="다음에 준비할 것">
        {review.suggestedPrepTerms.length === 0 ? (
          <p className="text-sm text-[var(--fg-dim)]">반복되어 표시할 만큼 나온 표현이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {review.suggestedPrepTerms.map((term) => (
              <li key={term.korean} className="flex flex-wrap items-baseline gap-2">
                <span className="font-korean text-[var(--fg)]">{term.korean}</span>
                <span aria-hidden className="text-[var(--fg-dim)]">
                  →
                </span>
                <span className="text-[var(--fg)]">{term.english}</span>
                {term.note && <span className="text-xs text-[var(--fg-dim)]">{term.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="통역이 까다로웠던 지점">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-[var(--fg-muted)]">
          {review.challenges.map((challenge) => (
            <li key={challenge}>{challenge}</li>
          ))}
        </ul>
      </Section>

      {review.recurringRecognitionErrors.length > 0 && (
        <Section title="반복된 인식 오류">
          <ul className="flex flex-col gap-1 text-sm">
            {review.recurringRecognitionErrors.map((entry) => (
              <li key={`${entry.from}-${entry.to}`} className="font-korean">
                {entry.from} → <span className="text-[var(--accent)]">{entry.to}</span>
                <span className="ml-2 font-sans text-xs text-[var(--fg-dim)]">
                  ×{entry.occurrences}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {review.scripture.length > 0 && (
        <Section title="인용된 성경 구절">
          <ul className="flex flex-wrap gap-2 text-sm">
            {review.scripture.map((reference) => (
              <li
                key={reference.display}
                className="rounded border border-[var(--line)] px-2 py-1 text-[var(--info)]"
              >
                {reference.display}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {review.adapted.length > 0 && (
        <Section title="직역이 아닌 의역">
          <ul className="flex flex-col gap-2 text-sm">
            {review.adapted.map((chunk) => (
              <li key={chunk.id}>
                <p className="text-[var(--fg)]">{chunk.text}</p>
                {chunk.note && <p className="text-xs text-[var(--fg-dim)]">{chunk.note}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {review.uncertain.length > 0 && (
        <Section title="확실하지 않았던 구간">
          <ul className="flex flex-col gap-1.5 text-sm text-[var(--fg-muted)]">
            {review.uncertain.map((chunk) => (
              <li key={chunk.id}>
                {chunk.text}
                {chunk.note && <span className="ml-2 text-xs text-[var(--fg-dim)]">{chunk.note}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {review.culturalNotes.length > 0 && (
        <Section title="문화적 참고">
          <ul className="flex flex-col gap-2 text-sm">
            {review.culturalNotes.map((note) => (
              <li key={`${note.kind}-${note.korean}`}>
                <span className="font-korean text-[var(--fg)]">{note.korean}</span>
                <span className="ml-2 text-xs uppercase tracking-wider text-[var(--fg-dim)]">
                  {note.kind}
                </span>
                <p className="text-[var(--fg-muted)]">{note.note}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="전체 기록">
        <div className="scroll-y max-h-96 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-3">
          {session.segments.map((segment) => (
            <p key={segment.id} className="font-korean mb-2 text-sm text-[var(--fg-muted)]">
              {segment.text}
            </p>
          ))}
        </div>
      </Section>

      <Section title="재구성된 영어">
        <div className="scroll-y max-h-96 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-3">
          <p className="text-sm leading-relaxed text-[var(--fg)]">
            {session.chunks.map((chunk) => chunk.text).join(" ")}
          </p>
        </div>
      </Section>
    </div>
  );
}
