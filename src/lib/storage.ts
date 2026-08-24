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
import type { PrepSheet, SessionSettings, StoredSession } from "@/types";
import { defaultSettings, emptyPrepSheet } from "@/types";

const KEYS = {
  settings: "tong-yuck:settings",
  prep: "tong-yuck:prep",
  sessions: "tong-yuck:sessions",
} as const;

const MAX_STORED_SESSIONS = 30;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
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

export const loadSettings = (): SessionSettings => read(KEYS.settings, defaultSettings());
export const saveSettings = (settings: SessionSettings): boolean =>
  write(KEYS.settings, settings);

export const loadPrep = (): PrepSheet => read(KEYS.prep, emptyPrepSheet());
export const savePrep = (prep: PrepSheet): boolean => write(KEYS.prep, prep);

export function loadSessions(): StoredSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEYS.sessions);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as StoredSession[]) : [];
  } catch {
    return [];
  }
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
