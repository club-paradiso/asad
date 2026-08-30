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
import { COUNTER_PROFILES, findCounterProfile, type CounterProfileId } from "@/counter/profiles";
import { stringsFor } from "@/counter/ui-strings";
import type { CounterMessage, SessionView } from "@/counter/types";
import { Label } from "@/components/ui/primitives";
import { useClientValue } from "@/hooks/useClientValue";
import { useLocalStore } from "@/lib/local-store";
import { useCounterSession } from "./useCounterSession";
import { ConversationView } from "./ConversationView";
import { Composer } from "./Composer";
import { QuickPhraseBar } from "./QuickPhraseBar";
import { QrCode } from "./QrCode";
import { useCounterDisclosure } from "./ProviderNotice";
import { cn } from "@/lib/cn";
import { counterPreferencesStore } from "./preferences";

export function CounterHostScreen() {
  const [code, setCode] = useState<string | null>(null);
  const [preferences, setPreferences] = useLocalStore(counterPreferencesStore);
  const [editingPreferences, setEditingPreferences] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  const session = useCounterSession(code, "host");
  const hostLang = preferences.hostLang;
  const deskLabel = preferences.deskLabel;
  const profileId = preferences.profileId;
  const t = stringsFor(hostLang);

  const start = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    setPreferences({ ...preferences, configured: true });
    try {
      const response = await fetch("/api/counter/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hostLang,
          deskLabel: deskLabel.trim() || undefined,
          profileId,
        }),
      });
      const data = (await response.json()) as { session?: SessionView; error?: string };
      if (!response.ok || !data.session) {
        setStartError("현장응대를 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      setCode(data.session.code);
      setEditingPreferences(false);
    } catch {
      setStartError("연결할 수 없습니다. 네트워크를 확인하고 다시 시도해 주세요.");
    } finally {
      setStarting(false);
    }
  }, [hostLang, deskLabel, profileId, preferences, setPreferences]);

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
        onHostLang={(value) => setPreferences({ ...preferences, hostLang: value })}
        deskLabel={deskLabel}
        onDeskLabel={(value) => setPreferences({ ...preferences, deskLabel: value })}
        profileId={profileId}
        onProfileId={(value) => setPreferences({ ...preferences, profileId: value })}
        onStart={start}
        starting={starting}
        error={startError}
        configured={preferences.configured}
        editing={editingPreferences}
        onEdit={() => setEditingPreferences(true)}
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
              onSimplify={(message) =>
                void session.send({
                  text: message.originalText,
                  source: "text",
                  action: "simplify",
                  actionOf: message.id,
                })
              }
              onRetry={(message) =>
                void session.send({
                  text: message.originalText,
                  source: "text",
                  action: "retry",
                  actionOf: message.id,
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
  const text = buildConfirmationText(message.criticalValues ?? message.risks ?? []);
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
  profileId,
  onProfileId,
  onStart,
  starting,
  error,
  configured,
  editing,
  onEdit,
}: {
  hostLang: string;
  onHostLang: (code: string) => void;
  deskLabel: string;
  onDeskLabel: (label: string) => void;
  profileId: CounterProfileId;
  onProfileId: (profile: CounterProfileId) => void;
  onStart: () => void;
  starting: boolean;
  error: string | null;
  configured: boolean;
  editing: boolean;
  onEdit: () => void;
}) {
  const disclosure = useCounterDisclosure();
  // Korean and English first: between them they cover almost every desk that
  // would run this, and the rest is a normal alphabetical-ish list.
  const languages = useMemo(
    () => [...COUNTER_LANGUAGES].sort((a, b) => rank(a.code) - rank(b.code)),
    [],
  );

  if (configured && !editing) {
    const language = findLanguage(hostLang);
    const profile = findCounterProfile(profileId);
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col gap-7 px-5 py-8 sm:py-12">
        <header>
          <p className="text-sm font-semibold text-[var(--accent)]">현장 응대</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">바로 시작할까요?</h1>
          <p className="mt-2 text-sm text-[var(--fg-muted)]">
            지난번 설정으로 QR을 바로 만들 수 있습니다.
          </p>
        </header>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--bg-raised)] p-5">
          <p className="text-lg font-semibold text-[var(--fg)]">{deskLabel || "현장 응대"}</p>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            {language?.ko ?? hostLang} · {language?.endonym ?? hostLang}
          </p>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">{profile.label}</p>
          <button
            type="button"
            onClick={onEdit}
            className="mt-4 min-h-11 rounded-lg border border-[var(--line-strong)] px-4 text-sm text-[var(--fg-muted)]"
          >
            설정 변경
          </button>
        </section>

        {error && (
          <p className="rounded-md border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onStart}
          disabled={starting}
          className="min-h-16 rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-5 text-lg font-semibold text-[var(--accent-contrast)] disabled:pointer-events-none disabled:opacity-40"
        >
          {starting ? "준비 중…" : "새 민원 시작"}
        </button>

        <footer className="mt-auto flex items-center justify-between pt-4 text-xs text-[var(--fg-dim)]">
          <Link href="/" className="hover:text-[var(--fg)]">
            ← 모드 선택
          </Link>
          <span>대화 기록은 세션 동안만 임시 보관됩니다.</span>
        </footer>
      </div>
    );
  }

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

      <section className="flex flex-col gap-3">
        <Label>2 · 현장 유형</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {COUNTER_PROFILES.map((profile) => {
            const selected = profile.id === profileId;
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => onProfileId(profile.id)}
                aria-pressed={selected}
                className={cn(
                  "min-w-0 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  selected
                    ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                    : "border-[var(--line)] bg-[var(--bg-raised)] hover:border-[var(--line-strong)]",
                )}
              >
                <span className="block text-sm font-medium">{profile.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--fg-dim)]">
                  {profile.description}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <Label>3 · 창구 이름 (선택)</Label>
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

      {disclosure && !disclosure.provider && (
        <div className="rounded-md border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] px-3.5 py-3 text-xs leading-relaxed">
          <p className="text-[var(--danger)]">
            지금은 새 문장을 번역할 수 없습니다.
          </p>
          <p className="mt-1 text-[var(--fg-dim)]">
            관리자에게 설정을 확인해 달라고 요청해 주세요. 자주 쓰는 문구는 계속
            사용할 수 있습니다.
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
          ← 모드 선택
        </Link>
        <span>대화 기록은 세션 동안만 임시 보관됩니다.</span>
      </footer>
    </div>
  );
}

const rank = (code: string): number => {
  if (code === "ko-KR") return 0;
  if (code === "en-US") return 1;
  return 2;
};
