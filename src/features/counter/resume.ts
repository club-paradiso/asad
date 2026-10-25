"use client";

/**
 * Surviving a page reload.
 *
 * A participant's capability token used to live only in React state. iOS
 * Safari reloads a backgrounded tab whenever it feels like it, a visitor
 * pulls down to refresh out of habit, a desk browser is restarted — and in
 * every case the device came back with no token, so the visitor was refused
 * as "a second person" on their own conversation and the desk could only
 * start a fresh code while the visitor's phone kept polling the old one.
 *
 * `sessionStorage` is the right shelf for this: per tab, gone when the tab
 * closes, never shared with other tabs or sites. What goes on it is the room
 * code, the capability and the chosen language — never a message. The record
 * is removed the moment the conversation ends from this device, or the moment
 * the server says the token is no longer good.
 */

import { useSyncExternalStore } from "react";

const GUEST_PREFIX = "asad:counter:guest:v1:";
const HOST_KEY = "asad:counter:host:v1";
/** Matches the server's idle TTL; anything older cannot still be live. */
const MAX_AGE_MS = 4 * 60 * 60 * 1000;

export interface StoredGuestSession {
  token: string;
  lang: string;
  at: number;
}

export interface StoredHostSession {
  code: string;
  token: string;
  at: number;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function read<T extends { at: number }>(key: string, valid: (value: Partial<T>) => boolean): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<T>;
    if (typeof value.at !== "number" || Date.now() - value.at > MAX_AGE_MS || !valid(value)) {
      store.removeItem(key);
      return null;
    }
    return value as T;
  } catch {
    return null;
  }
}

/**
 * Screens read these through `useSyncExternalStore`, so a write or a clear has
 * to notify, and `read` has to hand back the same reference until something
 * changes — React compares snapshots with `Object.is` on every render.
 */
const listeners = new Set<() => void>();
const snapshots = new Map<string, unknown>();
const notify = () => {
  snapshots.clear();
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
function cached<T>(key: string, read: () => T): T {
  if (snapshots.has(key)) return snapshots.get(key) as T;
  const value = read();
  snapshots.set(key, value);
  return value;
}

function write(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing and managed devices may refuse; the session still works
    // for as long as the tab lives.
  }
  notify();
}

function remove(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing to remove, or nowhere to remove it from.
  }
  notify();
}

export const readGuestResume = (code: string): StoredGuestSession | null =>
  read<StoredGuestSession>(
    `${GUEST_PREFIX}${code}`,
    (value) => typeof value.token === "string" && typeof value.lang === "string",
  );

export const writeGuestResume = (code: string, value: Omit<StoredGuestSession, "at">): void =>
  write(`${GUEST_PREFIX}${code}`, { ...value, at: Date.now() } satisfies StoredGuestSession);

export const clearGuestResume = (code: string): void => remove(`${GUEST_PREFIX}${code}`);

export const readHostResume = (): StoredHostSession | null =>
  read<StoredHostSession>(
    HOST_KEY,
    (value) => typeof value.token === "string" && typeof value.code === "string",
  );

export const writeHostResume = (value: Omit<StoredHostSession, "at">): void =>
  write(HOST_KEY, { ...value, at: Date.now() } satisfies StoredHostSession);

export const clearHostResume = (): void => remove(HOST_KEY);

/** The visitor's stored session for this code, read without a cascading render. */
export function useStoredGuestSession(code: string): StoredGuestSession | null {
  return useSyncExternalStore(
    subscribe,
    () => cached(`guest:${code}`, () => readGuestResume(code)),
    () => null,
  );
}

/** The desk's stored session, read without a cascading render. */
export function useStoredHostSession(): StoredHostSession | null {
  return useSyncExternalStore(subscribe, () => cached("host", readHostResume), () => null);
}
