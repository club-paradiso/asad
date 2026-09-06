/**
 * Keeping E-7 from turning into 7-E.
 *
 * A residence status, a date, an office phone number and the word "HiKorea"
 * are left-to-right no matter what language the sentence around them is. Drop
 * them into an Arabic or Uyghur paragraph as plain text and the Unicode
 * bidirectional algorithm does what it is supposed to do — and what it is
 * supposed to do is reorder them.
 *
 * The damaging case is a phrase, not a token. "D-2 to D-10" is three
 * left-to-right runs with spaces between them; inside an RTL paragraph those
 * spaces resolve right-to-left, the runs are laid out in RTL order, and the
 * visitor reads "D-10 to D-2". Both codes are individually correct. The
 * sentence says the opposite of what was translated, and nobody can see a
 * mistake because there is no mistake in the text — only in the rendering.
 *
 * `<bdi dir="ltr">` fixes it by making each run one opaque unit with its own
 * internal direction. Isolation is applied only inside RTL-rendered text: in
 * an LTR paragraph the algorithm already gets this right, and wrapping there
 * would change nothing except the markup.
 */
import { Fragment, type ReactNode } from "react";

/**
 * A maximal left-to-right run: Latin letters and digits plus the punctuation
 * and spacing that hold a phrase like "D-2 to D-10" or "2026-05-31" together.
 * Trailing separators are excluded by requiring the run to end on a character
 * that carries meaning.
 */
const LTR_RUN_RE =
  /[A-Za-z0-9](?:[A-Za-z0-9 .,:'’#&@_/+()\-‐-―]*[A-Za-z0-9)])?/gu;

/**
 * Runs worth isolating: anything with a Latin letter, or a digit group joined
 * by a separator (a date, a phone number, an office code). A lone number needs
 * no help — the algorithm places a single numeric run correctly on its own.
 */
const WORTH_ISOLATING = /[A-Za-z]|\d[.\-/:‐-―]\d/u;

export type BidiSegment =
  | { kind: "text"; text: string }
  | { kind: "ltr"; text: string };

/** Split text into neutral parts and the left-to-right runs inside it. */
export function segmentLtrRuns(text: string): BidiSegment[] {
  if (!text) return [];
  const segments: BidiSegment[] = [];
  let cursor = 0;

  LTR_RUN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LTR_RUN_RE.exec(text)) !== null) {
    const run = match[0];
    if (!WORTH_ISOLATING.test(run)) continue;
    if (match.index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, match.index) });
    }
    segments.push({ kind: "ltr", text: run });
    cursor = match.index + run.length;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments.length ? segments : [{ kind: "text", text }];
}

/**
 * Text rendered so its left-to-right content survives an RTL paragraph.
 *
 * In LTR context this is the string itself, with no wrapper element, so
 * nothing about the existing rendering changes for the languages that were
 * already correct.
 */
export function BidiText({ text, rtl }: { text: string; rtl: boolean }): ReactNode {
  if (!rtl || !text) return text;
  const segments = segmentLtrRuns(text);
  if (segments.length === 1 && segments[0].kind === "text") return text;

  return segments.map((segment, index) =>
    segment.kind === "ltr" ? (
      <bdi key={index} dir="ltr">
        {segment.text}
      </bdi>
    ) : (
      <Fragment key={index}>{segment.text}</Fragment>
    ),
  );
}
