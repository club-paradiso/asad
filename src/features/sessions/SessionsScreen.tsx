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
import { SessionSummary } from "./SessionSummary";

export function SessionsScreen() {
  const [sessions] = useLocalStore(sessionsStore);
  const [selected, setSelected] = useState<StoredSession | null>(null);

  if (selected) {
    return <SessionSummary session={selected} onClose={() => setSelected(null)} />;
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col gap-5 px-5 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Stored in this browser only. Never uploaded, and audio is never kept.
          </p>
        </div>
        <Link href="/" className="text-sm text-[var(--fg-muted)] underline-offset-4 hover:underline">
          ← Console
        </Link>
      </header>

      {sessions.length === 0 ? (
        <p className="rounded-md border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-6 text-sm text-[var(--fg-dim)]">
          No saved sessions. Turn on <strong className="text-[var(--fg-muted)]">Save this
          session</strong> in the live console settings before you finish, and it will appear here.
        </p>
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
                    {session.title || "Untitled session"}
                  </p>
                  <p className="text-xs text-[var(--fg-dim)]">
                    {new Date(session.startedAt).toLocaleString()} · {session.mode} ·{" "}
                    {session.segments.length} segments
                  </p>
                </div>
                <Button size="sm" onClick={() => setSelected(session)}>
                  Review
                </Button>
                <Button size="sm" tone="quiet" onClick={() => downloadSession(session, "markdown")}>
                  Export
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
                  Delete
                </Button>
              </li>
            ))}
          </ul>

          <div className="mt-2 flex flex-col gap-2 border-t border-[var(--line)] pt-4">
            <Label>Danger zone</Label>
            <Button
              tone="danger"
              className="self-start"
              onClick={() => {
                clearSessions();
                refreshSessions();
              }}
            >
              Delete all saved sessions
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
