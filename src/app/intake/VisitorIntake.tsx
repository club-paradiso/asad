"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import catalog from "../../../apps/visitor-intake/data.json";
import styles from "./intake.module.css";

type Language = keyof typeof catalog.locales;
type Booking = "yes" | "no" | "unsure";
type Stage = "connect" | "language" | "services" | "review" | "sent";
type ApiResponse = { accepted?: boolean; seq?: number; error?: string };
const LANGS: Language[] = ["KO","EN","ZH-CN","ID","HI","VI","JA","TH","RU","FIL","SI","KM","MY","MN","NE"];
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{10}$/;

export function VisitorIntake({ initialCode = "" }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode);
  const [codeDraft, setCodeDraft] = useState(initialCode);
  const [stage, setStage] = useState<Stage>(initialCode ? "language" : "connect");
  const [lang, setLang] = useState<Language>("KO");
  const [languagePage, setLanguagePage] = useState(0);
  const [servicePage, setServicePage] = useState(0);
  const [service, setService] = useState<number | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [pending, setPending] = useState(false);
  const [submittedSeq, setSubmittedSeq] = useState<number | null>(null);
  const [error, setError] = useState("");
  // Kept across retries so a slow response or double tap never creates duplicate entries.
  const [requestId, setRequestId] = useState("");

  const locale = catalog.locales[lang];
  const labels = locale.review;
  const selectedName = useMemo(
    () => service === null ? "" : locale.services[service],
    [locale, service],
  );

  function connect() {
    const candidate = codeDraft.trim().toUpperCase();
    if (!CODE_PATTERN.test(candidate)) {
      setError("직원 화면에 표시된 10자리 접수 코드를 확인해 주세요.");
      return;
    }
    setError("");setCode(candidate);setStage("language");
  }

  function startNext() {
    setLang("KO");setLanguagePage(0);setServicePage(0);
    setService(null);setBooking(null);setSubmittedSeq(null);
    setRequestId("");setError("");setStage("language");
  }

  async function submit() {
    if (pending || service === null || booking === null || !CODE_PATTERN.test(code)) return;
    setPending(true);setError("");
    const id = requestId || crypto.randomUUID();
    if (!requestId) setRequestId(id);
    try {
      const res = await fetch("/api/intake/submission", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code, requestId: id, language: lang, serviceIndex: service, booking,
        }),
      });
      const payload = await res.json() as ApiResponse;
      if (!res.ok || !payload.accepted || !payload.seq) {
        throw new Error(payload.error || "직원에게 전달하지 못했습니다.");
      }
      setSubmittedSeq(payload.seq);setStage("sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "전송에 실패했습니다. 다시 시도해 주세요.");
    } finally { setPending(false); }
  }

  const head = (
    <header className={styles.header}>
      <div className={styles.brand}><Image src="/jeju-office-lockup.png" width={490} height={94} alt="제주출입국·외국인청" priority /><span>VISITOR INTAKE · 시범 운영</span></div>
      {code && <span className={styles.codeBadge}>창구 {code}</span>}
    </header>
  );
  return (
    <div className={styles.shell}>
      {head}
      <main className={styles.main}>
        {stage === "connect" ? (
          <>
            <section className={styles.hero}><p className={styles.step}>01 · COUNTER PAIRING</p><h1>직원 창구와 연결</h1><p>직원이 보여주는 QR코드를 스캔하거나 10자리 접수 코드를 입력하세요.</p></section>
            <section className={styles.panel}>
              <label className={styles.codeLabel} htmlFor="intake-code">직원 접수 코드</label>
              <input
                id="intake-code" className={styles.codeInput} autoCapitalize="characters"
                autoComplete="off" spellCheck={false} maxLength={10}
                value={codeDraft} onChange={e=>setCodeDraft(e.target.value.toUpperCase())}
                placeholder="예: ABCD234567"
              />
              <button className={styles.primary} onClick={connect}>언어 선택 시작 →</button>
            </section>
          </>
        ) : stage === "language" ? (
          <>
            <section className={styles.hero}><p className={styles.step}>01 / 03 · LANGUAGE</p><h1>사용할 언어를 선택하세요</h1><p>Choose your language · 15 languages available</p></section>
            <div className={styles.grid}>
              {LANGS.slice(languagePage*6,languagePage*6+6).map(value=>(
                <button className={styles.tile} lang={value.toLowerCase().split("-")[0]} key={value} onClick={()=>{
                  setLang(value);setServicePage(0);setService(null);setBooking(null);setStage("services");
                }}>{catalog.locales[value].name}<span aria-hidden="true">→</span></button>
              ))}
            </div>
            <div className={styles.actions}><button className={styles.primary} onClick={()=>setLanguagePage((languagePage+1)%Math.ceil(LANGS.length/6))}>
              {languagePage===2 ? "← 처음 6개 언어" : `다른 언어 보기 ${languagePage*6+7}–${Math.min((languagePage+2)*6,LANGS.length)} →`}
            </button></div>
          </>
        ) : stage === "services" ? (
          <>
            <section className={styles.hero}><p className={styles.step}>02 / 03 · SERVICE</p><h1>{locale.heading[servicePage]}</h1><p>{locale.instructions[servicePage]}</p></section>
            <div className={styles.grid}>
              {locale.services.slice(servicePage===0?0:10,servicePage===0?10:locale.services.length).map((name,i)=>{
                const idx = i + (servicePage===0?0:10);
                return <button className={styles.tile} key={idx} onClick={()=>{setService(idx);setBooking(null);setRequestId("");setStage("review");}}>
                  <span className={styles.number}>{String(idx+1).padStart(2,"0")}</span><span>{name}</span>
                </button>;
              })}
            </div>
            <div className={styles.actions}>
              <button className={styles.primary} onClick={()=>setServicePage(servicePage===0?1:0)}>{servicePage===0?`More services 11–${locale.services.length} →`:"← Services 01–10"}</button>
              <button className={styles.secondary} onClick={()=>setStage("language")}>← Language</button>
            </div>
          </>
        ) : stage === "review" ? (
          <>
            <section className={styles.hero}><p className={styles.step}>03 / 03 · REVIEW</p><h1>{labels.reviewTitle}</h1><p>{labels.reviewHelp}</p></section>
            <section className={styles.panel}>
              <p className={styles.step}>{labels.serviceLabel}</p>
              <h2>{selectedName}</h2>
              {lang!=="KO" && service!==null && <p className={styles.subtle}>{catalog.locales.KO.services[service]}</p>}
            </section>
            {service===19 && <p className={styles.disclaimer}>{labels.phoneChangeNote}</p>}
            <h2 className={styles.question}>{labels.reservationTitle}</h2>
            <p className={styles.subtle}>{labels.reservationHelp}</p>
            <div className={styles.choices}>
              {(["yes","no","unsure"] as const).map((value,i)=>{
                const options=[labels.answerYes, labels.answerNo, labels.answerUnsure];
                return <button key={value} aria-pressed={booking===value} onClick={()=>{setBooking(value);setRequestId("");}}>{options[i]}</button>;
              })}
            </div>
            <p className={styles.disclaimer}>민원인 응답은 예약 확인 결과가 아닙니다. 성명·여권번호는 입력하지 않습니다.</p>
            <div className={styles.actions}>
              <button className={styles.primary} disabled={pending || booking===null} onClick={()=>void submit()}>
                {pending?"직원에게 전달 중…":"직원 화면으로 전송 →"}
              </button>
              <button className={styles.secondary} disabled={pending} onClick={()=>setStage("services")}>← Back</button>
            </div>
          </>
        ) : (
          <>
            <section className={styles.hero}><p className={styles.step}>REQUEST DELIVERED</p><h1>{labels.waitingTitle}</h1><p>직원 화면에 요청을 전달했습니다.</p></section>
            <section className={styles.panel}>
              <p className={styles.step}>접수 요청 ID #{submittedSeq}</p>
              <h2>{selectedName}</h2>
              <p>{labels.waitingTicket}</p>
              {service===19 && <p className={styles.disclaimer}>{labels.phoneChangeNote}</p>}
              <p className={styles.subtle}>위 번호는 접수 요청 식별번호일 뿐 번호표 번호가 아닙니다.</p>
            </section>
            <div className={styles.notice}>직원이 예약 증빙과 방문 목적을 확인한 뒤 직접 번호표를 발급합니다.</div>
            <div className={styles.actions}><button className={styles.primary} onClick={startNext}>다음 민원인 · 처음으로 →</button></div>
          </>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </main>
      <footer className={styles.footer}>
        <span>안내 시범 운영 · 개인정보 입력 금지</span>
        <span>번호표는 직원 확인 후 직접 발급</span>
        {stage !== "connect" && <button type="button" onClick={() => {setStage("connect");setCode("");setCodeDraft("");setError("");}}>창구 변경</button>}
      </footer>
    </div>
  );
}
