"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { QrCode } from "@/features/counter/QrCode";
import Image from "next/image";
import type { PublicEntry } from "@/intake/store";
import catalog from "../../../apps/visitor-intake/data.json";
import styles from "./secret.module.css";

type Credentials = { code: string; token: string; expiresAt: number };
type DeskResponse = { code: string; expiresAt: number; entries: PublicEntry[] };
const STORE_KEY = "asad:intake:staff:v1";
const choices = { yes: "예약했다고 응답", no: "예약하지 않았다고 응답", unsure: "잘 모르겠다고 응답" };
const verifyLabels = {
  unchecked: "직원 확인 전", confirmed: "예약 증빙 확인",
  unclear: "확인 불가", exempt: "예약 불요 업무 확인",
};
const ticketLabels = { pending: "발권 판단 대기", held: "발권 보류", issued: "직원 발권 완료 기록" };

function retrieve(): Credentials | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const x = JSON.parse(raw) as Credentials;
    if (!/^[A-HJ-NP-Z2-9]{10}$/.test(x.code) || !/^[A-Za-z0-9_-]{30,128}$/.test(x.token) || x.expiresAt <= Date.now()) {
      sessionStorage.removeItem(STORE_KEY);
      return null;
    }
    return x;
  } catch { return null; }
}

export function SecretDesk() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [entries, setEntries] = useState<PublicEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const [joinUrl, setJoinUrl] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    const saved = retrieve();
    if (saved) setCredentials(saved);
  }, []);

  useEffect(() => {
    if (!credentials) { setJoinUrl(""); return; }
    setJoinUrl(new URL("/intake?desk=" + credentials.code, window.location.origin).toString());
  }, [credentials]);

  const poll = useCallback(async (creds: Credentials, signal?: AbortSignal) => {
    const res = await fetch("/api/intake/session?code=" + creds.code, {
      cache: "no-store",
      signal,
      headers: { "x-asad-intake-staff-token": creds.token },
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        sessionStorage.removeItem(STORE_KEY);
        setCredentials(null);
        setEntries([]);
        setError("접수 세션이 종료됐거나 인증 정보가 만료되었습니다.");
        return;
      }
      throw new Error("접수 연결이 불안정합니다.");
    }
    const data = await res.json() as DeskResponse;
    setEntries(data.entries);
    setConnection("live");
  }, []);

  useEffect(() => {
    if (!credentials) return;
    let stopped = false;
    let active = false;
    const ctrl = new AbortController();
    const refresh = async () => {
      if (active || stopped) return;
      active = true;
      try {
        await poll(credentials, ctrl.signal);
        if (!stopped) setError("");
      } catch {
        if (!stopped) { setConnection("offline"); setError("연결을 재시도하는 중입니다."); }
      } finally { active = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1800);
    return () => { stopped = true; ctrl.abort(); clearInterval(timer); };
  }, [credentials, poll]);

  const start = async () => {
    if (busy) return;
    setBusy(true);setError("");
    try {
      const res = await fetch("/api/intake/session", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = await res.json() as Partial<Credentials> & { staffToken?: string; error?: string };
      if (!res.ok || !data.code || !data.staffToken || !data.expiresAt) {
        throw new Error(data.error || "접수 시작 실패");
      }
      const next = { code: data.code, token: data.staffToken, expiresAt: data.expiresAt };
      sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
      setCredentials(next);setEntries([]);setSelected(null);setConnection("connecting");
    } catch (e) { setError(e instanceof Error ? e.message : "접수 시작 실패"); }
    finally { setBusy(false); }
  };

  const mark = async (seq: number, body: { verification?: PublicEntry["verification"]; ticket?: PublicEntry["ticket"] }) => {
    if (!credentials || busy) return;
    setBusy(true);setError("");
    try {
      const res = await fetch("/api/intake/session", {
        method: "PATCH", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-asad-intake-staff-token": credentials.token },
        body: JSON.stringify({ code: credentials.code, seq, ...body }),
      });
      const data = await res.json() as { entries?: PublicEntry[]; error?: string };
      if (!res.ok || !data.entries) throw new Error(data.error || "저장 실패");
      setEntries(data.entries);
    } catch (e) { setError(e instanceof Error ? e.message : "상태 갱신 실패"); }
    finally { setBusy(false); }
  };

  const end = async () => {
    if (!credentials || busy) return;
    setBusy(true);setError("");
    try {
      const res = await fetch("/api/intake/session?code=" + credentials.code, {
        method: "DELETE", credentials: "same-origin", cache: "no-store",
        headers: { "x-asad-intake-staff-token": credentials.token },
      });
      if (!res.ok && res.status !== 404) throw new Error("세션 종료에 실패했습니다.");
      sessionStorage.removeItem(STORE_KEY);
      setCredentials(null);setEntries([]);setSelected(null);setConnection("connecting");
    } catch (e) { setError(e instanceof Error ? e.message : "종료 실패"); }
    finally { setBusy(false); }
  };

  const picked = useMemo(() => entries.find(e => e.seq === selected) ?? entries.at(-1) ?? null, [entries, selected]);
  const count = entries.length;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandLogo}><Image src="/jeju-office-lockup.png" width={490} height={94} alt="제주출입국·외국인청" priority /></div><p className={styles.brand}>ASAD / STAFF</p>
        <h2>방문 목적 접수</h2>
        <p>직원용 실시간 확인</p>
        <div className={styles.sidebarNotice}>
          <p>고정 비밀번호 없음</p>
          <p>창구별 비밀 세션으로만 접수 내용을 조회할 수 있습니다.</p>
          <p>실제 민원실 운영 전 기관의 보안·운영 승인이 필요합니다.</p>
        </div>
      </aside>
      <main className={styles.main}>
        <header className={styles.heading}>
          <div>
            <p className={styles.tag}>JEJU / VISITOR INTAKE</p>
            <h1>접수 현황</h1>
            <p>iPad에서 전송한 언어·방문 목적·예약 자기신고를 확인합니다.</p>
          </div>
          <span className={styles.status}>{credentials ? (connection === "live" ? "● 실시간 연결" : "● 연결 확인 중") : "세션 미시작"}</span>
        </header>

        {error && <p className={styles.warning} role="alert">{error}</p>}

        {!credentials ? (
          <section className={styles.card}>
            <h2>새 창구 접수를 시작하세요.</h2>
            <p>고정 직원 접근키 없이 시작할 수 있습니다. 세션마다 고유한 접수 코드와 직원 전용 비밀 토큰을 발급합니다.</p>
            <p className={styles.subtle}>주소를 아는 누구나 자신의 새 창구 세션은 만들 수 있지만, 다른 세션의 접수 내용은 조회할 수 없습니다. 이 기능은 직원 신원 확인을 대신하지 않습니다.</p>
            <button className={styles.primary} onClick={() => void start()} disabled={busy}>
              {busy ? "세션 생성 중…" : "실시간 접수 시작"}
            </button>
          </section>
        ) : (
          <>
            <section className={styles.card}>
              <div className={styles.row}>
                <div>
                  <h2>iPad 연결</h2>
                  <p>iPad에서 QR코드를 열거나 접수 코드를 입력하세요.</p>
                  <strong className={styles.sessionCode}>{credentials.code}</strong>
                </div>
                <div className={styles.qrArea}>
                  {joinUrl && <QrCode value={joinUrl} label="iPad 접수 화면 연결 QR" />}
                </div>
              </div>
              <div className={styles.buttons}>
                <button onClick={() => void navigator.clipboard.writeText(joinUrl).catch(() => setError("주소를 복사하지 못했습니다."))}>iPad 연결 링크 복사</button>
                <button onClick={() => void end()} disabled={busy}>접수 세션 종료·삭제</button>
              </div>
              <p className={styles.subtle}>접수 요청은 약 2초 간격으로 갱신됩니다. 세션은 2시간 후 자동 만료됩니다. 직원 토큰은 이 브라우저 탭 안에만 보관합니다.</p>
            </section>

            <section className={styles.card}>
              <div className={styles.row}>
                <h2>실시간 접수 내역 ({count})</h2>
                <span className={styles.status}>{connection === "live" ? "연결됨" : "재연결 중"}</span>
              </div>
              {count === 0 ? <p className={styles.subtle}>아직 들어온 요청이 없습니다. iPad에서 방문 목적을 선택해 제출하면 표시됩니다.</p> : (
                <div className={styles.queue}>
                  {entries.map(e => (
                    <button
                      key={e.seq}
                      type="button"
                      className={styles.queueItem}
                      aria-pressed={picked?.seq === e.seq}
                      onClick={() => setSelected(e.seq)}
                    >
                      <span>#{String(e.seq).padStart(3,"0")} · {e.language} · {new Date(e.receivedAt).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}</span>
                      <strong>{catalog.locales.KO.services[e.serviceIndex]}</strong>
                      <small>{verifyLabels[e.verification]} · {ticketLabels[e.ticket]}</small>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {picked && (
              <section className={styles.card}>
                <div className={styles.row}>
                  <h2>요청 #{String(picked.seq).padStart(3,"0")} · 확인</h2>
                  <span className={styles.status}>{ticketLabels[picked.ticket]}</span>
                </div>
                <p className={styles.serviceTitle}>{catalog.locales.KO.services[picked.serviceIndex]}</p>
                <p>민원인 언어: {catalog.locales[picked.language].name}</p>
                <p className={styles.subtle}>민원인 화면: {catalog.locales[picked.language].services[picked.serviceIndex]}</p>
                <div className={styles.notice}>HiKorea 방문예약 자기신고: <strong>{choices[picked.booking]}</strong>. 직원 확인 결과가 아닙니다.</div>
                <h3>방문예약 직접 확인</h3>
                <p>방문예약 접수증·관서·날짜·시간·방문 목적을 별도로 확인하세요. 예약이 불필요한 업무인지도 직원이 판단합니다.</p>
                <div className={styles.buttons}>
                  <button disabled={busy} onClick={() => void mark(picked.seq,{verification:"confirmed",ticket:"pending"})}>예약 확인됨</button>
                  <button disabled={busy} onClick={() => void mark(picked.seq,{verification:"unclear",ticket:"held"})}>확인 불가 · 보류</button>
                  <button disabled={busy} onClick={() => void mark(picked.seq,{verification:"exempt",ticket:"pending"})}>예약 불요 업무</button>
                </div>
                <h3>번호표 직접 발급</h3>
                <div className={styles.buttons}>
                  <button
                    className={styles.primary}
                    disabled={busy || !["confirmed","exempt"].includes(picked.verification)}
                    onClick={() => void mark(picked.seq,{ticket:"issued"})}
                  >번호표 전달 완료 기록</button>
                  <button disabled={busy} onClick={() => void mark(picked.seq,{ticket:"held"})}>발권 보류</button>
                </div>
                <p className={styles.result}>직원 확인: {verifyLabels[picked.verification]} / 발권: {ticketLabels[picked.ticket]}</p>
                <p className={styles.disclaimer}>기록 버튼은 상태만 표시합니다. 번호표 기기를 자동 조작하지 않습니다.</p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
