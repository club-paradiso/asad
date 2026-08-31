"use client";

/**
 * Saved sessions.
 *
 * Only sessions where the interpreter turned on "Save this session" appear
 * here. Everything is in this browser's local storage and nothing is uploaded
 * — which also means clearing site data deletes it permanently, and the screen
 * says so rather than implying a backup exists.
 */
import { useState } from "react";
import Link from "next/link";
import type { StoredSession } from "@/types";
import { clearSessions, deleteSession, refreshSessions, sessionsStore } from "@/lib/storage";
import { useLocalStore } from "@/lib/local-store";
import { downloadSession } from "@/lib/export";
import { Button, Label } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/PageHeader";
import { StateBlock } from "@/components/ui/states";
import { SessionSummary } from "./SessionSummary";

export function SessionsScreen() {
  const [sessions] = useLocalStore(sessionsStore);
  const [selected, setSelected] = useState<StoredSession | null>(null);

  if (selected) {
    return <SessionSummary session={selected} onClose={() => setSelected(null)} />;
  }

  return (
    <div data-surface="launcher" className="min-h-[100dvh] w-full">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col gap-6 px-5 py-8">
      <PageHeader
        title="지난 세션"
        detail="이 브라우저에만 저장됩니다. 업로드하지 않고, 음성은 아예 남기지 않습니다."
      />

      {sessions.length === 0 ? (
        /* The empty state is the one screen here nobody is mid-task on, so it
           is where the brand gets to speak. It also has to do a job the old
           paragraph did badly: say the ONE thing that would have put a session
           in this list, and link to where that switch lives. */
        <StateBlock
          title="아직 저장된 세션이 없어요."
          detail="통역을 끝내기 전에 콘솔 설정에서 '이 세션 저장'을 켜두면 여기에 남습니다."
          action={
            <Link
              href="/live"
              className="inline-flex min-h-11 items-center rounded-md border border-[var(--line-strong)] px-4 text-sm font-semibold text-[var(--fg)] transition-colors hover:bg-[var(--accent-dim)]"
            >
              통역 시작하러 가기
            </Link>
          }
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {session.title || "제목 없는 세션"}
                  </p>
                  <p className="brand-caption mt-0.5 normal-case">
                    {new Date(session.startedAt).toLocaleString("ko-KR")} ·{" "}
                    {session.mode === "sermon" ? "설교" : "일반"} ·{" "}
                    {session.segments.length}구절
                  </p>
                </div>
                <Button size="sm" onClick={() => setSelected(session)}>
                  복기
                </Button>
                <Button size="sm" tone="quiet" onClick={() => downloadSession(session, "markdown")}>
                  내보내기
                </Button>
                <Button
                  size="sm"
                  tone="quiet"
                  className="text-[var(--danger)]"
                  onClick={() => {
                    deleteSession(session.id);
                    refreshSessions();
                  }}
                >
                  삭제
                </Button>
              </li>
            ))}
          </ul>

          <div className="mt-2 flex flex-col gap-2 border-t border-[var(--line)] pt-4">
            <Label>되돌릴 수 없는 작업</Label>
            <Button
              tone="danger"
              className="self-start"
              onClick={() => {
                clearSessions();
                refreshSessions();
              }}
            >
              저장된 세션 전부 삭제
            </Button>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
