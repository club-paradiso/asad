/**
 * Local persistence.
 *
 * Two rules, both from docs/privacy.md:
 *  - Settings and the prep sheet are convenience state and persist freely.
 *  - Session transcripts persist ONLY when the interpreter turned on
 *    "Save this session". Nothing is written silently.
 *
 * Everything is wrapped: a private window, disabled site data or a full quota
 * must degrade to "not saved", never to a thrown error mid-service.
 */
import type {
  ConsoleView,
  ContextDomain,
  LagProfile,
  PrepSheet,
  SessionSettings,
  StoredSession,
} from "@/types";
import { CONTEXT_DOMAINS, defaultSettings, emptyPrepSheet } from "@/types";
import { canonicalPair } from "@/languages/registry";

const KEYS = {
  settings: "tong-yuck:settings",
  prep: "tong-yuck:prep",
  sessions: "tong-yuck:sessions",
} as const;

const MAX_STORED_SESSIONS = 30;

function readRaw(key: string): unknown {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function read<T>(key: string, fallback: T): T {
  const value = readRaw(key);
  if (!value || typeof value !== "object") return fallback;
  return { ...fallback, ...(value as T) };
}

function write(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const LAGS: readonly LagProfile[] = ["fast", "balanced", "safe"];
const VIEWS: readonly ConsoleView[] = ["console", "teleprompter"];
const FONT_SCALE_RANGE = { min: 0.7, max: 1.9 } as const;

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

/**
 * Turn whatever is in storage into the current settings shape.
 *
 * The launcher used to ask for a Mode (Sermon / General) and stored it as
 * `mode`; the source pane was `showKorean`. Neither exists any more: the
 * Context Engine infers the domain, so a stored `mode` is simply dropped —
 * `context` starts at `auto` — and `showKorean` becomes `showSource`. Language
 * ids always come back canonical so nothing downstream has to resolve them.
 *
 * Exported so the migration is a unit test rather than a hope.
 */
export function normaliseSettings(raw: unknown): SessionSettings {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== "object") return defaults;
  const record = raw as Record<string, unknown>;

  const pair = canonicalPair({
    source: typeof record.sourceLanguage === "string" ? record.sourceLanguage : undefined,
    target: typeof record.targetLanguage === "string" ? record.targetLanguage : undefined,
  });

  const fontScale =
    typeof record.fontScale === "number" && Number.isFinite(record.fontScale)
      ? Math.min(FONT_SCALE_RANGE.max, Math.max(FONT_SCALE_RANGE.min, record.fontScale))
      : defaults.fontScale;

  return {
    sourceLanguage: pair.source,
    targetLanguage: pair.target,
    context: oneOf<ContextDomain>(record.context, CONTEXT_DOMAINS, defaults.context),
    lag: oneOf<LagProfile>(record.lag, LAGS, defaults.lag),
    view: oneOf<ConsoleView>(record.view, VIEWS, defaults.view),
    showSource: bool(
      record.showSource,
      // The legacy name, honoured once and never written back.
      bool(record.showKorean, defaults.showSource),
    ),
    showGlossary: bool(record.showGlossary, defaults.showGlossary),
    showScripture: bool(record.showScripture, defaults.showScripture),
    fontScale,
    saveHistory: bool(record.saveHistory, defaults.saveHistory),
    rememberCorrections: bool(record.rememberCorrections, defaults.rememberCorrections),
  };
}

export const loadSettings = (): SessionSettings => normaliseSettings(readRaw(KEYS.settings));
export const saveSettings = (settings: SessionSettings): boolean =>
  write(KEYS.settings, normaliseSettings(settings));

export const loadPrep = (): PrepSheet => read(KEYS.prep, emptyPrepSheet());
export const savePrep = (prep: PrepSheet): boolean => write(KEYS.prep, prep);

export function loadSessions(): StoredSession[] {
  const value = readRaw(KEYS.sessions);
  return Array.isArray(value) ? (value as StoredSession[]) : [];
}

/** Persist a finished session. Called only on explicit opt-in. */
export function saveSession(session: StoredSession): boolean {
  const existing = loadSessions().filter((s) => s.id !== session.id);
  const next = [session, ...existing].slice(0, MAX_STORED_SESSIONS);
  return write(KEYS.sessions, next);
}

export function deleteSession(id: string): boolean {
  return write(KEYS.sessions, loadSessions().filter((s) => s.id !== id));
}

export function clearSessions(): boolean {
  return write(KEYS.sessions, []);
}

/* --------------------------------------------------------------------------
 * Reactive stores
 *
 * Components bind to these rather than reading localStorage in an effect, so
 * persisted state hydrates without a cascading render.
 * ------------------------------------------------------------------------ */

import { createLocalStore } from "./local-store";

export const settingsStore = createLocalStore<SessionSettings>({
  read: loadSettings,
  write: saveSettings,
  fallback: defaultSettings(),
});

export const prepStore = createLocalStore<PrepSheet>({
  read: loadPrep,
  write: savePrep,
  fallback: emptyPrepSheet(),
});

export const sessionsStore = createLocalStore<StoredSession[]>({
  read: loadSessions,
  write: (sessions) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(KEYS.sessions, JSON.stringify(sessions));
    } catch {
      // Quota or private mode — the UI already reports "not saved".
    }
  },
  fallback: [],
});

/** Refresh the sessions store from storage after a direct mutation. */
export const refreshSessions = (): void => sessionsStore.set(loadSessions());
