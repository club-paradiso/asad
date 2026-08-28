"use client";

/**
 * Counter Mode, staff side.
 *
 * The device on the desk — an iPad, or the spare phone in the drawer. Its whole
 * job at rest is to show a QR code big enough to scan from the visitor's side
 * of the counter, and its whole job in use is to be a conversation that the
 * staff member can read at a glance while doing something else with their hands.
 *
 * Three states, and no more: set up once, show the code, talk.
 */
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { COUNTER_LANGUAGES, findLanguage } from "@/counter/languages";
import { formatCode, joinUrl } from "@/counter/codes";
import { buildConfirmationText } from "@/counter/risks";
import { stringsFor } from "@/counter/ui-strings";
import type { CounterMessage, SessionView } from "@/counter/types";
import { Label } from "@/components/ui/primitives";
import { useClientValue } from "@/hooks/useClientValue";
import { useCounterSession } from "./useCounterSession";
import { ConversationView } from "./ConversationView";
import { Composer } from "./Composer";
import { QuickPhraseBar } from "./QuickPhraseBar";
import { QrCode } from "./QrCode";
import { useCounterDisclosure } from "./ProviderNotice";
import { cn } from "@/lib/cn";

/** The desk's own language. Korean staff, Korean counter — but not assumed. */
const DEFAULT_HOST_LANG = "ko-KR";

export function CounterHostScreen() {
  const [code, setCode] = useState<string | null>(null);
  const [hostLang, setHostLang] = useState(DEFAULT_HOST_LANG);
  const [deskLabel, setDeskLabel] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  const session = useCounterSession(code, "host");
  const t = stringsFor(hostLang);

  const start = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      const response = await fetch("/api/counter/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hostLang,
          deskLabel: deskLabel.trim() || undefined,
        }),
      });
      const data = (await response.json()) as { session?: SessionView; error?: string };
      if (!response.ok || !data.session) {
        setStartError(data.error ?? "세션을 만들지 못했습니다.");
        return;
      }
      setCode(data.session.code);
    } catch {
      setStartError("서버에 연결하지 못했습니다.");
    } finally {
      setStarting(false);
    }
  }, [hostLang, deskLabel]);

  /** End this visitor's conversation and open a fresh one for the next. */
  const next = useCallback(async () => {
    await session.end();
    setCode(null);
    setShowCode(false);
    void start();
  }, [session, start]);

  const finish = useCallback(async () => {
    await session.end();
    setCode(null);
    setShowCode(false);
  }, [session]);

  if (!code) {
    return (
      <SetupScreen
        hostLang={hostLang}
        onHostLang={setHostLang}
        deskLabel={deskLabel}
        onDeskLabel={setDeskLabel}
        onStart={start}
        starting={starting}
        error={startError}
      />
    );
  }

  const view = session.session;
  const guestJoined = !!view?.guestPresent && !!view.guestLang;

  return (
    <div className="flex h-[100dvh] flex-col bg-[var(--bg)]">
      <HostHeader
        code={code}
        deskLabel={view?.deskLabel}
        guestLang={view?.guestLang ?? null}
        connected={session.connected}
        ended={session.ended}
        onShowCode={() => setShowCode((value) => !value)}
        showingCode={showCode}
        onNext={next}
        onFinish={finish}
      />

      {session.error && (
        <p className="bg-[color-mix(in_srgb,var(--danger)_18%,transparent)] px-4 py-2 text-center text-sm text-[var(--danger)]">
          {session.error}
        </p>
      )}

      {/* Waiting, or the code was asked for again: the code is the screen. */}
      {!guestJoined || showCode ? (
        <JoinPanel
          code={code}
          deskLabel={view?.deskLabel}
          waiting={!guestJoined}
          onDismiss={guestJoined ? () => setShowCode(false) : undefined}
        />
      ) : (
        <>
          <main className="min-h-0 flex-1">
            <ConversationView
              messages={session.messages}
              viewerRole="host"
              viewerLang={hostLang}
              strings={t}
              onConfirm={(message) => void confirmRisks(session.send, message)}
              onRephrase={(message) =>
                void session.send({
                  text: message.originalText,
                  source: "text",
                  rephraseOf: message.id,
                })
              }
            />
          </main>

          <QuickPhraseBar
            role="host"
            lang={hostLang}
            strings={t}
            disabled={session.sending}
            onSend={(id) => void session.send({ text: id, source: "quick-phrase" })}
          />
          <Composer
            lang={hostLang}
            strings={t}
            busy={session.sending}
            onSend={(text, source) => void session.send({ text, source })}
          />
        </>
      )}
    </div>
  );
}

/** Re-send just the flagged values, for reading back aloud. */
function confirmRisks(
  send: ReturnType<typeof useCounterSession>["send"],
  message: CounterMessage,
) {
  const text = buildConfirmationText(message.risks ?? []);
  if (!text) return;
  return send({ text, source: "confirm" });
}

function HostHeader({
  code,
  deskLabel,
  guestLang,
  connected,
  ended,
  onShowCode,
  showingCode,
  onNext,
  onFinish,
}: {
  code: string;
  deskLabel?: string;
  guestLang: string | null;
  connected: boolean;
  ended: boolean;
  onShowCode: () => void;
  showingCode: boolean;
  onNext: () => void;
  onFinish: () => void;
}) {
  const guest = guestLang ? findLanguage(guestLang) : undefined;

  return (
    <header
      className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-2.5"
      style={{ paddingTop: "calc(0.625rem + var(--safe-top))" }}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[var(--fg)]">
          {deskLabel || "현장 응대"}
        </p>
        <p className="truncate text-xs text-[var(--fg-dim)]">
          <span className="font-mono">{formatCode(code)}</span>
          {guest && ` · ${guest.ko}`}
          {ended ? " · 종료됨" : !connected && " · 재연결 중"}
        </p>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <HeaderButton onClick={onShowCode} active={showingCode}>
          QR
        </HeaderButton>
        <HeaderButton onClick={onNext}>다음 손님</HeaderButton>
        <HeaderButton onClick={onFinish} tone="danger">
          종료
        </HeaderButton>
      </div>
    </header>
  );
}

function HeaderButton({
  children,
  onClick,
  active = false,
  tone = "neutral",
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active || undefined}
      className={cn(
        "rounded-md border px-3 py-1.5 text-xs transition-colors",
        tone === "danger"
          ? "border-[color-mix(in_srgb,var(--danger)_45%,transparent)] text-[var(--danger)]"
          : active
            ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
            : "border-[var(--line-strong)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The code, shown to the visitor.
 *
 * Sized to be scanned across a counter, and paired with the code in text
 * because cameras fail: cracked lenses, dead batteries, a phone with no camera
 * permission. The visitor can always type the code at the same address.
 */
function JoinPanel({
  code,
  deskLabel,
  waiting,
  onDismiss,
}: {
  code: string;
  deskLabel?: string;
  waiting: boolean;
  onDismiss?: () => void;
}) {
  // Read straight from the browser rather than through an effect, so the code
  // is painted in the first pass — the QR is the whole point of this screen.
  const origin = useClientValue(
    () => (typeof window === "undefined" ? "" : window.location.origin),
    "",
  );

  const url = origin ? joinUrl(origin, code) : "";
  // Strip the scheme: a visitor typing it in does not need "https://".
  const typedAddress = url.replace(/^https?:\/\//, "");

  return (
    <main className="scroll-y flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-5 py-6">
      <div className="text-center">
        <p className="text-lg font-semibold text-[var(--fg)]">
          QR 코드를 스캔해 주세요
        </p>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Scan to talk · 请扫码 · Quét mã · Отсканируйте
        </p>
      </div>

      {/* Sized to be read across a counter, at an angle, in bad light — the
          limit is the shorter viewport edge, not a fixed pixel count. */}
      <div className="w-full max-w-[min(70vw,26rem)] tall:max-w-[min(56vh,26rem)]">
        {url ? (
          <QrCode
            value={url}
            className="rounded-xl border-8 border-white bg-white"
            label={`${formatCode(code)} 참여 QR 코드`}
          />
        ) : (
          <div className="aspect-square animate-pulse rounded-xl bg-[var(--bg-raised)]" />
        )}
      </div>

      <div className="text-center">
        <p className="font-mono text-2xl font-semibold tracking-[0.2em] text-[var(--fg)]">
          {formatCode(code)}
        </p>
        {typedAddress && (
          <p className="mt-1 text-xs break-all text-[var(--fg-dim)]">{typedAddress}</p>
        )}
        {deskLabel && (
          <p className="mt-1 text-xs text-[var(--fg-dim)]">{deskLabel}</p>
        )}
      </div>

      <p className="text-sm text-[var(--fg-muted)]">
        {waiting ? "손님이 참여하기를 기다리는 중입니다." : "이미 참여 중입니다."}
      </p>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-[var(--line-strong)] px-4 py-2 text-sm text-[var(--fg-muted)] hover:text-[var(--fg)]"
        >
          대화로 돌아가기
        </button>
      )}
    </main>
  );
}

function SetupScreen({
  hostLang,
  onHostLang,
  deskLabel,
  onDeskLabel,
  onStart,
  starting,
  error,
}: {
  hostLang: string;
  onHostLang: (code: string) => void;
  deskLabel: string;
  onDeskLabel: (label: string) => void;
  onStart: () => void;
  starting: boolean;
  error: string | null;
}) {
  const disclosure = useCounterDisclosure();
  // Korean and English first: between them they cover almost every desk that
  // would run this, and the rest is a normal alphabetical-ish list.
  const languages = useMemo(
    () => [...COUNTER_LANGUAGES].sort((a, b) => rank(a.code) - rank(b.code)),
    [],
  );

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col gap-7 px-5 py-8 sm:py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">현장 응대 모드</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--fg-muted)]">
          QR 코드를 보여주면 손님이 자기 휴대폰으로 참여합니다. 설치는 필요
          없습니다. 자주 쓰는 문구는 모델을 거치지 않고 그대로 전달되고, 숫자와
          이름은 확인용으로 표시됩니다.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <Label>1 · 직원 언어</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {languages.map((language) => {
            const selected = language.code === hostLang;
            return (
              <button
                key={language.code}
                type="button"
                onClick={() => onHostLang(language.code)}
                aria-pressed={selected}
                className={cn(
                  "min-w-0 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  selected
                    ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                    : "border-[var(--line)] bg-[var(--bg-raised)] hover:border-[var(--line-strong)]",
                )}
              >
                <span className="block truncate text-sm font-medium">{language.ko}</span>
                <span className="block truncate text-xs text-[var(--fg-dim)]">
                  {language.endonym}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <Label>2 · 창구 이름 (선택)</Label>
        <input
          value={deskLabel}
          onChange={(event) => onDeskLabel(event.target.value)}
          placeholder="예: 접수 창구 2"
          maxLength={60}
          className="rounded-md border border-[var(--line-strong)] bg-[var(--bg-raised)] px-3.5 py-3 text-base text-[var(--fg)] placeholder:text-[var(--fg-dim)] focus:border-[var(--accent)] focus:outline-none"
        />
        <p className="text-xs text-[var(--fg-dim)]">
          손님 화면에 표시됩니다. 창구가 여러 개일 때 도움이 됩니다.
        </p>
      </section>

      {error && (
        <p className="rounded-md border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      {/* The deployment detail belongs here, not on the visitor's phone: the
          staff member is the only one who can act on a missing key, and the
          only one who reads this language. */}
      {disclosure && !disclosure.provider && (
        <div className="rounded-md border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] px-3.5 py-3 text-xs leading-relaxed">
          <p className="text-[var(--danger)]">
            번역 제공자가 설정되지 않아 지금은 번역이 되지 않습니다.
          </p>
          <p className="mt-1 text-[var(--fg-dim)]">
            LLM API 키를 설정하세요 — docs/counter-mode.md 참고. 자주 쓰는 문구는
            모델 없이도 그대로 작동합니다.
          </p>
        </div>
      )}

      {/* The staff member is the one who can act on this — they choose whether
          to use the counter for a sensitive case at all. */}
      {disclosure?.provider && (
        <div className="rounded-md border border-[var(--line)] bg-[var(--bg-raised)] px-3.5 py-3 text-xs leading-relaxed">
          <p className="text-[var(--fg-muted)]">
            번역은 <span className="text-[var(--fg)]">{disclosure.provider}</span>
            에서 처리합니다
            {disclosure.openWeightModel && " · 오픈 웨이트 모델"}.
          </p>
          <p className={cn("mt-1", disclosure.mayTrain ? "text-[var(--warn)]" : "text-[var(--fg-dim)]")}>
            {disclosure.note}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onStart}
        disabled={starting}
        className="rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-5 py-4 text-lg font-semibold text-[var(--bg)] disabled:pointer-events-none disabled:opacity-40"
      >
        {starting ? "준비 중…" : "QR 코드 띄우기"}
      </button>

      <footer className="mt-auto flex items-center justify-between pt-4 text-xs text-[var(--fg-dim)]">
        <Link href="/" className="hover:text-[var(--fg)]">
          ← 통역 콘솔
        </Link>
        <span>대화 내용은 저장되지 않습니다.</span>
      </footer>
    </div>
  );
}

const rank = (code: string): number => {
  if (code === "ko-KR") return 0;
  if (code === "en-US") return 1;
  return 2;
};
