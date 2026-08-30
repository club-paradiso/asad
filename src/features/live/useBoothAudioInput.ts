"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAudioInputs } from "./useAudioInputs";
import {
  readPreferredBoothAudioDeviceId,
  resolvePreferredBoothAudioDeviceId,
  writePreferredBoothAudioDeviceId,
} from "./booth-audio-preference";

/**
 * Shared physical-input selection for Sermon Mode launch and preflight.
 *
 * The hook never opens the microphone. It only enumerates browser-visible
 * inputs and remembers the operator's choice locally. Consumers still decide
 * when actual capture may begin.
 */
export function useBoothAudioInput(enabled = true) {
  const audioInputs = useAudioInputs(enabled);
  const [deviceId, setDeviceIdState] = useState("");

  useEffect(() => {
    if (!enabled || deviceId || audioInputs.devices.length === 0) return;
    const preferred = readPreferredBoothAudioDeviceId();
    const resolved = resolvePreferredBoothAudioDeviceId(preferred, audioInputs.devices);
    if (resolved) setDeviceIdState(resolved);
  }, [audioInputs.devices, deviceId, enabled]);

  const setDeviceId = useCallback((nextDeviceId: string) => {
    setDeviceIdState(nextDeviceId);
    writePreferredBoothAudioDeviceId(nextDeviceId);
  }, []);

  const selectedLabel = useMemo(
    () =>
      audioInputs.devices.find((device) => device.deviceId === deviceId)?.label ??
      "System default",
    [audioInputs.devices, deviceId],
  );

  return {
    ...audioInputs,
    deviceId,
    selectedLabel,
    setDeviceId,
  };
}
