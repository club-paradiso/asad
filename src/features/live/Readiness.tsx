"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ReadinessLevel = "ready" | "limited" | "blocked";

export interface ReadinessRow {
  label: string;
  value: string;
  level: ReadinessLevel;
  detail?: string;
}

const LEVEL_WORD: Record<ReadinessLevel, string> = {
  ready: "준비됨",
  limited: "제한 있음",
  blocked: "사용 불가",
};

const LEVEL_COLOUR: Record<ReadinessLevel, string> = {
  ready: "var(--ok)",
  limited: "var(--warn)",
  blocked: "var(--danger)",
};

export function isBoothPreflightActionRow(row: ReadinessRow): boolean {
  const inputLabel = row.label === "입력" || row.label === "Input";
  const unverified =
    row.value.includes("사전 점검 안 됨") ||
    row.value.includes("not preflight-verified");

  return inputLabel && row.level === "limited" && unverified;
}

export function Readiness({
  rows,
  demo = false,
  action,
}: {
  rows: ReadinessRow[];
  demo?: boolean;
  action?: ReactNode;
}) {
  const worst: ReadinessLevel = rows.some((row) => row.level === "blocked")
    ? "blocked"
    : rows.some((row) => row.level === "limited")
      ? "limited"
      : "ready";

  return (
    <section
      aria-label="세션 준비 상태"
      className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-raised)] shadow-sm lg:sticky lg:top-8"
    >
      <header className="flex items-start gap-3 border-b border-[var(--line)] px-5 py-5 sm:px-6">
        <span
          aria-hidden
          className="mt-1.5 size-2.5 shrink-0 rounded-full"
          style={{ background: LEVEL_COLOUR[worst] }}
        />
        <div className="min-w-0 flex-1">
          <p className="brand-caption mb-1">세션 준비 상태</p>
          <h2 className="text-base font-semibold tracking-[-0.015em] text-[var(--fg)] sm:text-lg">
            {worst === "ready"
              ? "바로 시작할 수 있어요"
              : worst === "limited"
                ? "시작할 수 있지만 확인할 게 있어요"
                : "시작 전에 해결이 필요해요"}
          </h2>
        </div>
        {demo && (
          <span className="shrink-0 text-xs font-semibold text-[var(--fg-dim)]">
            데모
          </span>
        )}
      </header>

      <dl className="divide-y divide-[var(--line)]">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 px-5 py-4 sm:px-6">
            <dt className="brand-caption pt-0.5">{row.label}</dt>
            <dd className="min-w-0">
              <div className="flex min-w-0 items-start gap-2.5">
                <span
                  aria-hidden
                  className="mt-[0.42rem] size-1.5 shrink-0 rounded-full"
                  style={{ background: LEVEL_COLOUR[row.level] }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span
                      className={cn(
                        "text-sm leading-relaxed sm:text-[0.9375rem]",
                        row.level === "ready" ? "text-[var(--fg)]" : "font-medium",
                      )}
                      style={
                        row.level === "ready"
                          ? undefined
                          : { color: LEVEL_COLOUR[row.level] }
                      }
                    >
                      {row.value}
                    </span>
                    <span className="text-[0.6875rem] font-semibold text-[var(--fg-dim)]">
                      {LEVEL_WORD[row.level]}
                    </span>
                  </div>

                  {row.detail && row.level !== "ready" && (
                    <p className="mt-1.5 text-xs leading-relaxed text-[var(--fg-muted)] sm:text-[0.8125rem]">
                      {row.detail}
                    </p>
                  )}

                  {isBoothPreflightActionRow(row) && (
                    <Link
                      href="/booth-preflight"
                      className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg-overlay)] px-3 text-xs font-semibold text-[var(--fg)] transition-[background-color,border-color,transform] hover:-translate-y-px hover:border-[var(--line-strong)] hover:bg-[var(--accent-dim)] sm:text-sm"
                    >
                      부스 사전 점검 열기
                      <svg aria-hidden viewBox="0 0 20 20" className="size-3.5" fill="none">
                        <path
                          d="M5 10h9M10.5 6.5 14 10l-3.5 3.5"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </Link>
                  )}
                </div>
              </div>
            </dd>
          </div>
        ))}
      </dl>

      {action && <div className="border-t border-[var(--line)] px-5 py-3 sm:px-6">{action}</div>}
    </section>
  );
}
