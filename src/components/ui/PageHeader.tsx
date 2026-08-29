import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";

/**
 * The header every working screen that is not the console shares.
 *
 * Before this, /prep called itself "Prepare", /sessions called itself
 * "Sessions", and both offered a back link labelled "← Console" that returned
 * to a launcher labelled "라이브 통역". Three screens, three vocabularies, and
 * a back button that named a place the user had not been. Naming is navigation:
 * if the launcher calls it 준비 시트, the screen is 준비 시트.
 *
 * The wordmark is here in its compact form so the brand is present on every
 * screen without ever competing with the screen's own title — the mark is
 * 16px and the title is 24.
 */
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
    <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-5">
      <div className="flex items-center gap-3">
        <Link
          href={backHref}
          className="-ms-2 inline-flex min-h-11 items-center gap-1.5 rounded px-2 text-sm text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]"
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
          {backLabel}
        </Link>
        <Wordmark variant="compact" className="ms-auto text-[var(--fg-dim)]" />
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="type-display text-2xl leading-tight text-[var(--fg)]">
          {title}
        </h1>
        {detail ? (
          <p className="max-w-prose text-sm leading-relaxed text-[var(--fg-muted)]">
            {detail}
          </p>
        ) : null}
      </div>
    </header>
  );
}
