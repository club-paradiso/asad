"use client";

/**
 * The fork.
 *
 * tong-yuck does two jobs for two different people, and until now the second
 * one was a link inside a collapsed "More" panel on the first one's launcher.
 * The code said as much and then did the opposite: "a different job on the
 * same footing, not a sub-feature", above a `<details>`.
 *
 * They are genuinely different work:
 *
 *   Live interpreting — one person speaks to a room, an interpreter carries
 *   it. The reader is mid-performance and the console is austere for reasons
 *   that are documented at length in globals.css.
 *
 *   Counter Mode — two people face each other across a desk, taking turns.
 *   The reader is a member of staff, and the other reader is a stranger
 *   holding their own phone.
 *
 * So each gets its own route. This screen exists to make that choice in one
 * glance and then get out of the way — every deeper decision (which
 * microphone, which lag, is the model ready) belongs on the route it affects,
 * not here.
 *
 * Korean-primary, unlike the console: both operators are Korean speakers. The
 * console stays English because English is its OUTPUT.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AppConfig } from "@/app/api/config/route";
import { BRAND } from "@/lib/brand";

export function HomeScreen() {
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: AppConfig | null) => {
        if (!cancelled && value) setConfig(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    // Same surface as the launcher it leads to. The two screens are one
    // preparation flow, and the live console is the only thing that stays
    // dark — that is a reading requirement, not a theme preference.
    // The surface paints the whole viewport; the CONTENT is what is centred.
    // Constraining the surface itself let the root dark background show as
    // bars down both edges of a light screen.
    <div data-surface="launcher" className="min-h-[100dvh] w-full">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col gap-8 px-5 py-8 sm:px-8 sm:py-10">
        <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex flex-col gap-1">
            <h1 className="type-display max-w-3xl break-all text-[1.35rem] leading-[1.08] tracking-[-0.025em] text-[var(--fg)] sm:text-[1.7rem]">
              {BRAND.name}
            </h1>
            <p className="text-xs text-[var(--fg-dim)] sm:text-[0.8rem]">
              {BRAND.shortName} · {BRAND.descriptor} · Korean → English
            </p>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <ProviderPill config={config} />
            <Link
              href="/diagnostics"
              className="inline-flex min-h-11 items-center rounded-full border border-[var(--line)] px-3.5 text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--fg)]"
            >
              진단
            </Link>
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

          {/* Equal footing, unequal weight: live interpreting is the primary job,
          and pretending otherwise with two identical tiles would make the
          choice slower rather than fairer. */}
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
                "설치 없음 · 계정 없음 · 기록 남지 않음",
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
              href="/sessions"
              title="지난 세션"
              detail="복기 · 내보내기"
            />
            <SecondaryLink
              href="/diagnostics"
              title="진단"
              detail="제공자 · 할당량 · 저장소"
            />
          </div>
        </div>

        <footer className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-xs text-[var(--fg-dim)]">
          <p>
            세션 중 · <Key>Space</Key> 정지 · <Key>T</Key> 텔레프롬프터 ·{" "}
            <Key>K</Key> 한국어 · <Key>G</Key> 용어 · <Key>+/−</Key> 글자 크기
          </p>
          <p className="ms-auto">대화 내용은 저장되지 않습니다</p>
        </footer>
      </div>
    </div>
  );
}

const Key = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[var(--fg-muted)]">{children}</span>
);

/**
 * What a turn would reach, named.
 *
 * The same disclosure principle the counter applies to visitors: the operator
 * is told which company sees this before they start, not after.
 */
function ProviderPill({ config }: { config: AppConfig | null }) {
  if (!config) return null;
  const ready = config.llm.modelAvailable;
  const colour = ready ? "var(--ok)" : "var(--fg-dim)";

  return (
    <span
      className="inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-xs"
      style={{
        borderColor: `color-mix(in srgb, ${colour} 32%, transparent)`,
        background: `color-mix(in srgb, ${colour} 9%, transparent)`,
        color: ready ? "var(--ok)" : "var(--fg-muted)",
      }}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: colour }}
      />
      {config.llm.configured}
    </span>
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
      {/* Wraps on a phone: pinned right, the badge squeezed the summary into a
          two-word column beside it. */}
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
