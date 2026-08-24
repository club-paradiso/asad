"use client";

/**
 * The context rail.
 *
 * Scripture, terminology and cultural notes, in a single horizontally
 * scrolling strip along the bottom of the console. Deliberately shallow: this
 * is a *rail*, not a sidebar. A sidebar competes with the English for
 * horizontal space and for attention, and on an iPhone in landscape there is
 * neither to spare.
 *
 * Ordering is by usefulness under time pressure — a wordplay warning first (it
 * cannot be recovered from once you have said the literal version), then the
 * live Scripture, then terminology.
 */
import { useState } from "react";
import type { BibleReference, CulturalNote, GlossaryItem } from "@/types";
import { Chip, Label } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

export function ContextRail({
  scripture,
  glossary,
  culturalNotes,
  showScripture,
  showGlossary,
  className,
}: {
  scripture: BibleReference[];
  glossary: GlossaryItem[];
  culturalNotes: CulturalNote[];
  showScripture: boolean;
  showGlossary: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const notes = culturalNotes.slice(0, 2);
  const refs = showScripture ? scripture.slice(-2).reverse() : [];
  const terms = showGlossary ? glossary.slice(-6).reverse() : [];

  const empty = notes.length === 0 && refs.length === 0 && terms.length === 0;

  return (
    <div
      className={cn(
        "min-w-0 border-t border-[var(--line)] bg-[var(--bg-raised)]",
        className,
      )}
    >
      <div className="scroll-x flex items-stretch gap-1.5 px-3 py-1.5 sm:px-5 tall:gap-2 tall:py-2">
        {empty && (
          <span className="type-context self-center text-[var(--fg-dim)]">
            Scripture, terminology and cultural notes appear here.
          </span>
        )}

        {notes.map((note) => {
          const key = `note:${note.kind}:${note.korean}`;
          const open = expanded === key;
          return (
            <Chip
              key={key}
              tone="accent"
              onClick={() => setExpanded(open ? null : key)}
              className={cn("max-w-[min(78vw,30rem)]", open && "whitespace-normal")}
              title={note.note}
            >
              <span className="flex items-baseline gap-2">
                <Label className="text-[var(--accent)] opacity-80">
                  {note.kind === "wordplay" ? "wordplay" : note.kind}
                </Label>
                <span className="font-korean">{note.korean}</span>
              </span>
              <span className={cn("mt-0.5 block text-[var(--fg-muted)]", !open && "truncate")}>
                {note.suggestion ? `“${note.suggestion}”` : note.note}
              </span>
              {open && note.suggestion && (
                <span className="mt-1 block text-[var(--fg-dim)]">{note.note}</span>
              )}
            </Chip>
          );
        })}

        {refs.map((reference) => {
          const key = `ref:${reference.display}`;
          const open = expanded === key;
          return (
            <Chip
              key={key}
              tone="info"
              onClick={reference.text ? () => setExpanded(open ? null : key) : undefined}
              className={cn("max-w-[min(78vw,32rem)]", open && "whitespace-normal")}
            >
              <span className="flex items-baseline gap-2">
                <Label className="text-[var(--info)] opacity-80">scripture</Label>
                <span className="font-semibold">{reference.display}</span>
                {reference.confidence !== "high" && (
                  <span className="text-[var(--warn)]" title="Reference not confidently recognised">
                    ?
                  </span>
                )}
              </span>
              {reference.text ? (
                <span className={cn("mt-0.5 block text-[var(--fg-muted)]", !open && "truncate")}>
                  {reference.text}
                  {reference.translation && (
                    <span className="ml-1.5 text-[var(--fg-dim)]">({reference.translation})</span>
                  )}
                </span>
              ) : (
                <span className="mt-0.5 block text-[var(--fg-dim)]">reference only</span>
              )}
            </Chip>
          );
        })}

        {terms.map((term) => (
          <Chip key={`term:${term.korean}`} title={term.note}>
            <span className="flex items-baseline gap-2">
              <span className="font-korean text-[var(--fg)]">{term.korean}</span>
              <span aria-hidden className="text-[var(--fg-dim)]">
                →
              </span>
              <span className="font-medium text-[var(--fg)] uppercase tracking-wide text-[0.9em]">
                {term.english}
              </span>
            </span>
          </Chip>
        ))}
      </div>
    </div>
  );
}
