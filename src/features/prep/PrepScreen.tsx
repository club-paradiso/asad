"use client";

/**
 * Prep mode.
 *
 * Optional by design — the console starts without any of this. What it buys
 * you when you do fill it in: the speaker's name is romanised once and stays
 * consistent, terminology hints go to the recogniser so proper nouns survive,
 * and the interpretation model starts the session already knowing what it is
 * listening to.
 *
 * Document ingestion (PDF/DOCX/PPTX) is deliberately out of scope for the MVP:
 * pasting an outline covers the same ground and nothing in the live path
 * should wait on a parser.
 */
import { useCallback, useState } from "react";
import Link from "next/link";
import type { GlossaryItem, PrepBrief, PrepSheet } from "@/types";
import { loadSettings, prepStore } from "@/lib/storage";
import { useLocalStore } from "@/lib/local-store";
import { guardedFetch, useSessionToken } from "@/lib/session-client";
import { romaniseName } from "@/lib/romanise";
import { localPrepBrief } from "@/interpreter/prep/local-brief";
import { PrivacyDisclosure } from "@/features/live/PrivacyDisclosure";
import { Button, Field, Label, TextArea, TextInput } from "@/components/ui/primitives";
import { SessionGlossaryEditor } from "./SessionGlossaryEditor";
import { usePrepCloudConsent } from "./usePrepCloudConsent";
import { freshPrepSheet, hasPrepContent } from "./prep-reset";

export function PrepScreen() {
  // The cloud brief route is guarded. Minting a session token sends no Prep
  // content and does not authorise an AI provider; the disclosure below is the
  // separate authority on whether the actual prep material may leave.
  useSessionToken();

  const [prep, setPrep] = useLocalStore(prepStore);
  const [brief, setBrief] = useState<PrepBrief | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [buildRequested, setBuildRequested] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const consent = usePrepCloudConsent();

  const patch = useCallback(
    (next: Partial<PrepSheet>) => {
      setPrep({ ...prep, ...next });
      setSaved(true);
    },
    [prep, setPrep],
  );

  const currentInput = useCallback(
    () => ({
      mode: loadSettings().mode,
      speaker: prep.speaker,
      title: prep.title,
      organisation: prep.organisation,
      scripture: prep.scripture,
      notes: prep.notes,
      outline: prep.outline,
    }),
    [prep],
  );

  const applyBrief = useCallback(
    (nextBrief: PrepBrief, reason?: string) => {
      setBrief(nextBrief);
      setNotice(reason ?? null);
      setStatus("done");

      // The brief populates live session context, which is the whole point of
      // preparing: terminology and names carry straight into the console.
      // Existing Prep terms win here, so a human override is never overwritten
      // merely because the AI brief was regenerated.
      const merged = mergeGlossary(prep.glossary, nextBrief.keyTerms);
      patch({
        glossary: merged,
        entities: [
          ...prep.entities.filter(
            (existing) =>
              !nextBrief.properNouns.some((noun) => noun.korean === existing.korean),
          ),
          ...nextBrief.properNouns,
        ],
      });
    },
    [patch, prep.entities, prep.glossary],
  );

  /** Cloud path. Call only after the Prep consent state has authorised it. */
  const generateCloud = useCallback(async () => {
    setStatus("loading");
    setNotice(null);
    try {
      const response = await guardedFetch("/api/prep", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(currentInput()),
      });
      if (!response.ok) throw new Error(`Request failed (${response.status}).`);

      const data = (await response.json()) as {
        brief: PrepBrief;
        degraded?: boolean;
        reason?: string;
      };
      applyBrief(data.brief, data.reason);
    } catch (error) {
      setStatus("error");
      setNotice(error instanceof Error ? error.message : "Could not build the brief.");
    }
  }, [applyBrief, currentInput]);

  /**
   * Real local-only path: no /api/prep request and no AI provider. The same
   * deterministic engine used by the server fallback runs in this browser.
   */
  const generateLocal = useCallback(() => {
    setStatus("loading");
    setNotice(null);
    try {
      const nextBrief = localPrepBrief(currentInput(), { localOnly: true });
      applyBrief(nextBrief, "Built locally — no prep content was sent to an AI provider.");
    } catch (error) {
      setStatus("error");
      setNotice(
        error instanceof Error ? error.message : "Could not build the local-only brief.",
      );
    }
  }, [applyBrief, currentInput]);

  const requestGenerate = () => {
    if (status === "loading" || consent.phase === "checking") return;

    if (consent.phase === "needed") {
      setBuildRequested(true);
      return;
    }

    // A declined decision belongs to this page visit. Likewise, when config
    // explicitly says there is no model, there is no benefit in shipping the
    // outline to our own API merely to get the same deterministic result back.
    if (consent.phase === "declined" || consent.modelAvailable === false) {
      generateLocal();
      return;
    }

    if (consent.mayUseCloud) void generateCloud();
  };

  const resetPrep = () => {
    setPrep(freshPrepSheet());
    setBrief(null);
    setStatus("idle");
    setBuildRequested(false);
    setResetArmed(false);
    setSaved(false);
    setNotice(
      "Fresh Prep sheet started. Previous speaker, outline, terminology and generated context were cleared from Prep.",
    );
  };

  return (
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col gap-6 px-5 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Prepare</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            All optional. Anything you enter carries into the live session.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {hasPrepContent(prep) && !resetArmed && (
            <Button size="sm" tone="quiet" type="button" onClick={() => setResetArmed(true)}>
              Start fresh
            </Button>
          )}
          <Link href="/" className="text-sm text-[var(--fg-muted)] underline-offset-4 hover:underline">
            ← Home
          </Link>
        </div>
      </header>

      {resetArmed && (
        <section
          role="alert"
          className="rounded-lg border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_7%,transparent)] px-4 py-3"
        >
          <p className="text-sm font-semibold text-[var(--fg)]">Clear this Prep sheet?</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--fg-muted)]">
            This removes the current speaker, title, Scripture, notes, outline, session terminology and Prep entities from this browser. App settings and saved past sessions are not touched.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" tone="neutral" type="button" onClick={resetPrep}>
              Confirm clear prep
            </Button>
            <Button size="sm" tone="quiet" type="button" onClick={() => setResetArmed(false)}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Speaker"
          hint={prep.speaker ? `English: ${romaniseName(prep.speaker)}` : "Korean name"}
        >
          <TextInput
            korean
            value={prep.speaker ?? ""}
            onChange={(speaker) => patch({ speaker })}
            placeholder="류정길"
          />
        </Field>

        <Field label="Church / organisation">
          <TextInput
            korean
            value={prep.organisation ?? ""}
            onChange={(organisation) => patch({ organisation })}
            placeholder="새길교회"
          />
        </Field>

        <Field label="Title">
          <TextInput
            value={prep.title ?? ""}
            onChange={(title) => patch({ title })}
            placeholder="Our Identity in Christ"
          />
        </Field>

        <Field label="Main passage" hint="English reference, e.g. 1 Peter 2:9">
          <TextInput
            value={prep.scripture ?? ""}
            onChange={(scripture) => patch({ scripture })}
            placeholder="1 Peter 2:9"
          />
        </Field>
      </div>

      <Field label="Notes" hint="Anything you want the engine to know going in.">
        <TextArea
          value={prep.notes ?? ""}
          onChange={(notes) => patch({ notes })}
          placeholder="Visiting preacher. Uses a lot of illustrations from his army days."
          rows={3}
        />
      </Field>

      <Field label="Outline or script" hint="Paste whatever you were given.">
        <TextArea
          korean
          value={prep.outline ?? ""}
          onChange={(outline) => patch({ outline })}
          placeholder="1. 우리는 누구인가&#10;2. 택하신 족속&#10;3. 부르심에 응답하는 삶"
          rows={6}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          tone="primary"
          onClick={requestGenerate}
          disabled={status === "loading" || consent.phase === "checking"}
        >
          {consent.phase === "checking"
            ? "Checking privacy settings…"
            : status === "loading"
              ? "Building brief…"
              : consent.phase === "declined" || consent.modelAvailable === false
                ? "Build local-only brief"
                : "Build interpretation brief"}
        </Button>
        {saved && <span className="text-xs text-[var(--fg-dim)]">Saved to this browser</span>}
      </div>

      {notice && (
        <p className="rounded-md border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-3 py-2 text-xs leading-relaxed text-[var(--warn)]">
          {notice}
        </p>
      )}

      {brief && <BriefView brief={brief} />}

      <SessionGlossaryEditor
        items={prep.glossary}
        onChange={(glossary) => patch({ glossary })}
      />

      {buildRequested && consent.phase === "needed" && (
        <PrivacyDisclosure
          context="prep"
          providers={consent.providers}
          onAccept={() => {
            // Do not wait for the state update: accepting this dialog is the
            // authorisation event for this specific request.
            consent.grant();
            setBuildRequested(false);
            void generateCloud();
          }}
          onUseLocalOnly={() => {
            consent.decline();
            setBuildRequested(false);
            generateLocal();
          }}
        />
      )}
    </div>
  );
}

function BriefView({ brief }: { brief: PrepBrief }) {
  return (
    <div className="flex flex-col gap-5 border-t border-[var(--line)] pt-5">
      <section>
        <Label>Overview</Label>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--fg-muted)]">{brief.overview}</p>
      </section>

      {brief.likelyStructure.length > 0 && (
        <section>
          <Label>Likely structure</Label>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-[var(--fg-muted)]">
            {brief.likelyStructure.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      )}

      {brief.scripture.length > 0 && (
        <section>
          <Label>Scripture</Label>
          <ul className="mt-1.5 flex flex-wrap gap-2 text-sm">
            {brief.scripture.map((reference) => (
              <li
                key={reference.display}
                className="rounded border border-[var(--line)] px-2 py-1 text-[var(--info)]"
              >
                {reference.display}
              </li>
            ))}
          </ul>
        </section>
      )}

      {brief.keyTerms.length > 0 && (
        <section>
          <Label>Key terms</Label>
          <ul className="mt-1.5 grid gap-1.5 text-sm sm:grid-cols-2">
            {brief.keyTerms.map((term) => (
              <li key={term.korean} className="flex flex-wrap items-baseline gap-2">
                <span className="font-korean text-[var(--fg)]">{term.korean}</span>
                <span aria-hidden className="text-[var(--fg-dim)]">
                  →
                </span>
                <span>{term.english}</span>
                {term.note && <span className="text-xs text-[var(--fg-dim)]">{term.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {brief.properNouns.length > 0 && (
        <section>
          <Label>Proper nouns · pronunciation</Label>
          <ul className="mt-1.5 space-y-1 text-sm">
            {brief.properNouns.map((noun) => (
              <li key={noun.korean}>
                <span className="font-korean">{noun.korean}</span>
                <span className="mx-2 text-[var(--fg-dim)]">→</span>
                <span className="text-[var(--fg)]">{noun.english}</span>
                {noun.note && <span className="ml-2 text-xs text-[var(--fg-dim)]">{noun.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {brief.difficultPoints.length > 0 && (
        <section>
          <Label>Difficult interpretation points</Label>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-[var(--fg-muted)]">
            {brief.difficultPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>
      )}

      {brief.anticipatedPhrases.length > 0 && (
        <section>
          <Label>Anticipated phrases</Label>
          <ul className="mt-1.5 space-y-1.5 text-sm">
            {brief.anticipatedPhrases.map((phrase) => (
              <li key={phrase.korean}>
                <p className="font-korean text-[var(--fg-muted)]">{phrase.korean}</p>
                <p className="text-[var(--fg)]">{phrase.english}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function mergeGlossary(existing: GlossaryItem[], incoming: GlossaryItem[]): GlossaryItem[] {
  const seen = new Map(existing.map((item) => [item.korean, item]));
  for (const item of incoming) {
    if (!seen.has(item.korean)) seen.set(item.korean, { ...item, source: "prep" });
  }
  return [...seen.values()];
}
