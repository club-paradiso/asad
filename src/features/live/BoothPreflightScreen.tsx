"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { BoothPreflight } from "./BoothPreflight";
import { useBoothAudioInput } from "./useBoothAudioInput";
import { describeAudioInput } from "./audio-input-kind";
import {
  clearBoothPreflightAcknowledgement,
  writeBoothPreflightAcknowledgement,
} from "./booth-preflight-ack";

/**
 * Dedicated hardware check that can be opened before the live console.
 *
 * Written for the volunteer who arrives forty minutes before the service and
 * has never heard the words "sample rate". Four numbered steps, each a thing
 * to do, each with what success looks like; the vocabulary is cables, knobs
 * and the one meter. Everything technical the browser can tell us is still
 * shown, but in small type under the thing it explains.
 */
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

  const selectedKind = describeAudioInput(audioInput.deviceId ? audioInput.selectedLabel : "");
  const externalInputs = audioInput.devices.filter(
    (device) => device.deviceId !== "default" && describeAudioInput(device.label).suitability !== "bad",
  );

  return (
    <div data-surface="launcher" className="min-h-[100dvh] w-full">
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col gap-6 px-5 py-8 sm:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] pb-5">
          <div>
            <p className="brand-caption">부스 모드</p>
            <h1 className="type-display mt-1 text-2xl leading-tight">부스 사전 점검</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--fg-muted)]">
              예배 전에 네 가지만 확인합니다. 이 화면은 음성 인식도 통역도 돌리지 않고, 테스트 오디오를 외부로 보내지 않습니다.
            </p>
          </div>
          <Link
            href="/live"
            className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-[var(--accent)] underline-offset-4 hover:underline"
          >
            {preflightReady ? "통역으로 이동 →" : "통역으로 돌아가기"}
          </Link>
        </header>

        <ol className="flex flex-col gap-5">
          {/* --- 1. 연결 ---------------------------------------------------- */}
          <li className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-4">
            <Step n={1} title="콘솔과 맥북을 연결합니다" />
            <p className="mt-2 text-sm leading-relaxed text-[var(--fg-muted)]">
              통역 콘솔의 <strong className="text-[var(--fg)]">녹음·라인 출력</strong>(없으면 여분의 헤드폰 출력)을 맥북의 오디오 입력에 연결합니다.
              통역사 인이어는 지금처럼 콘솔에 그대로 둡니다. ASAD는 듣기만 하고, 회중에게 나가는 소리는 건드리지 않습니다.
            </p>
            <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-[var(--fg-dim)]">
              <li>· USB 오디오 어댑터를 썼다면 아래 목록에 <em>USB</em>가 붙은 장치로 나타납니다.</li>
              <li>· 맥북의 3.5mm 단자에 꽂았다면 <em>외장 마이크</em>로 바뀌어 나타납니다. 바뀌지 않으면 맥이 마이크로 인식하지 못한 것입니다.</li>
              <li>· 목록에 <em>MacBook 마이크</em>만 있다면 아직 아무것도 연결되지 않은 상태입니다.</li>
            </ul>
          </li>

          {/* --- 2. 입력 선택 ----------------------------------------------- */}
          <li className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-4">
            <Step n={2} title="ASAD가 들을 입력을 고릅니다" />
            <label className="mt-3 flex flex-col gap-2">
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
                {audioInput.deviceId && !audioInput.selectionAvailable ? (
                  <option value={audioInput.deviceId} disabled>
                    이전에 선택한 입력 · 연결 끊김
                  </option>
                ) : null}
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
            <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
              <p
                className={
                  selectedKind.suitability === "bad"
                    ? "text-xs leading-relaxed text-[var(--warn)]"
                    : "text-xs leading-relaxed text-[var(--fg-muted)]"
                }
              >
                {audioInput.deviceId
                  ? selectedKind.note
                  : "시스템 기본값은 맥이 그때그때 고르는 입력입니다. 부스에서는 콘솔이 연결된 장치를 직접 고르세요."}
              </p>
              <button
                type="button"
                onClick={() => void audioInput.refresh()}
                className="min-h-11 shrink-0 px-2 text-xs font-medium text-[var(--accent)] underline-offset-4 hover:underline"
              >
                목록 다시 찾기
              </button>
            </div>
            {audioInput.devices.length > 0 && externalInputs.length === 0 && (
              <p className="mt-2 text-xs leading-relaxed text-[var(--warn)]">
                지금 보이는 입력은 노트북·휴대폰 마이크뿐입니다. 콘솔 피드가 아직 맥북에 닿지 않았습니다. 1단계의 연결을 다시 확인한 뒤 「목록 다시 찾기」를 누르세요.
              </p>
            )}
          </li>

          {/* --- 3·4. 소리 확인 + 마지막 확인 ------------------------------- */}
          <li>
            <div className="mb-2 px-1">
              <Step n={3} title="강단 소리가 들어오는지 봅니다" />
            </div>
            <BoothPreflight
              key={`${audioInput.deviceId || "system-default"}:${audioInput.selectionAvailable ? "available" : "missing"}`}
              inputLabel={audioInput.selectedLabel}
              deviceId={audioInput.deviceId || undefined}
              onPermissionGranted={() => void audioInput.refresh()}
              onReadyChange={handleReadyChange}
            />
          </li>
        </ol>

        <details className="rounded-lg border border-[var(--line)] px-4 py-3 text-sm leading-relaxed text-[var(--fg-muted)]">
          <summary className="min-h-11 cursor-pointer list-none font-semibold text-[var(--fg)] marker:content-none">
            잘 안 되나요? 증상별로 보기
          </summary>
          <dl className="mt-3 grid gap-3 text-xs sm:text-[0.8125rem]">
            <Trouble
              symptom="목록에 콘솔 쪽 장치가 없다"
              fix="어댑터를 뽑았다 다시 꽂고 「목록 다시 찾기」를 누르세요. 3.5mm 단자는 끝까지 꽂혀야 맥이 마이크로 인식합니다. 그래도 안 보이면 맥 자체가 그 어댑터에서 녹음을 지원하지 않는 것입니다."
            />
            <Trouble
              symptom="「마이크 권한이 거부되었습니다」가 뜬다"
              fix="주소창 왼쪽 자물쇠 → 마이크 → 허용으로 바꾸고 페이지를 새로고침하세요. 맥 전체에서 막혀 있으면 시스템 설정 → 개인정보 보호 및 보안 → 마이크에서 브라우저를 켜세요."
            />
            <Trouble
              symptom="막대가 전혀 움직이지 않는다"
              fix="콘솔 쪽 출력 볼륨이 0이거나 케이블이 다른 구멍에 꽂혀 있습니다. 볼륨을 올리고, 콘솔에서 '출력'이라고 적힌 단자인지 확인하세요. 노트북 마이크를 골랐다면 방 안 소리에는 움직이지만 콘솔 피드는 아닙니다."
            />
            <Trouble
              symptom="「신호가 너무 큼」이 뜨거나 막대가 빨갛다"
              fix="콘솔(또는 어댑터) 출력 볼륨을 낮추세요. 헤드폰 출력은 마이크 입력보다 훨씬 세서 절반 아래로 내려야 하는 경우가 많습니다."
            />
            <Trouble
              symptom="통역사가 말할 때도 막대가 움직인다"
              fix="통역 채널이 ASAD 피드에 섞여 들어오고 있습니다. 콘솔에서 원음(floor)만 나가는 출력을 쓰거나, 통역 채널이 빠진 출력을 고르세요. 이대로 시작하면 ASAD가 영어를 한국어로 착각합니다."
            />
            <Trouble
              symptom="소리는 들어오는데 통역 화면에 아무것도 안 뜬다"
              fix="입력이 아니라 인식·AI 쪽 문제입니다. 「진단」 화면의 Live readiness에서 어느 단계가 막혔는지 확인하세요."
            />
          </dl>
          <p className="mt-3 text-xs text-[var(--fg-dim)]">
            더 자세한 확인은{" "}
            <Link href="/diagnostics" className="text-[var(--accent)] underline-offset-4 hover:underline">
              진단 화면
            </Link>
            에서 할 수 있습니다.
          </p>
        </details>

        <section className="rounded-lg border border-[var(--line)] px-4 py-4 text-sm leading-relaxed text-[var(--fg-muted)]">
          <h2 className="font-semibold text-[var(--fg)]">휴대폰을 무선 마이크로 쓰나요?</h2>
          <p className="mt-2">
            원격 마이크(휴대폰)는 페어링이 통역 화면에 붙어 있어서, 점검도 그곳에서 합니다.{" "}
            <Link href="/live" className="text-[var(--accent)] underline-offset-4 hover:underline">
              통역 화면
            </Link>
            에서 「원격 마이크 (휴대폰)」를 고르면 연결 · 실제 오디오 수신 · 레벨 · 찌그러짐 · 올바른 소리를 차례로 확인합니다. 휴대폰은 콘솔 피드가 아니라 방 안의 소리를 듣는다는 점을 기억하세요.
          </p>
        </section>

        <section className="rounded-lg border border-[var(--line)] px-4 py-4 text-sm leading-relaxed text-[var(--fg-muted)]">
          <h2 className="font-semibold text-[var(--fg)]">이 점검으로 확인하는 것</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>선택한 입력에 한국어 강단·프로그램 피드가 들어옵니다.</li>
            <li>평소 말하기 크기에서 레벨이 안정적으로 읽히고, 찌그러지지 않습니다.</li>
            <li>통역사의 영어 마이크가 이 입력에 섞여 들어오지 않습니다.</li>
            <li>회중에게 나가는 통역 경로가 ASAD에 의존하지 않습니다.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="flex items-center gap-3 text-sm font-semibold text-[var(--fg)]">
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-full border border-[var(--line-strong)] text-xs text-[var(--fg-muted)]"
      >
        {n}
      </span>
      {title}
    </h2>
  );
}

function Trouble({ symptom, fix }: { symptom: string; fix: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--bg-overlay)] px-3 py-2.5">
      <dt className="font-semibold text-[var(--fg)]">{symptom}</dt>
      <dd className="mt-1 leading-relaxed text-[var(--fg-muted)]">{fix}</dd>
    </div>
  );
}
