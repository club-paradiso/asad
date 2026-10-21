"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCapability } from "@/hooks/useCapability";
import { guardedFetch } from "@/lib/session-client";
import { getAudioSessionState, setAudioSessionMode, testToneWav } from "./audio-routing";
import { MAX_EARBUD_AUDIO_BACKLOG } from "./speakable";

export type EarbudPlaybackMode = "browser" | "gemini";
type AudioStatus = "unavailable" | "idle" | "preparing" | "speaking" | "error";
interface PendingSpeech { text: string; queuedAt: number }
const STALE_AFTER_MS = 8_000;
const BROWSER_START_TIMEOUT_MS = 2_800;
const BROWSER_FINISH_TIMEOUT_MS = 10_000;

export function useSpeechPlayback(targetLanguage: "ko-KR" | "en-US" = "ko-KR") {
  const supported = useCapability(() =>
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
  const audioElementSupported = useCapability(() => typeof Audio !== "undefined");
  const [mode, setMode] = useState<EarbudPlaybackMode>("browser");
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<AudioStatus>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [routeTest, setRouteTest] = useState<"untested" | "playing" | "played" | "failed">("untested");
  const [voiceTest, setVoiceTest] = useState<"untested" | "started" | "ended" | "failed">("untested");
  const [audioSession, setAudioSession] = useState("unknown");
  const backlog = useRef<PendingSpeech[]>([]);
  const busy = useRef(false);
  const generation = useRef(0);
  const drainRef = useRef<() => void>(() => {});
  const player = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = useRef<EarbudPlaybackMode>("browser");
  const targetRef = useRef(targetLanguage);
  useEffect(() => { targetRef.current = targetLanguage; }, [targetLanguage]);

  const clearResources = useCallback(() => {
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
    controller.current?.abort();
    controller.current = null;
    if (player.current) {
      player.current.pause();
      player.current.removeAttribute("src");
      player.current.load();
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    backlog.current = [];
    busy.current = false;
    clearResources();
    setStatus("idle");
  }, [clearResources]);

  useEffect(() => () => {
    generation.current += 1;
    backlog.current = [];
    clearResources();
  }, [clearResources]);

  const finish = useCallback((token: number) => {
    if (generation.current !== token) return;
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
    busy.current = false;
    drainRef.current();
  }, []);

  const playMedia = useCallback(async (blob: Blob, token: number) => {
    if (generation.current !== token) return;
    let audio = player.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = "auto";
      audio.setAttribute("playsinline", "true");
      player.current = audio;
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(blob);
    audio.setAttribute("src", objectUrl.current);
    audio.addEventListener("ended", () => finish(token), { once: true });
    audio.addEventListener("error", () => {
      if (generation.current !== token) return;
      setStatus("error");
      setNotice("오디오 파일 재생 실패. Safari 출력 경로·무음 모드·권한을 확인해.");
      backlog.current = [];
      busy.current = false;
    }, { once: true });
    setStatus("preparing");
    try {
      await audio.play();
      if (token !== generation.current) return;
      setStatus("speaking");
      watchdog.current = setTimeout(() => {
        if (token !== generation.current) return;
        setNotice("오디오가 끝나지 않아 재생을 중단했어. 출력 장치를 다시 확인해.");
        finish(token);
      }, 13_000);
    } catch {
      if (token !== generation.current) return;
      busy.current = false;
      backlog.current = [];
      setStatus("error");
      setNotice("iOS가 비동기 오디오 재생을 차단했어. 출력 테스트를 다시 누르고 화면을 켜 둬.");
    }
  }, [finish]);

  const drain = useCallback(() => {
    if (busy.current) return;
    let item = backlog.current.shift();
    while (item && Date.now() - item.queuedAt > STALE_AFTER_MS) {
      setNotice("오래 기다린 통역 음성을 건너뛰었어. 최신 자막을 확인해.");
      item = backlog.current.shift();
    }
    if (!item) {
      setStatus("idle");
      return;
    }
    busy.current = true;
    const token = generation.current;
    const text = item.text;
    setNotice(null);
    if (selected.current === "gemini") {
      const abort = new AbortController();
      controller.current = abort;
      setStatus("preparing");
      void guardedFetch("/api/earbud/tts", {
        method: "POST", signal: abort.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      }).then(async response => {
        if (!response.ok) throw new Error(String(response.status));
        const audio = await response.blob();
        if (audio.size > 3_000_000 || !audio.size) throw new Error("invalid audio");
        await playMedia(audio, token);
      }).catch(() => {
        if (generation.current !== token) return;
        busy.current = false;
        backlog.current = [];
        setStatus("error");
        setNotice("Gemini 무료 음성 생성이 실패했어. 브라우저 음성이나 자막으로 전환해.");
      });
      return;
    }
    if (!("speechSynthesis" in window)) {
      busy.current = false;
      setNotice("이 브라우저에는 음성 합성기가 없어.");
      setStatus("unavailable");
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = targetRef.current;
    utterance.rate = 1.12;
    const target = targetRef.current.toLowerCase();
    utterance.voice = synth.getVoices().find(v => v.lang.toLowerCase() === target)
      ?? synth.getVoices().find(v => v.lang.toLowerCase().startsWith(target.split("-")[0] + "-"))
      ?? null;
    setStatus("preparing");
    let started = false;
    utterance.onstart = () => {
      if (token !== generation.current) return;
      started = true;
      setStatus("speaking");
      if (watchdog.current) clearTimeout(watchdog.current);
      watchdog.current = setTimeout(() => {
        setNotice("Safari 음성 합성기가 끝나지 않아 재설정했어.");
        synth.cancel();
        finish(token);
      }, BROWSER_FINISH_TIMEOUT_MS);
    };
    utterance.onend = () => finish(token);
    utterance.onerror = e => {
      if (generation.current !== token) return;
      setStatus("error");
      setNotice(`Safari 음성 합성 오류: ${e.error}. 오디오 파일 출력을 시도해.`);
      backlog.current = [];
      finish(token);
    };
    try {
      synth.resume();
      synth.speak(utterance);
      watchdog.current = setTimeout(() => {
        if (token !== generation.current || started) return;
        synth.cancel();
        setNotice("Safari 음성 합성기가 시작되지 않았어. 음성 테스트/오디오 파일 방식으로 점검해.");
        setStatus("error");
        backlog.current = [];
        busy.current = false;
      }, BROWSER_START_TIMEOUT_MS);
    } catch {
      setStatus("error");
      setNotice("브라우저 음성 재생을 시작할 수 없어.");
      busy.current = false;
      backlog.current = [];
    }
  }, [finish, playMedia]);

  useEffect(() => { drainRef.current = drain; }, [drain]);

  const enqueue = useCallback((text: string) => {
    if (!enabled || !text.trim()) return;
    if (selected.current === "browser" && !supported) return;
    if (backlog.current.length >= MAX_EARBUD_AUDIO_BACKLOG) {
      backlog.current = [];
      setNotice("통역이 밀려 오래된 음성을 버렸어.");
    }
    backlog.current.push({ text: text.trim(), queuedAt: Date.now() });
    drainRef.current();
  }, [enabled, supported]);

  /** Run this from the actual click handler. HTML media bypasses speechSynthesis. */
  const testRoute = useCallback(() => {
    stop();
    setRouteTest("playing");
    setAudioSessionMode("playback");
    setAudioSession(getAudioSessionState());
    const token = generation.current;
    const audio = new Audio();
    const url = URL.createObjectURL(testToneWav());
    player.current = audio;
    objectUrl.current = url;
    audio.src = url;
    audio.onended = () => {
      if (generation.current === token) setRouteTest("played");
    };
    audio.onerror = () => setRouteTest("failed");
    void audio.play().catch(() => setRouteTest("failed"));
  }, [stop]);

  const testVoice = useCallback(() => {
    stop();
    setVoiceTest("untested");
    setAudioSessionMode("playback");
    setAudioSession(getAudioSessionState());
    const token = generation.current;
    if (selected.current === "browser" && "speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(targetRef.current === "en-US"
        ? "ASAD English speech output test." : "ASAD 한국어 음성 재생 점검입니다.");
      utterance.lang = targetRef.current;
      utterance.onstart = () => { if (generation.current === token) setVoiceTest("started"); };
      utterance.onend = () => { if (generation.current === token) setVoiceTest("ended"); };
      utterance.onerror = () => { if (generation.current === token) setVoiceTest("failed"); };
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(utterance);
        watchdog.current = setTimeout(() => {
          if (generation.current === token && !window.speechSynthesis.speaking) setVoiceTest("failed");
        }, 3_500);
      } catch { setVoiceTest("failed"); }
    } else {
      enqueue("ASAD 한국어 음성 재생 점검입니다.");
      setVoiceTest("started"); // Request dispatched, not an assertion of audible output.
    }
  }, [stop, enqueue]);

  const changeMode = useCallback((next: EarbudPlaybackMode) => {
    stop();
    selected.current = next;
    setMode(next);
    setVoiceTest("untested");
  }, [stop]);
  const setPlayback = useCallback((value: boolean) => {
    setEnabled(value);
    if (!value) stop();
  }, [stop]);
  const prepareMic = useCallback(() => {
    // WebKit prefers this for simultaneous audio capture/output.
    setAudioSessionMode("play-and-record");
    setAudioSession(getAudioSessionState());
  }, []);

  return {
    supported, audioElementSupported, mode, status, enabled, notice,
    routeTest, voiceTest, audioSession, enqueue, testRoute, testVoice,
    stop, setPlayback, changeMode, prepareMic,
  };
}
