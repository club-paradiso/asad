"use client";

import { useCallback, useEffect, useState } from "react";

export interface AudioInputOption {
  deviceId: string;
  label: string;
}

/**
 * Enumerate browser-visible audio inputs without opening the microphone.
 *
 * Browsers may hide device labels until microphone permission has been granted;
 * in that case we still expose stable generic labels. Permission is requested
 * only when the interpreter actually starts a live session.
 */
export function useAudioInputs(enabled = true) {
  const [devices, setDevices] = useState<AudioInputOption[]>([]);
  const [supported, setSupported] = useState(true);

  const refresh = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.enumerateDevices
    ) {
      setSupported(false);
      setDevices([]);
      return;
    }

    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const audio = all
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Audio input ${index + 1}`,
        }));
      setSupported(true);
      setDevices(audio);
    } catch {
      setSupported(false);
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const mediaDevices = navigator.mediaDevices;
    mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => mediaDevices?.removeEventListener?.("devicechange", refresh);
  }, [enabled, refresh]);

  return { devices, supported, refresh };
}
