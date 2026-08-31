"use client";

import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Wordmark } from "@/components/brand/Wordmark";

export function HomeScreen() {
  return (
    <div data-surface="launcher" className="min-h-[100dvh] w-full">
      <div
        className="mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col px-5 sm:px-8 lg:px-10"
        style={{
          paddingTop: "calc(1.5rem + var(--safe-top))",
          paddingBottom: "calc(1.5rem + var(--safe-bottom))",
        }}
      >
        <main className="grid flex-1 items-center gap-10 py-8 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:gap-14 lg:py-12">
          <section className="flex max-w-xl flex-col gap-6 lg:pr-4">
            <Wordmark className="text-[2.15rem] sm:text-[2.8rem] lg:text-[3.25rem]" />

            <p className="max-w-lg text-lg font-medium leading-relaxed tracking-[-0.018em] text-[var(--fg)] sm:text-xl">
              <span className="brand-struck text-[var(--fg-muted)]">정확한 번역</span>{" "}
              아무튼 알아들었으면 된 거 아닌가요.
            </p>

            <div className="hidden items-center gap-3 text-xs text-[var(--fg-dim)] lg:flex">
              <span className="font-semibold text-[var(--fg)]">{BRAND.shortName}</span>
              <span aria-hidden className="h-3 w-px bg-[var(--line-strong)]" />
              <span>{BRAND.descriptor}</span>
            </div>
          </section>

          <section className="flex min-w-0 flex-col gap-7">
            <div>
              <p className="brand-caption mb-3">지금 할 일</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <ModeCard
                  href="/live"
                  title="라이브 통역"
                  who="한 사람이 말하고, 당신이 옮깁니다"
                  detail="설교 · 강연 · 회의"
                  primary
                />
                <ModeCard
                  href="/counter"
                  title="현장 응대"
                  who="창구에서 마주 앉아 주고받습니다"
                  detail="QR · 설치 없음"
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-4">
                <p className="brand-caption">도구</p>
                <span className="text-xs text-[var(--fg-dim)]">시작 전 준비와 기록</span>
              </div>
              <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-raised)] shadow-sm">
                <QuietRow href="/prep" title="준비 시트" detail="설교자 · 본문 · 용어 미리 넣기" />
                <QuietRow
                  href="/booth-preflight"
                  title="부스 사전 점검"
                  detail="믹서 입력 · 신호 레벨 · mix-minus 확인"
                />
                <QuietRow href="/sessions" title="지난 세션" detail="복기 · 내보내기" last />
              </div>
            </div>
          </section>
        </main>

        <footer className="flex flex-col gap-2 border-t border-[var(--line)] pt-4 text-xs leading-relaxed text-[var(--fg-dim)] sm:flex-row sm:items-center sm:justify-between">
          <span className="lg:hidden">
            {BRAND.shortName} · {BRAND.descriptor}
          </span>
          <span>현장 응대 기록은 세션 동안만 임시 보관됩니다</span>
        </footer>
      </div>
    </div>
  );
}

function ModeCard({
  href,
  title,
  who,
  detail,
  primary = false,
}: {
  href: string;
  title: string;
  who: string;
  detail: string;
  primary?: boolean;
}) {
  const palette = primary
    ? "border-[var(--brand-ink)] bg-[var(--brand-ink)] text-[var(--brand-paper)] shadow-md"
    : "border-[var(--line)] bg-[var(--bg-raised)] text-[var(--fg)] shadow-sm";

  return (
    <Link
      href={href}
      className={`group flex min-h-[10.5rem] flex-col justify-between rounded-[1.35rem] border p-5 transition-[transform,box-shadow,border-color,background-color] active:scale-[0.985] sm:min-h-[11.5rem] ${palette} hover:-translate-y-0.5 hover:shadow-lg`}
    >
      <div className="flex items-start justify-between gap-4">
        <span
          className={
            primary
              ? "text-xs font-semibold tracking-wide text-[color-mix(in_srgb,var(--brand-paper)_70%,transparent)]"
              : "text-xs font-semibold tracking-wide text-[var(--fg-dim)]"
          }
        >
          {detail}
        </span>
        <span
          className={
            primary
              ? "grid size-9 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--brand-paper)_12%,transparent)] text-[var(--brand-paper)] transition-transform group-hover:translate-x-0.5"
              : "grid size-9 shrink-0 place-items-center rounded-full bg-[var(--bg-overlay)] text-[var(--fg)] transition-transform group-hover:translate-x-0.5"
          }
        >
          <svg aria-hidden viewBox="0 0 20 20" className="size-4" fill="none">
            <path
              d="M5 10h9M10.5 6.5 14 10l-3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="type-display text-[1.7rem] leading-none sm:text-[1.9rem]">
          {title}
        </span>
        <span
          className={
            primary
              ? "text-sm leading-relaxed text-[color-mix(in_srgb,var(--brand-paper)_72%,transparent)]"
              : "text-sm leading-relaxed text-[var(--fg-muted)]"
          }
        >
          {who}
        </span>
      </div>
    </Link>
  );
}

function QuietRow({
  href,
  title,
  detail,
  last = false,
}: {
  href: string;
  title: string;
  detail: string;
  last?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex min-h-16 items-center gap-4 px-4 py-3.5 transition-colors hover:bg-[var(--accent-dim)] sm:px-5 ${last ? "" : "border-b border-[var(--line)]"}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--fg)]">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-[var(--fg-dim)] sm:text-sm">
          {detail}
        </span>
      </span>
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="size-4 shrink-0 text-[var(--fg-dim)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--fg)]"
        fill="none"
      >
        <path
          d="m7.5 4.5 5.5 5.5-5.5 5.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}
