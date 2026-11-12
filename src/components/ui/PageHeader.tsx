import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";

export function PageHeader({
  title,
  detail,
  backHref = "/",
  backLabel = "홈",
}: {
  title: string;
  detail?: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <header className="relative flex flex-col gap-7 border-b border-[var(--line)] pb-7 sm:gap-9 sm:pb-9">
      <div className="flex items-center justify-between gap-5">
        <Link
          href={backHref}
          aria-label={backLabel}
          className="group inline-flex min-h-11 items-center gap-2.5 rounded-full border border-[var(--line)] bg-[var(--bg-raised)] py-2 pl-3 pr-4 text-xs font-semibold text-[var(--fg-muted)] transition-[color,background-color,border-color] hover:border-[var(--line-strong)] hover:text-[var(--fg)]"
        >
          <svg aria-hidden viewBox="0 0 20 20" className="size-4 transition-transform group-hover:-translate-x-0.5" fill="none">
            <path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{backLabel}으로</span>
        </Link>
        <Link href="/" aria-label="ASAD 홈" className="rounded-md text-[var(--fg-dim)] transition-colors hover:text-[var(--fg)]">
          <Wordmark variant="compact" />
        </Link>
      </div>

      <div>
        <p className="brand-caption mb-3">ASAD / WORKSPACE</p>
        <h1 className="type-display max-w-3xl text-[clamp(1.9rem,4vw,3.1rem)] leading-[1.15] tracking-[-0.055em] text-[var(--fg)]">
          {title}<span className="text-[var(--brand-red)]">.</span>
        </h1>
        {detail ? (
          <p className="mt-3 max-w-2xl text-sm leading-[1.75] text-[var(--fg-muted)] sm:text-[0.9375rem]">
            {detail}
          </p>
        ) : null}
      </div>
    </header>
  );
}
