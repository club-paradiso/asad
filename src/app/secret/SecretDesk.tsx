"use client";

import { useMemo, useState } from "react";
import catalog from "../../../apps/visitor-intake/data.json";
import styles from "./secret.module.css";

type Booking = "yes" | "no" | "unsure";
type Verification = "unchecked" | "confirmed" | "unclear" | "exempt";
type Ticket = "pending" | "held" | "issued";

const bookingNames: Record<Booking, string> = {
  yes: "민원인 응답: 예약함",
  no: "민원인 응답: 예약 안 함",
  unsure: "민원인 응답: 잘 모르겠음",
};

const verificationNames: Record<Verification, string> = {
  unchecked: "직원 확인 전",
  confirmed: "예약 증빙 확인됨",
  unclear: "확인 불가 · 보류",
  exempt: "예약 불요 업무로 직원 확인",
};

export function SecretDesk() {
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const response = await fetch("/api/secret/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Logout failed");
      window.location.replace("/secret");
    } catch {
      setSigningOut(false);
      window.alert("로그아웃 처리에 실패했습니다. 직원 화면을 닫고 관리자에게 알려 주세요.");
    }
  };
  const [showDemo, setShowDemo] = useState(false);
  const [serviceIndex, setServiceIndex] = useState(0);
  const [booking, setBooking] = useState<Booking>("yes");
  const [verification, setVerification] = useState<Verification>("unchecked");
  const [ticket, setTicket] = useState<Ticket>("pending");

  // This screen intentionally has no network request, queue or storage.
  // A demo is only ever created by an explicit staff click.
  const label = useMemo(() => catalog.locales.KO.services[serviceIndex], [serviceIndex]);
  const reset = () => {
    setShowDemo(false);
    setServiceIndex(0);
    setBooking("yes");
    setVerification("unchecked");
    setTicket("pending");
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <p className={styles.brand}>ASAD / STAFF DESK</p>
        <h2>방문 목적 확인</h2>
        <p>비공개 직원용</p>
        <div className={styles.sidebarNotice}>
          <p>프로토타입 / 실시간 접수 미연결</p>
          <button type="button" className={styles.signOut} onClick={() => void signOut()} disabled={signingOut}>
            {signingOut ? "로그아웃 중…" : "직원 로그아웃"}
          </button>
        </div>
      </aside>
      <main className={styles.main}>
        <header className={styles.heading}>
          <div>
            <p className={styles.tag}>JEJU · VISITOR INTAKE</p>
            <h1>방문 요청 확인</h1>
            <p>이 화면은 접근키로 보호됩니다. 실제 접수 데이터와는 아직 연결되지 않았습니다.</p>
          </div>
          <span className={styles.status}>시연 모드</span>
        </header>
        {!showDemo ? (
          <section className={styles.card}>
            <h2>연결된 방문 요청이 없습니다.</h2>
            <p>GitHub Pages의 민원인 화면은 현재 기기 내부에서만 작동합니다. ASAD에 접수 API가 연결되기 전에는 이 화면에 실제 요청이 표시되지 않습니다.</p>
            <button className={styles.primary} onClick={() => setShowDemo(true)}>
              시연용 요청 불러오기
            </button>
          </section>
        ) : (
          <>
            <section className={styles.card}>
              <div className={styles.row}>
                <h2>시연용 요청 (가상 사례)</h2>
                <button className={styles.ghost} onClick={reset}>초기화</button>
              </div>
              <label className={styles.field}>방문 목적
                <select value={serviceIndex} onChange={(e) => { setServiceIndex(Number(e.target.value)); setVerification("unchecked"); setTicket("pending"); }}>
                  {catalog.locales.KO.services.map((item, index) =>
                    <option key={index} value={index}>{String(index + 1).padStart(2, "0")}. {item}</option>,
                  )}
                </select>
              </label>
              <p className={styles.serviceTitle}>{label}</p>
              <label className={styles.field}>민원인 예약 자기신고
                <select value={booking} onChange={(e) => { setBooking(e.target.value as Booking); setVerification("unchecked"); setTicket("pending"); }}>
                  <option value="yes">{bookingNames.yes}</option>
                  <option value="no">{bookingNames.no}</option>
                  <option value="unsure">{bookingNames.unsure}</option>
                </select>
              </label>
              <p className={styles.subtle}>{bookingNames[booking]}는 예약 확인 결과가 아닙니다.</p>
            </section>

            <section className={styles.card}>
              <div className={styles.row}><h2>직원 직접 확인</h2><span className={styles.status}>{verificationNames[verification]}</span></div>
              <p>예약접수증·예약 안내 내역, 방문 관서, 날짜·시간, 방문 목적을 기관 절차에 따라 직접 확인해 주세요.</p>
              <p className={styles.subtle}>예약이 없는 경우에도 예약이 불필요한 업무인지 별도로 판단해야 합니다.</p>
              <div className={styles.buttons}>
                <button onClick={() => {setVerification("confirmed"); setTicket("pending");}}>예약 확인됨</button>
                <button onClick={() => {setVerification("unclear"); setTicket("held");}}>확인 불가 · 보류</button>
                <button onClick={() => {setVerification("exempt"); setTicket("pending");}}>예약 불요 업무 확인</button>
              </div>
            </section>

            <section className={styles.card}>
              <h2>수동 번호표 발급 판단</h2>
              <p className={styles.subtle}>직원이 직접 발권한 뒤에만 시연용 완료 상태로 변경할 수 있습니다.</p>
              <div className={styles.buttons}>
                <button
                  className={styles.primary}
                  disabled={verification !== "confirmed" && verification !== "exempt"}
                  onClick={() => setTicket("issued")}
                >번호표 전달 완료 (시연 기록)</button>
                <button onClick={() => setTicket("held")}>발권 보류</button>
              </div>
              <p className={styles.result} role="status">
                {ticket === "issued" ? "시연 상태: 직원이 번호표를 전달한 것으로 표시됨" : ticket === "held" ? "시연 상태: 발권 보류" : "발권 판단 대기"}
              </p>
              <p className={styles.disclaimer}>이 화면 자체는 번호표를 발행하거나 실제 이력을 저장하지 않습니다.</p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
