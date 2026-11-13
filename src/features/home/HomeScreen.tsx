"use client";

import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";
import { COUNTER_LANGUAGES, findLanguage } from "@/counter/languages";
import { counterPreferencesStore } from "@/features/counter/preferences";
import { useLocalStore } from "@/lib/local-store";
import { BRAND } from "@/lib/brand";
import styles from "./home.module.css";

const workflows = [
  {
    index: "01",
    context: "안내 데스크 · 민원창구 · 상담",
    problem: "외국어를 몰라도 서로 대화할 수 있게.",
    title: "실시간 대화 통역",
    detail: "각자의 언어로 이야기하세요. 방문자는 QR코드로 자기 휴대폰에서 참여할 수 있습니다.",
    href: "/counter",
    action: "대화 통역 시작",
    aside: "외국인과 직접 대화할 때",
  },
  {
    index: "02",
    context: "예배 · 강연 · 회의",
    problem: "사람이 통역할 때, AI가 옆에서 도와줘요.",
    title: "발표·강연 통역 보조",
    detail: "통역자가 직접 말하고, ASAD는 원문과 문맥, 표현 제안을 화면에 정리합니다.",
    href: "/live",
    action: "통역 보조 화면 열기",
    aside: "설교·강연을 직접 통역할 때",
  },
  {
    index: "03",
    context: "실험 기능 · 실제 기기 점검 필요",
    problem: "외국어를 한국어로 듣고 싶어요.",
    title: "이어폰으로 통역 듣기",
    detail: "자막과 이어폰 출력을 시험하는 베타 기능입니다. 실제 사용 환경에서 성능을 확인하세요.",
    href: "/listen",
    action: "베타 살펴보기",
    aside: "이어폰으로 듣고 싶을 때",
  },
] as const;

const prepTools = [
  { index: "01", href: "/prep", title: "준비 시트", detail: "설교 본문, 용어, 배경 정리" },
  { index: "02", href: "/booth-preflight", title: "부스 사전 점검", detail: "마이크와 믹서, 입력 신호 확인" },
  { index: "03", href: "/sessions", title: "지난 세션", detail: "통역 기록 확인과 내보내기" },
] as const;

export function HomeScreen() {
  return (
    <div data-surface="launcher" className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="ASAD 홈" className={styles.logo}>
          <Wordmark variant="compact" />
          <span className={styles.logoDetail}>AI 통역 보조</span>
        </Link>
        <nav className={styles.nav} aria-label="주 메뉴">
          <a href="#modes">사용 방법</a>
          <a href="#toolkit">준비 도구</a>
          <Link href="/sessions">지난 세션</Link>
        </nav>
        <Link href="/counter" className={styles.headerAction}>
          대화 통역 시작 <ArrowIcon />
        </Link>
      </header>

      <main id="main-content" className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroMain}>
            <p className={styles.heroKicker}>언어가 달라도 대화는 계속되어야 하니까.</p>
            <h1 id="hero-title" className={styles.heroTitle}>
              <span className={styles.heroTitleLead}>{BRAND.nameLead}</span>
              <span className={styles.heroTitleTail}>
                {BRAND.nameTail}<span className={styles.questionMark}>?</span>
              </span>
            </h1>
            <div className={styles.heroExplainer}>
              <span className={styles.annotation}>가장 먼저 할 일</span>
              <p>
                <strong>지금 바로 대화해야 하나요?</strong><br />
                두 사람이 각자의 언어로 말할 수 있도록 ASAD가 통역을 도와줍니다.
                발표나 설교를 직접 통역한다면 통역 보조 기능을 이용하세요.
              </p>
            </div>
            <div className={styles.heroActions}>
              <Link href="/counter" className={styles.primaryLink}>실시간 대화 통역 시작 <ArrowIcon /></Link>
              <Link href="/live" className={styles.secondaryLink}>발표·강연 통역 보조 <ArrowIcon /></Link>
            </div>
          </div>

          <aside className={styles.heroAside} aria-label="빠른 시작">
            <div className={styles.asideTop}>
              <span>바로 시작하기</span>
              <span aria-hidden="true">↘</span>
            </div>
            <p className={styles.asideQuestion}>지금 어떤 상황인가요?</p>
            <ol className={styles.asideList}>
              {workflows.map((workflow) => (
                <li key={workflow.href}>
                  <Link href={workflow.href} className={styles.asideItem}>
                    <span className={styles.asideIndex}>{workflow.index}</span>
                    <span className={styles.asideName}>{workflow.aside}</span>
                    <ArrowIcon />
                  </Link>
                </li>
              ))}
            </ol>
            <p className={styles.asideFootnote}>설치 없이 브라우저에서 시작할 수 있습니다. 마이크 사용은 해당 기능에서 직접 결정합니다.</p>
          </aside>
        </section>

        <div className={styles.ticker} aria-label="ASAD 소개">
          <span>“{BRAND.tagline}”</span>
          <span className={styles.tickerEnd}>멋진 말보다, 통하는 말.</span>
        </div>

        <section className={styles.modes} id="modes" aria-labelledby="modes-heading">
          <div className={styles.sectionIntro}>
            <div>
              <p className={styles.sectionNumber}>01 / 사용 방법</p>
              <h2 id="modes-heading">할 일부터 고르세요.</h2>
            </div>
            <p>가장 자주 쓰는 대화 통역부터, 전문 통역 보조와 베타 기능까지.</p>
          </div>
          <div className={styles.workflowList}>
            {workflows.map((workflow) => (
              <Link href={workflow.href} key={workflow.href} className={`${styles.workflow} ${workflow.href === "/counter" ? styles.featuredWorkflow : ""}`}>
                <span className={styles.workflowIndex}>{workflow.index}</span>
                <div className={styles.workflowBody}>
                  <span className={styles.workflowContext}>{workflow.href === "/counter" ? "대표 기능 · " : ""}{workflow.context}</span>
                  <h3>{workflow.problem}</h3>
                  <p>{workflow.detail}</p>
                </div>
                <div className={styles.workflowAction}>
                  <span>{workflow.title}</span>
                  <span className={styles.workflowArrow}><ArrowIcon /></span>
                  <small>{workflow.action}</small>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className={styles.toolkit} id="toolkit" aria-labelledby="toolkit-heading">
          <div className={styles.sectionIntro}>
            <div>
              <p className={styles.sectionNumber}>02 / 시작 전 준비</p>
              <h2 id="toolkit-heading">시작 전에 챙길 것.</h2>
            </div>
            <p>현장에서 필요한 건 화려한 화면보다 잘 정리된 준비입니다.</p>
          </div>
          <div className={styles.toolkitGrid}>
            <div className={styles.toolList}>
              {prepTools.map((tool) => (
                <Link key={tool.href} href={tool.href} className={styles.tool}>
                  <span>{tool.index}</span>
                  <span className={styles.toolContent}><strong>{tool.title}</strong><small>{tool.detail}</small></span>
                  <ArrowIcon />
                </Link>
              ))}
            </div>
            <DefaultLanguageSetting />
          </div>
        </section>

        <aside className={styles.caution} aria-label="사용 전 안내">
          <span className={styles.cautionMark} aria-hidden="true">※</span>
          <p>AI의 표현은 참고용입니다. 이름, 날짜, 숫자, 부정 표현 등 중요한 내용은 <strong>반드시 사람이 확인하세요.</strong></p>
        </aside>
      </main>

      <footer className={styles.footer}>
        <div><span className={styles.footerName}>ASAD<span>?</span></span><p>{BRAND.secondaryMark}</p></div>
        <div className={styles.footerRight}>
          <span>현장 응대 기록은 세션 동안만 임시 보관됩니다.</span>
          <span>사람이 말하고, 사람이 최종 확인합니다.</span>
        </div>
      </footer>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20" fill="none">
      <path d="M3.5 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DefaultLanguageSetting() {
  const [preferences, setPreferences] = useLocalStore(counterPreferencesStore);
  const selected = findLanguage(preferences.hostLang) ?? COUNTER_LANGUAGES[0];

  return (
    <section className={styles.language} aria-labelledby="default-language-label">
      <p className={styles.languageNote}>현장 응대 설정</p>
      <h3 id="default-language-label">직원이 사용하는 언어</h3>
      <p className={styles.languageHelp}>기본 언어는 여기서 미리 지정할 수 있습니다.</p>
      <label className={styles.languageField}>
        <span className="sr-only">기본 언어 선택</span>
        <select
          value={selected.code}
          onChange={(event) => setPreferences({ ...preferences, hostLang: event.target.value })}
        >
          {COUNTER_LANGUAGES.map((language) => (
            <option key={language.code} value={language.code}>{language.ko} · {language.endonym}</option>
          ))}
        </select>
        <span aria-hidden="true">⌄</span>
      </label>
      <p className={styles.languageStatus}>현재 {selected.ko}로 설정됨 · 발표·강연 통역 보조는 현재 한국어 → 영어 고정</p>
    </section>
  );
}
