/**
 * Session export.
 *
 * Three formats because they serve three different people: TXT for someone
 * who just wants the words, Markdown for a written record, JSON for anything
 * programmatic (re-import, evaluation, a future analytics pass).
 *
 * Audio is never exported, because it is never retained. See docs/privacy.md.
 */
import type { StoredSession } from "@/types";

export type ExportFormat = "txt" | "markdown" | "json";

const stamp = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

const header = (session: StoredSession): string[] => {
  const started = new Date(session.startedAt);
  const durationMs = (session.endedAt ?? session.startedAt) - session.startedAt;
  return [
    session.title || "tong-yuck session",
    session.speaker ? `Speaker: ${session.speaker}` : "",
    `Mode: ${session.mode}`,
    `Date: ${started.toISOString()}`,
    `Duration: ${stamp(durationMs)}`,
  ].filter(Boolean);
};

export function toPlainText(session: StoredSession): string {
  const lines = [...header(session), "", "— KOREAN TRANSCRIPT —", ""];

  for (const segment of session.segments) {
    lines.push(`[${stamp(segment.at)}] ${segment.text}`);
  }

  lines.push("", "— INTERPRETER ENGLISH —", "");
  for (const chunk of session.chunks) {
    const marks = [chunk.adapted ? "(adapted)" : "", chunk.confidence === "low" ? "(?)" : ""]
      .filter(Boolean)
      .join(" ");
    lines.push(`[${stamp(chunk.at)}] ${chunk.text}${marks ? ` ${marks}` : ""}`);
  }

  if (session.scripture.length) {
    lines.push("", "— SCRIPTURE —", "");
    for (const ref of session.scripture) {
      lines.push(ref.text ? `${ref.display} — ${ref.text}` : ref.display);
    }
  }

  if (session.glossary.length) {
    lines.push("", "— TERMINOLOGY —", "");
    for (const term of session.glossary) {
      lines.push(`${term.korean} → ${term.english}${term.note ? ` (${term.note})` : ""}`);
    }
  }

  if (session.culturalNotes.length) {
    lines.push("", "— CULTURAL NOTES —", "");
    for (const note of session.culturalNotes) {
      lines.push(`[${note.kind}] ${note.korean}: ${note.note}`);
    }
  }

  if (session.corrections.length) {
    lines.push("", "— CORRECTIONS —", "");
    for (const correction of session.corrections) {
      lines.push(
        `${correction.from} → ${correction.to}${correction.english ? ` (${correction.english})` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

export function toMarkdown(session: StoredSession): string {
  const [title, ...meta] = header(session);
  const lines = [`# ${title}`, "", ...meta.map((line) => `- ${line}`), ""];

  lines.push("## Interpreter English", "");
  lines.push("| Time | English | Notes |", "| --- | --- | --- |");
  for (const chunk of session.chunks) {
    const notes = [
      chunk.adapted ? "adapted" : "",
      chunk.confidence === "low" ? "low confidence" : "",
      chunk.correctsChunkId ? "correction" : "",
      chunk.note ?? "",
    ]
      .filter(Boolean)
      .join("; ");
    lines.push(`| ${stamp(chunk.at)} | ${escapeCell(chunk.text)} | ${escapeCell(notes)} |`);
  }

  lines.push("", "## Korean transcript", "");
  for (const segment of session.segments) {
    lines.push(`**${stamp(segment.at)}** ${segment.text}`, "");
  }

  if (session.scripture.length) {
    lines.push("## Scripture", "");
    for (const ref of session.scripture) {
      lines.push(ref.text ? `- **${ref.display}** — ${ref.text}` : `- **${ref.display}**`);
    }
    lines.push("");
  }

  if (session.glossary.length) {
    lines.push("## Terminology", "", "| Korean | English | Note |", "| --- | --- | --- |");
    for (const term of session.glossary) {
      lines.push(`| ${term.korean} | ${term.english} | ${escapeCell(term.note ?? "")} |`);
    }
    lines.push("");
  }

  if (session.culturalNotes.length) {
    lines.push("## Cultural notes", "");
    for (const note of session.culturalNotes) {
      lines.push(`- **${note.korean}** _(${note.kind})_ — ${note.note}`);
      if (note.suggestion) lines.push(`  - Suggested: “${note.suggestion}”`);
    }
    lines.push("");
  }

  if (session.corrections.length) {
    lines.push("## Corrections", "");
    for (const correction of session.corrections) {
      lines.push(
        `- ${correction.from} → **${correction.to}**${correction.english ? ` (${correction.english})` : ""}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

const escapeCell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function toJson(session: StoredSession): string {
  return JSON.stringify(session, null, 2);
}

export function serialiseSession(session: StoredSession, format: ExportFormat): string {
  switch (format) {
    case "txt":
      return toPlainText(session);
    case "markdown":
      return toMarkdown(session);
    case "json":
      return toJson(session);
  }
}

const EXTENSION: Record<ExportFormat, string> = { txt: "txt", markdown: "md", json: "json" };
const MIME: Record<ExportFormat, string> = {
  txt: "text/plain;charset=utf-8",
  markdown: "text/markdown;charset=utf-8",
  json: "application/json;charset=utf-8",
};

export function sessionFilename(session: StoredSession, format: ExportFormat): string {
  const date = new Date(session.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const slug = (session.title || "session")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `tong-yuck-${date}-${slug || "session"}.${EXTENSION[format]}`;
}

/** Trigger a download in the browser. No-op on the server. */
export function downloadSession(session: StoredSession, format: ExportFormat): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([serialiseSession(session, format)], { type: MIME[format] });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = sessionFilename(session, format);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
