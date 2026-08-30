"use client";

/**
 * The launcher.
 *
 * What was here: two large bordered cards, each with an icon tile, a badge, a
 * three-item ticked feature list and a full-width blue button — a pricing
 * page. It answered "what does this product do?", which is a question nobody
 * arriving at their own tool is asking. The interpreter opening this thirty
 * seconds before a service is asking "which one, and where is the button".
 *
 * So the feature lists are gone and the two modes are two rows. A row is
 * enough: the mode's name is the largest thing on it, one line says who it is
 * for, and the whole row is the target. Both modes now fit above the fold on
 * a 390pt phone, which the cards never did — the second mode used to start
 * below 1350px of scroll.
 *
 * The brand gets the top third and nothing else. Hero, wordmark and tagline
 * are allowed to be strange up there because no task is running yet; from the
 * mode list down, this is a working screen.
 */
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Wordmark } from "@/components/brand/Wordmark";

export function HomeScreen() {
  return (
    <div data-surface="launcher" className="min-h-[100dvh] w-full">
      <div
        className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col gap-10 px-5 pb-8 sm:px-8"
        style={{
          paddingTop: "calc(2rem + var(--safe-top))",
          paddingBottom: "calc(2rem + var(--safe-bottom))",
        }}
      >
        <header className="flex flex-col gap-5">
          <Wordmark className="text-[1.75rem] sm:text-[2.25rem]" />
          {/* The tagline is set as a correction: the claim gets struck, the
              shrug replaces it. This is the one place on the launcher the
              device appears at full strength — it is the brand statement, and
              there is no task behind it to obstruct. */}
          <p className="type-context max-w-md text-[0.9375rem] leading-relaxed text-[var(--fg-muted)]">
            <span className="brand-struck">정확한 번역</span>{" "}
            <span className="font-semibold text-[var(--fg)]">
              아무튼 알아들었으면 된 거 아닌가요.
            </span>
          </p>
        </header>

        <nav aria-label="모드" className="flex flex-col">
          <p className="brand-caption mb-3">무엇을 하시나요</p>

          <ModeRow
            href="/live"
            title="라이브 통역"
            who="한 사람이 말하고, 당신이 옮깁니다"
            detail="설교 · 강연 · 회의"
            primary
          />
          <ModeRow
            href="/counter"
            title="현장 응대"
            who="창구에서 마주 앉아 주고받습니다"
            detail="QR · 설치 없음"
          />
        </nav>

        <div className="flex flex-col gap-3">
          <p className="brand-caption">그 외</p>
          <div className="flex flex-col">
            <QuietRow href="/prep" title="준비 시트" detail="설교자 · 본문 · 용어 미리 넣기" />
            {/* Added on main while this redesign was in flight. It is a
                pre-session check, so it belongs with the other pre-session
                links rather than beside the two modes — the launcher's top
                half answers "which job", and this is not one. */}
            <QuietRow
              href="/booth-preflight"
              title="부스 사전 점검"
              detail="믹서 입력 · 신호 레벨 · mix-minus 확인"
            />
            <QuietRow href="/sessions" title="지난 세션" detail="복기 · 내보내기" />
          </div>
        </div>

        <p className="mt-auto pt-6 type-context text-[var(--fg-dim)]">
          {BRAND.shortName} · {BRAND.descriptor} · 현장 응대 기록은 세션
          동안만 임시 보관됩니다
        </p>
      </div>
    </div>
  );
}

/**
 * A mode.
 *
 * The whole row is the link, so the target is ~88px tall rather than the
 * 56px of a button inside a card — which matters more than it sounds, because
 * this is pressed one-handed, in a hurry, often in low light.
 *
 * `primary` is carried by weight and a rule, not by a filled button. Two
 * filled CTAs on one screen is two primary actions, which is none.
 */
function ModeRow({
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
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 border-b border-[var(--line)] py-5 first:border-t transition-colors hover:bg-[var(--accent-dim)]"
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span
          className={
            primary
              ? "type-display text-2xl leading-tight text-[var(--fg)] sm:text-[1.75rem]"
              : "type-display text-xl leading-tight text-[var(--fg)] sm:text-2xl"
          }
        >
          {title}
        </span>
        <span className="text-sm leading-snug text-[var(--fg-muted)]">
          {who}
        </span>
        <span className="brand-caption mt-0.5">{detail}</span>
      </span>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="ms-auto size-5 shrink-0 text-[var(--fg-dim)] transition-transform group-hover:translate-x-0.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  );
}

function QuietRow({
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
      className="flex min-h-14 items-center gap-3 border-b border-[var(--line)] py-3 first:border-t transition-colors hover:bg-[var(--accent-dim)]"
    >
      <span className="text-sm font-semibold text-[var(--fg)]">{title}</span>
      <span className="type-context text-[var(--fg-dim)]">{detail}</span>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="ms-auto size-4 shrink-0 text-[var(--fg-dim)]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  );
}
