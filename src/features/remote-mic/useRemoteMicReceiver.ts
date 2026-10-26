"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { guardedFetch } from "@/lib/session-client";
import { createRemoteMicApi } from "@/remote-mic/client";
import { IDLE_RECEIVER_SNAPSHOT as IDLE, RemoteMicReceiver } from "@/remote-mic/receiver";

/**
 * React binding for the computer end of a Remote Microphone pairing.
 *
 * The receiver is created lazily from the operator's "Pair iPhone" click —
 * never during render or in a mount effect — so React's StrictMode remounts
 * cannot open two pairings or two peer connections. It lives as long as the
 * launcher (and the live console the launcher renders), and is ended on
 * unmount so no peer, track or timer outlives the page.
 */
export function useRemoteMicReceiver() {
  const receiverRef = useRef<RemoteMicReceiver | null>(null);
  const listenersRef = useRef(new Set<() => void>());
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => receiverRef.current?.snapshot() ?? IDLE,
    () => IDLE,
  );

  const ensure = useCallback((): RemoteMicReceiver => {
    if (receiverRef.current) return receiverRef.current;
    const receiver = new RemoteMicReceiver({
      api: createRemoteMicApi({ guardedFetch: (input, init) => guardedFetch(input, init) }),
      origin: window.location.origin,
    });
    receiverRef.current = receiver;
    unsubscribeRef.current = receiver.subscribe(() => {
      for (const listener of listenersRef.current) listener();
    });
    return receiver;
  }, []);

  useEffect(
    () => () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      receiverRef.current?.dispose();
      receiverRef.current = null;
    },
    [],
  );

  // Diagnostics for automated checks: counts and phases only, never media or
  // credentials.
  useEffect(() => {
    (window as unknown as { __asadRemoteMic?: unknown }).__asadRemoteMic = {
      phase: snapshot.phase,
      liveTracks: snapshot.liveTracks,
      trackMuted: snapshot.trackMuted,
      stats: snapshot.stats,
      metrics: snapshot.metrics,
      transport: snapshot.transport,
    };
  }, [snapshot]);

  return {
    state: snapshot,
    pair: useCallback(() => void ensure().pair(), [ensure]),
    approve: useCallback(() => void receiverRef.current?.approve(), []),
    reject: useCallback(() => void receiverRef.current?.reject(), []),
    end: useCallback(() => void receiverRef.current?.end(), []),
    /** Stable getter for the live session; reads the CURRENT stream on every open. */
    currentStream: useCallback(() => receiverRef.current?.currentStream() ?? null, []),
  };
}

export type RemoteMicReceiverHandle = ReturnType<typeof useRemoteMicReceiver>;
