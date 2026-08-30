"use client";

/**
 * Public mode launcher.
 *
 * The home screen stays intentionally simple: pick the job you need and move
 * on. Operator diagnostics, provider status and live-console keyboard hints
 * belong inside the relevant tools, not on the public landing surface.
 */
import Link from "next/link";
import { BRAND } from "@/lib/brand";

export function HomeScreen() {
  return (
    <div data-surface="launcher" className="min-h-[100dvh] w-full">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col gap-8 px-5 py-8 sm:px-8 sm:py-10">
        <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex flex-col gap-1">
            <h1 className="type-display max-w-3xl break-all text-[1.35rem] leading-[1.08] tracking-[-0.025em] text-[var(--fg)] sm:text-[1.7rem]">
              {BRAND.name}
            </h1>
            <p className="text-xs text-[var(--fg-dim)] sm:text-[0.8rem]">
              {BRAND.shortName} · {BRAND.descriptor}
            </p>
          </div>
        </header>

        <div className="my-auto flex flex-col gap-8">
          <div className="flex flex-col gap-1.5">
            <h2 className="type-display text-3xl leading-[1.08] text-[var(--fg)] sm:text-[2.5rem]">
              {BRAND.tagline}
            </h2>
            <p className="text-sm text-[var(--fg-muted)]">
              라이브 통역과 현장 응대 중 지금 필요한 방식만 고르면 됩니다.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <ModeCard
              href="/live"
              tone="accent"
              badge="주 모드"
              title="라이브 통역"
              summary="한 사람이 말하고, 당신이 옮깁니다. 설교 · 강연 · 회의."
              points={[
                "말한 것 · 지금 · 예측을 한 화면에서 구분해 보여줍니다",
                "성경 구절, 용어, 문화적 표현을 자동으로 짚어줍니다",
                "지연 시간을 직접 고르고, 세션은 저장하거나 버립니다",
              ]}
              action="통역 시작"
              icon={
                <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
              }
            />

            <ModeCard
              href="/counter"
              tone="info"
              title="현장 응대"
              summary="창구에서 마주 앉아 주고받습니다."
              points={[
                "QR을 찍으면 손님 폰에서 바로 열립니다",
                "화면 전체가 손님의 모국어로 바뀝니다",
                "설치 없음 · 계정 없음 · 세션 종료 시 삭제",
              ]}
              action="QR 코드 띄우기"
              icon={
                <>
                  <rect x="3" y="3" width="7" height="7" rx="1.4" />
                  <rect x="14" y="3" width="7" height="7" rx="1.4" />
                  <rect x="3" y="14" width="7" height="7" rx="1.4" />
                  <path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20.5v.5" />
                </>
              }
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <SecondaryLink
              href="/prep"
              title="준비 시트"
              detail="설교자 · 본문 · 용어 미리 넣기"
            />
            <SecondaryLink
              href="/booth-preflight"
              title="부스 사전 점검"
              detail="믹서 입력 · 신호 레벨 · mix-minus 확인"
            />
            <SecondaryLink
              href="/sessions"
              title="지난 세션"
              detail="복기 · 내보내기"
            />
          </div>
        </div>

        <footer className="mt-auto pt-4 text-right text-xs text-[var(--fg-dim)]">
          현장 응대 기록은 세션 동안만 임시 보관됩니다
        </footer>
      </div>
    </div>
  );
}

function ModeCard({
  href,
  tone,
  badge,
  title,
  summary,
  points,
  action,
  icon,
}: {
  href: string;
  tone: "accent" | "info";
  badge?: string;
  title: string;
  summary: string;
  points: string[];
  action: string;
  icon: React.ReactNode;
}) {
  const colour = tone === "accent" ? "var(--accent)" : "var(--info)";

  return (
    <Link
      href={href}
      className="group flex flex-col gap-5 rounded-2xl border bg-[var(--bg-raised)] p-6 transition-colors"
      style={{
        borderColor:
          tone === "accent"
            ? "color-mix(in srgb, var(--accent) 34%, transparent)"
            : "var(--line)",
      }}
    >
      <div className="flex flex-wrap items-start gap-x-3.5 gap-y-2">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border"
          style={{
            borderColor: `color-mix(in srgb, ${colour} 32%, transparent)`,
            background: `color-mix(in srgb, ${colour} 13%, transparent)`,
            color: colour,
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {icon}
          </svg>
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="type-display text-xl text-[var(--fg)]">{title}</h3>
          <p className="text-sm leading-relaxed text-[var(--fg-muted)]">
            {summary}
          </p>
        </div>
        {badge && (
          <span
            className="order-first ms-auto shrink-0 rounded-full px-2.5 py-1 text-[0.65rem] font-semibold tracking-wide sm:order-none"
            style={{
              background: `color-mix(in srgb, ${colour} 14%, transparent)`,
              color: colour,
            }}
          >
            {badge}
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-2.5">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-2.5">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="mt-0.5 size-3.5 shrink-0"
              fill="none"
              stroke={colour}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span className="text-sm leading-snug text-[var(--fg-muted)]">
              {point}
            </span>
          </li>
        ))}
      </ul>

      <span
        className="mt-auto inline-flex min-h-14 items-center justify-center gap-2.5 rounded-xl px-5 text-base font-semibold transition-[filter]"
        style={
          tone === "accent"
            ? { background: "var(--accent)", color: "var(--accent-contrast)" }
            : {
                border: `1px solid color-mix(in srgb, ${colour} 45%, transparent)`,
                background: `color-mix(in srgb, ${colour} 10%, transparent)`,
                color: colour,
              }
        }
      >
        {action}
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="size-[1.05rem] transition-transform group-hover:translate-x-0.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </Link>
  );
}

function SecondaryLink({
  href,
  title,
  detail,
}: {
  href: string;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-16 flex-col justify-center gap-0.5 rounded-xl border border-[var(--line)] px-4 py-3 transition-colors hover:border-[var(--line-strong)]"
    >
      <span className="text-sm font-semibold text-[var(--fg)]">{title}</span>
      <span className="text-xs text-[var(--fg-dim)]">{detail}</span>
    </Link>
  );
}
