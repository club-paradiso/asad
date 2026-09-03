"use client";

import { useState } from "react";
import type { GlossaryItem } from "@/types";
import { Button, Label, TextInput } from "@/components/ui/primitives";

export const PREP_GLOSSARY_NOTE_MAX_LENGTH = 160;

export function makePrepGlossaryItem(
  korean: string,
  english: string,
  note?: string,
): GlossaryItem | null {
  const cleanKorean = korean.trim();
  const cleanEnglish = english.trim();
  const cleanNote = note?.trim();
  if (
    !cleanKorean ||
    !cleanEnglish ||
    (cleanNote?.length ?? 0) > PREP_GLOSSARY_NOTE_MAX_LENGTH
  ) return null;
  return {
    korean: cleanKorean,
    english: cleanEnglish,
    ...(cleanNote ? { note: cleanNote } : {}),
    source: "prep",
  };
}

/**
 * Session prep is the highest-priority terminology layer. A human override must
 * therefore replace both the term currently being edited and any existing term
 * with the same Korean headword, rather than leaving ambiguous duplicates.
 */
export function upsertPrepGlossaryItem(
  items: readonly GlossaryItem[],
  next: GlossaryItem,
  replacingKorean?: string,
): GlossaryItem[] {
  return [
    { ...next, source: "prep" },
    ...items.filter(
      (item) => item.korean !== next.korean && item.korean !== replacingKorean,
    ),
  ];
}

export function removePrepGlossaryItem(
  items: readonly GlossaryItem[],
  korean: string,
): GlossaryItem[] {
  return items.filter((item) => item.korean !== korean);
}

export function SessionGlossaryEditor({
  items,
  onChange,
}: {
  items: GlossaryItem[];
  onChange: (items: GlossaryItem[]) => void;
}) {
  const [korean, setKorean] = useState("");
  const [english, setEnglish] = useState("");
  const [note, setNote] = useState("");
  const [editingKorean, setEditingKorean] = useState<string | null>(null);

  const reset = () => {
    setKorean("");
    setEnglish("");
    setNote("");
    setEditingKorean(null);
  };

  const save = () => {
    const next = makePrepGlossaryItem(korean, english, note);
    if (!next) return;
    onChange(upsertPrepGlossaryItem(items, next, editingKorean ?? undefined));
    reset();
  };

  const edit = (item: GlossaryItem) => {
    setKorean(item.korean);
    setEnglish(item.english);
    setNote(item.note ?? "");
    setEditingKorean(item.korean);
  };

  const remove = (item: GlossaryItem) => {
    onChange(removePrepGlossaryItem(items, item.korean));
    if (editingKorean === item.korean) reset();
  };

  const valid =
    !!korean.trim() &&
    !!english.trim() &&
    note.trim().length <= PREP_GLOSSARY_NOTE_MAX_LENGTH;

  return (
    <section className="flex flex-col gap-3 border-t border-[var(--line)] pt-5">
      <div>
        <Label>Session terminology ({items.length})</Label>
        <p className="mt-1 text-xs leading-relaxed text-[var(--fg-muted)]">
          Add or override the wording you want for this session. Prep choices take priority over built-in and community glossary entries.
        </p>
      </div>

      <div className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] p-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--fg-dim)]">Korean term</span>
          <TextInput
            korean
            value={korean}
            onChange={setKorean}
            placeholder="성령의 충만"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--fg-dim)]">Preferred English</span>
          <TextInput
            value={english}
            onChange={setEnglish}
            placeholder="the fullness of the Holy Spirit"
          />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-[var(--fg-dim)]">Interpreter note · optional</span>
          <TextInput
            value={note}
            onChange={setNote}
            maxLength={PREP_GLOSSARY_NOTE_MAX_LENGTH}
            placeholder="Use this wording throughout today's sermon"
          />
          <span className="text-[0.6875rem] text-[var(--fg-dim)]">
            {note.length}/{PREP_GLOSSARY_NOTE_MAX_LENGTH}
          </span>
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button size="sm" tone="neutral" type="button" disabled={!valid} onClick={save}>
            {editingKorean ? "Save override" : "Add term"}
          </Button>
          {editingKorean && (
            <Button size="sm" tone="quiet" type="button" onClick={reset}>
              Cancel edit
            </Button>
          )}
        </div>
      </div>

      {items.length > 0 ? (
        <ul className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">
          {items.map((item) => (
            <li key={item.korean} className="flex flex-wrap items-start gap-3 px-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-relaxed">
                  <span className="font-korean font-medium text-[var(--fg)]">{item.korean}</span>
                  <span className="mx-2 text-[var(--fg-dim)]">→</span>
                  <span>{item.english}</span>
                </p>
                {item.note && (
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--fg-dim)]">{item.note}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" tone="quiet" type="button" onClick={() => edit(item)}>
                  Edit
                </Button>
                <Button size="sm" tone="quiet" type="button" onClick={() => remove(item)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[var(--fg-dim)]">
          No session-specific terms yet. The built-in sermon glossary still works normally.
        </p>
      )}

      {items.length > 0 && (
        <Button
          size="sm"
          tone="quiet"
          type="button"
          onClick={() => {
            onChange([]);
            reset();
          }}
          className="self-start"
        >
          Clear session terminology
        </Button>
      )}
    </section>
  );
}
