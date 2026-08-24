/**
 * A tiny observable store over `localStorage`.
 *
 * Reading persisted state in an effect and calling `setState` causes a
 * cascading render on every mount, and React now rightly flags it. This
 * instead exposes a `useSyncExternalStore`-compatible source: the snapshot is
 * cached so it is referentially stable, hydration reads the server snapshot,
 * and a write notifies every subscriber.
 *
 * Persistence itself is best-effort — see `src/lib/storage.ts` for why.
 */
import { useCallback, useSyncExternalStore } from "react";

export interface LocalStore<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
  /** The value used during SSR and the first hydration pass. */
  serverValue: T;
}

export function createLocalStore<T>(options: {
  read: () => T;
  write: (value: T) => void;
  fallback: T;
}): LocalStore<T> {
  const listeners = new Set<() => void>();
  let cache: T | null = null;
  let hydrated = false;

  return {
    serverValue: options.fallback,
    get() {
      if (typeof window === "undefined") return options.fallback;
      if (!hydrated) {
        cache = options.read();
        hydrated = true;
      }
      return cache as T;
    },
    set(value: T) {
      cache = value;
      hydrated = true;
      options.write(value);
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Bind a store to a component. */
export function useLocalStore<T>(store: LocalStore<T>): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    store.subscribe,
    () => store.get(),
    () => store.serverValue,
  );
  const set = useCallback((next: T) => store.set(next), [store]);
  return [value, set];
}
