"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_EARBUD_AUDIO_BACKLOG } from "./speakable";
import { useCapability } from "@/hooks/useCapability";

type AudioStatus = "unavailable" | "idle" | "speaking" | "error";

/**
 * Browser TTS uses the current SYSTEM audio output. In iOS Safari the page
 * cannot force speech to one AirPod or select the iPhone mic independently.
 * The explicit test button is therefore a release gate, not window dressing.
 */
export function useSpeechPlayback() {
  const supported = useCapability(() => "speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<AudioStatus>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const backlog = useRef<string[]>([]);
  const speaking = useRef(false);
  const generation = useRef(0);
  const draining = useRef<() => void>(() => {});

  useEffect(() => {
    return () => {
      generation.current += 1;
      backlog.current = [];
      speaking.current = false;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    backlog.current = [];
    speaking.current = false;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setStatus("speechSynthesis" in window ? "idle" : "unavailable");
  }, []);

  const drain = useCallback(() => {
    if (speaking.current || !("speechSynthesis" in window)) return;
    const text = backlog.current.shift();
    if (!text) {
      setStatus("idle");
      return;
    }
    const token = generation.current;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    utterance.rate = 1;
    // iOS can return [] before voiceschanged; the locale still tells it Korean.
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => voice.lang.toLowerCase() === "ko-kr") ?? null;
    speaking.current = true;
    setStatus("speaking");
    const done = () => {
      if (token !== generation.current) return;
      speaking.current = false;
      draining.current();
    };
    utterance.onend = done;
    utterance.onerror = (event) => {
      if (token !== generation.current) return;
      setNotice(`음성 재생에 실패했어 (${event.error}). 자막과 출력 경로를 확인해.`);
      setStatus("error");
      speaking.current = false;
      backlog.current = [];
    };
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      setNotice("음성을 재생할 수 없어. Safari 설정과 음성 출력 장치를 확인해.");
      backlog.current = [];
      speaking.current = false;
      setStatus("error");
    }
  }, []);

  useEffect(() => { draining.current = drain; }, [drain]);

  const enqueue = useCallback((text: string) => {
    if (!enabled || !supported || !text.trim()) return;
    if (backlog.current.length >= MAX_EARBUD_AUDIO_BACKLOG) {
      backlog.current = [];
      setNotice("통역 음성이 밀려 이전 대기 문장을 버렸어. 화면에서 확인해.");
    }
    backlog.current.push(text.trim());
    drain();
  }, [drain, enabled, supported]);

  const test = useCallback(() => {
    stop();
    setNotice(null);
    if (!("speechSynthesis" in window)) {
      setNotice("이 브라우저는 음성 합성을 지원하지 않아.");
      return;
    }
    backlog.current.push("ASAD 이어폰 출력 테스트입니다.");
    drain();
  }, [stop, drain]);

  const setPlayback = useCallback((value: boolean) => {
    setEnabled(value);
    if (!value) stop();
  }, [stop]);

  return { supported, enabled, status: supported ? status : "unavailable", notice, enqueue, test, stop, setPlayback };
}
