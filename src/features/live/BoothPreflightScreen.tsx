"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { BoothPreflight } from "./BoothPreflight";
import { useBoothAudioInput } from "./useBoothAudioInput";
import {
  clearBoothPreflightAcknowledgement,
  writeBoothPreflightAcknowledgement,
} from "./booth-preflight-ack";

/** Dedicated hardware check that can be opened before the live console. */
export function BoothPreflightScreen() {
  const audioInput = useBoothAudioInput(true);
  const [preflightReady, setPreflightReady] = useState(false);

  const handleReadyChange = useCallback(
    (ready: boolean) => {
      setPreflightReady(ready);
      if (ready) writeBoothPreflightAcknowledgement(audioInput.deviceId || undefined);
      else clearBoothPreflightAcknowledgement();
    },
    [audioInput.deviceId],
  );

  return (
    <div data-surface="launcher" className="min-h-[100dvh] w-full">
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col gap-6 px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] pb-5">
        <div>
          <p className="brand-caption">부스 모드</p>
          <h1 className="type-display mt-1 text-2xl leading-tight">부스 사전 점검</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--fg-muted)]">
            예배 전에 한국어 프로그램 피드를 확인합니다. 이 화면은 음성 인식도 통역도 돌리지 않고, 테스트 오디오를 외부로 보내지 않습니다.
          </p>
        </div>
        <Link
          href="/live"
          className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-[var(--accent)] underline-offset-4 hover:underline"
        >
          {preflightReady ? "통역으로 이동" : "통역으로 돌아가기"}
        </Link>
      </header>

      <section className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-4">
        <label className="flex flex-col gap-2">
          <span className="brand-caption">입력 장치</span>
          <select
            aria-label="Booth preflight audio input"
            value={audioInput.deviceId}
            onChange={(event) => {
              setPreflightReady(false);
              clearBoothPreflightAcknowledgement();
              audioInput.setDeviceId(event.target.value);
            }}
            disabled={!audioInput.supported}
            className="min-h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--bg-overlay)] px-3 text-sm text-[var(--fg)] outline-none focus-visible:border-[var(--accent)] disabled:opacity-50"
          >
            <option value="">시스템 기본값</option>
            {audioInput.devices
              .filter((device) => device.deviceId !== "default")
              .map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
          </select>
        </label>
        <p className="mt-2 text-xs leading-relaxed text-[var(--fg-muted)]">
          믹서의 AUX/MATRIX 출력이나 USB 오디오 인터페이스 피드를 직접 받는 편이 가장 좋습니다. 실내 마이크는 차선책이지, 부스가 상정한 방식은 아닙니다. 선택한 입력은 이 브라우저에만 기억됩니다.
        </p>
      </section>

      <BoothPreflight
        key={audioInput.deviceId || "system-default"}
        inputLabel={audioInput.selectedLabel}
        deviceId={audioInput.deviceId || undefined}
        onPermissionGranted={() => void audioInput.refresh()}
        onReadyChange={handleReadyChange}
      />

      <section className="rounded-lg border border-[var(--line)] px-4 py-4 text-sm leading-relaxed text-[var(--fg-muted)]">
        <h2 className="font-semibold text-[var(--fg)]">이 점검으로 확인하는 것</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>선택한 입력에 한국어 강단·프로그램 피드가 들어옵니다.</li>
          <li>평소 말하기 크기에서 레벨이 안정적으로 읽힙니다.</li>
          <li>통역사의 영어 마이크가 이 입력에 섞여 들어오지 않습니다.</li>
          <li>회중에게 나가는 통역 경로가 ASAD에 의존하지 않습니다.</li>
        </ul>
      </section>
    </main>
    </div>
  );
}
