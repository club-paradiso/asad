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
    <header className="flex flex-col gap-5 border-b border-[var(--line)] pb-6">
      <div className="flex items-center gap-3">
        <Link
          href={backHref}
          aria-label={backLabel}
          className="grid size-10 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-[var(--bg-raised)] text-[var(--fg-muted)] shadow-sm transition-[color,background-color,border-color,transform] hover:-translate-x-0.5 hover:border-[var(--line-strong)] hover:text-[var(--fg)]"
        >
          <svg aria-hidden viewBox="0 0 20 20" className="size-4" fill="none">
            <path
              d="M12.5 4.5 7 10l5.5 5.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>

        <Wordmark variant="compact" className="ms-auto text-[var(--fg-dim)]" />
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="type-display text-[1.75rem] leading-tight text-[var(--fg)] sm:text-[2rem]">
          {title}
        </h1>
        {detail ? (
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--fg-muted)] sm:text-[0.9375rem]">
            {detail}
          </p>
        ) : null}
      </div>
    </header>
  );
}
