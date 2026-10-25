"use client";

import { useEffect, useRef, useState } from "react";
import { classifyInputLevel, rmsOf, type InputLevelReading } from "@/features/live/audio-level";
import {
  InputHealthMonitor,
  NO_INPUT_HEALTH,
  sameInputHealth,
  type InputHealth,
} from "@/features/live/input-health";

export interface StreamLevel {
  reading: InputLevelReading;
  health: InputHealth;
  /** Any non-zero sample has arrived since the stream was attached. */
  samplesSeen: boolean;
  /** A usable level has been observed at least once (latched, like booth preflight). */
  usableSeen: boolean;
  peak: number;
}

const EMPTY: StreamLevel = {
  reading: classifyInputLevel(0),
  health: NO_INPUT_HEALTH,
  samplesSeen: false,
  usableSeen: false,
  peak: 0,
};

/** Analyser updates per second. Enough for a meter; light on an iPhone battery. */
const UPDATE_MS = 100;

/**
 * Measure the ACTUAL level of a MediaStream — the phone's own capture on the
 * iPhone, the received WebRTC track on the MacBook. Numbers only; no audio is
 * kept, recorded or sent anywhere.
 *
 * Uses the same thresholds and the same silence/clipping judgements as the
 * live console and the booth preflight, so all three screens agree.
 */
export function useStreamLevel(stream: MediaStream | null, enabled = true): StreamLevel {
  const [level, setLevel] = useState<StreamLevel>(EMPTY);
  const monitorRef = useRef(new InputHealthMonitor());

  useEffect(() => {
    if (!stream || !enabled) {
      const reset = window.setTimeout(() => setLevel(EMPTY), 0);
      return () => window.clearTimeout(reset);
    }
    const Ctor =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor || stream.getAudioTracks().length === 0) return;

    let cancelled = false;
    const context = new Ctor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    void context.resume().catch(() => {});

    const monitor = monitorRef.current;
    monitor.start();
    const samples = new Float32Array(analyser.fftSize);
    let samplesSeen = false;
    let usableSeen = false;
    let lastHealth: InputHealth = NO_INPUT_HEALTH;
    let lastState = "";

    const timer = window.setInterval(() => {
      if (cancelled) return;
      analyser.getFloatTimeDomainData(samples);
      const rms = rmsOf(samples);
      let peak = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const magnitude = Math.abs(samples[i]);
        if (magnitude > peak) peak = magnitude;
        if (!samplesSeen && magnitude > 0) samplesSeen = true;
      }
      monitor.observe({ rms, peak, at: Date.now() });
      const reading = classifyInputLevel(rms);
      if (reading.state === "good") usableSeen = true;
      const health = monitor.snapshot();
      const changedHealth = !sameInputHealth(lastHealth, health);
      lastHealth = health;
      const key = `${reading.state}:${Math.round(reading.meter * 40)}:${samplesSeen}:${usableSeen}`;
      if (key !== lastState || changedHealth) {
        lastState = key;
        setLevel({ reading, health, samplesSeen, usableSeen, peak });
      }
    }, UPDATE_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
      monitor.reset();
      if (context.state !== "closed") void context.close().catch(() => {});
    };
  }, [stream, enabled]);

  return level;
}
