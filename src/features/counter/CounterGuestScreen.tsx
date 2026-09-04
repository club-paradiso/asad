"use client";

/**
 * Counter Mode, visitor side.
 *
 * Opened by scanning a QR code, on a phone belonging to someone who does not
 * read the language of the building they are standing in. Two consequences run
 * through this whole screen:
 *
 *  - The first thing shown is a list of languages written in their own script.
 *    Nothing else can be understood until that choice is made, so nothing else
 *    is shown.
 *  - After that, every control is in the language they chose. Translating the
 *    messages but leaving the buttons in Korean puts the one thing they cannot
 *    ask about — how to work it — out of reach.
 *
 * No install, no account, no app store. A web page is the only thing a stranger
 * at a counter will actually open.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  COUNTER_LANGUAGES,
  PRIORITY_LANGUAGES,
  findLanguage,
  suggestLanguage,
} from "@/counter/languages";
import { formatCode } from "@/counter/codes";
import { Mark } from "@/components/brand/Mark";
import { buildConfirmationText } from "@/counter/risks";
import { stringsFor } from "@/counter/ui-strings";
import type { CounterMessage, SessionView } from "@/counter/types";
import { ensureMicrophonePermission } from "@/providers/stt";
import { useCounterSession } from "./useCounterSession";
import { ConversationView } from "./ConversationView";
import { Composer } from "./Composer";
import { CounterEndedScreen } from "./CounterEndedScreen";
import { QuickPhraseBar } from "./QuickPhraseBar";
import { ProviderNotice, useCounterDisclosure } from "./ProviderNotice";
import { sessionEndCopy } from "./session-end-copy";
import { useClientValue } from "@/hooks/useClientValue";
import { cn } from "@/lib/cn";

export function CounterGuestScreen({ code }: { code: string }) {
  const [lang, setLang] = useState<string | null>(null);
  const [participantToken, setParticipantToken] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Only poll once a language is chosen: before that there is nothing to show
  // and no reason to announce a visitor who has not arrived.
  const session = useCounterSession(lang ? code : null, participantToken);

  const join = useCallback(
    async (chosen: string) => {
      setJoining(true);
      setJoinError(null);
      // Permission belongs to setup, not to the first spoken syllable. Start the
      // native browser handshake from this explicit Start tap while the session
      // request runs in parallel. The probe stream is immediately released and
      // no audio is read or sent by the permission helper.
      const microphoneReady = ensureMicrophonePermission();
      try {
        const response = await fetch("/api/counter/session", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(participantToken
              ? { "x-asad-counter-token": participantToken }
              : {}),
          },
          body: JSON.stringify({ code, guestLang: chosen }),
        });
        const data = (await response.json()) as {
          session?: SessionView;
          participantToken?: string;
          error?: string;
        };
        if (!response.ok || !data.session || !data.participantToken) {
          setJoinError(data.error ?? "Could not join this session.");
          return;
        }
        // Do not enter the conversation while a browser permission sheet is
        // still covering it. Denial never blocks typing; useVoiceInput reports
        // the microphone state only if the visitor later chooses voice.
        await microphoneReady;
        setParticipantToken(data.participantToken);
        setLang(chosen);
      } catch {
        setJoinError("Could not reach the server. Check the connection.");
      } finally {
        setJoining(false);
      }
    },
    [code, participantToken],
  );

  const finish = useCallback(async () => {
    await session.end();
  }, [session]);

  if (!lang) {
    return (
      <LanguagePicker code={code} onChoose={join} joining={joining} error={joinError} />
    );
  }

  if (session.ended) {
    return <GuestSessionClosing lang={lang} />;
  }

  const t = stringsFor(lang);
  const endCopy = sessionEndCopy(lang);
  const rtl = findLanguage(lang)?.rtl ?? false;
  const view = session.session;
  // Changing a mis-tapped language is allowed until the visitor has spoken;
  // after that the server treats a new claim as a different person.
  const canChangeLanguage = !session.messages.some((m) => m.from === "guest");

  return (
    <div className="flex h-[100dvh] flex-col bg-[var(--bg)]" dir={rtl ? "rtl" : undefined}>
      <header
        className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-2.5"
        style={{ paddingTop: "calc(0.625rem + var(--safe-top))" }}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--fg)]">
            {view?.deskLabel || formatCode(code)}
          </p>
          <p className="truncate text-xs text-[var(--fg-dim)]">
            {!session.connected ? t.connecting : findLanguage(lang)?.endonym}
          </p>
        </div>

        <div className="ms-auto flex items-center gap-2">
          {canChangeLanguage && (
            <button
              type="button"
              onClick={() => setLang(null)}
              className="min-h-11 rounded-lg border border-[var(--line-strong)] px-3 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              {t.changeLanguage}
            </button>
          )}
          <button
            type="button"
            onClick={() => void finish()}
            aria-label={endCopy.endAction}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] px-3 text-sm font-semibold text-[var(--danger)]"
          >
            <span aria-hidden className="text-lg leading-none">×</span>
            <span>{endCopy.endAction}</span>
          </button>
        </div>
      </header>

      {session.error && (
        <p className="bg-[color-mix(in_srgb,var(--danger)_18%,transparent)] px-4 py-2 text-center text-sm text-[var(--danger)]">
          {session.error}
        </p>
      )}

      <main className="min-h-0 flex-1">
        <ConversationView
          messages={session.messages}
          viewerRole="guest"
          viewerLang={lang}
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
        role="guest"
        lang={lang}
        strings={t}
        disabled={session.sending}
        onSend={(id) => void session.send({ text: id, source: "quick-phrase" })}
      />
      <Composer
        lang={lang}
        strings={t}
        busy={session.sending}
        counterCode={code}
        counterToken={participantToken}
        onSend={(text, source) => session.send({ text, source })}
      />
    </div>
  );
}

function GuestSessionClosing({ lang }: { lang: string }) {
  useEffect(() => {
    const destination = `/counter/ended?lang=${encodeURIComponent(lang)}`;

    // A browser only permits scripts to close tabs/windows that were opened by
    // script. QR/deep-link tabs normally have no opener, so do not trigger a
    // browser warning by attempting an impossible close. When closing is
    // permitted, try it after the terminal state has painted once.
    const closeTimer = window.setTimeout(() => {
      if (window.opener) {
        try {
          window.close();
        } catch {
          // The deterministic location.replace fallback below handles refusal.
        }
      }
    }, 180);

    // location.replace removes the dead consultation URL from browser history,
    // so Back cannot reopen a session that has already been deleted.
    const replaceTimer = window.setTimeout(() => {
      if (!window.closed) window.location.replace(destination);
    }, 650);

    return () => {
      window.clearTimeout(closeTimer);
      window.clearTimeout(replaceTimer);
    };
  }, [lang]);

  return <CounterEndedScreen lang={lang} />;
}

function confirmRisks(
  send: ReturnType<typeof useCounterSession>["send"],
  message: CounterMessage,
) {
  const text = buildConfirmationText(message.criticalValues ?? message.risks ?? []);
  if (!text) return;
  return send({ text, source: "confirm" });
}

/**
 * The language list.
 *
 * Every entry is written in its own script and nothing else, because the
 * visitor is scanning for the shape of their own language, not reading a label.
 * The browser's guess is pre-selected but never acted on silently: guessing
 * wrong strands someone in a language they cannot read well enough to fix.
 */
function LanguagePicker({
  code,
  onChoose,
  joining,
  error,
}: {
  code: string;
  onChoose: (lang: string) => void;
  joining: boolean;
  error: string | null;
}) {
  // The browser's guess, read on the client only: `navigator.languages` does
  // not exist on the server, and a guess baked into the HTML would be the same
  // wrong guess for everyone.
  const suggested = useClientValue(
    () =>
      typeof navigator === "undefined"
        ? "en-US"
        : suggestLanguage(navigator.languages),
    "en-US",
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = chosen ?? suggested;
  const disclosure = useCounterDisclosure();

  const ordered = useMemo(() => {
    const priority = new Set<string>(PRIORITY_LANGUAGES);
    const first = COUNTER_LANGUAGES.filter((l) => priority.has(l.code));
    const rest = COUNTER_LANGUAGES.filter((l) => !priority.has(l.code));
    return [...first, ...rest];
  }, []);

  const t = stringsFor(selected);

  return (
    <div data-surface="launcher" className="min-h-[100dvh] w-full">
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col gap-5 px-4 py-7">
      <header className="flex flex-col items-center gap-3 text-center">
        {/* The only screen in the product a person outside the organisation
            ever sees, and it used to carry no identity at all — just a grid of
            language names and a code stamped with a brand name we retired.
            The mark goes here, small: they are choosing a language, not
            admiring a logo. */}
        <Mark size={28} title="아무튼서로알아들었으면된거아닌가요" />
        {/* Multilingual on purpose: this line has to be read by someone who has
            not yet told us what they read. */}
        <div>
          <h1 className="text-xl font-semibold text-[var(--fg)]">
            Choose your language
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            언어를 선택하세요 · 选择语言 · 言語を選択 · Chọn ngôn ngữ
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2.5">
        {ordered.map((language) => {
          const active = language.code === selected;
          return (
            <button
              key={language.code}
              type="button"
              lang={language.code}
              dir={language.rtl ? "rtl" : undefined}
              onClick={() => setChosen(language.code)}
              aria-pressed={active}
              className={cn(
                "min-w-0 rounded-lg border px-3 py-3.5 text-center transition-colors",
                active
                  ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                  : "border-[var(--line)] bg-[var(--bg-raised)]",
              )}
            >
              <span className="block truncate text-base font-medium text-[var(--fg)]">
                {language.endonym}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        /* Shape as well as hue: this is read by someone who does not share a
           language with the staff member, and red-on-its-own is the one
           signal that carries nothing at all for a colour-blind reader. */
        <p
          role="alert"
          className="flex items-start justify-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] px-3 py-2 text-center text-sm text-[var(--danger)]"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="mt-0.5 size-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          >
            <path d="M12 3 22 21H2z" />
            <path d="M12 10v4" strokeLinecap="round" />
            <path d="M12 17.5h.01" strokeLinecap="round" />
          </svg>
          {error}
        </p>
      )}

      <div
        className="sticky bottom-0 mt-auto bg-[var(--bg)] pt-3"
        style={{ paddingBottom: "calc(0.75rem + var(--safe-bottom))" }}
      >
        <p className="mb-2 text-center text-xs text-[var(--fg-dim)]">
          {t.pickLanguageHint}
        </p>
        {/* Named before the first word is typed, not after. */}
        <ProviderNotice disclosure={disclosure} strings={t} className="mb-2.5" />
        <button
          type="button"
          disabled={joining}
          onClick={() => onChoose(selected)}
          className="w-full rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-5 py-4 text-lg font-semibold text-[var(--accent-contrast)] disabled:pointer-events-none disabled:opacity-40"
        >
          {joining ? t.connecting : t.start}
        </button>
        <p className="brand-caption mt-2 text-center">{formatCode(code)}</p>
      </div>
    </div>
    </div>
  );
}
