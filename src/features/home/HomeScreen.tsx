"use client";

import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";
import { COUNTER_LANGUAGES, findLanguage } from "@/counter/languages";
import { counterPreferencesStore } from "@/features/counter/preferences";
import { useLocalStore } from "@/lib/local-store";
import { BRAND } from "@/lib/brand";
import styles from "./home.module.css";

const waveHeights = [30, 45, 27, 66, 42, 81, 57, 34, 71, 49, 90, 54, 36, 74, 55, 28, 61, 42, 76, 37, 52, 32, 64, 40];

const modeLinks = [
  {
    number: "01",
    category: "FOR THE INTERPRETER",
    title: "라이브 통역",
    english: "Live interpretation",
    description: "한국어 설교·강연·회의를 듣고 영어 통역에 필요한 문맥과 표현을 확인하세요.",
    meta: "한국어 → 영어 · 사람 통역자용",
    href: "/live",
    action: "라이브 통역 시작",
    featured: true,
  },
  {
    number: "02",
    category: "FACE TO FACE",
    title: "현장 응대",
    english: "Counter interpretation",
    description: "직원과 방문객이 서로 다른 언어를 쓸 때, 한 화면에서 대화를 주고받으세요.",
    meta: "다국어 · QR 참여",
    href: "/counter",
    action: "현장 응대 시작",
    featured: false,
  },
  {
    number: "03",
    category: "EXPERIMENTAL",
    title: "이어폰 통역",
    english: "Earbud mode",
    description: "외국어를 한국어 음성으로 들을 수 있도록 준비한 실험적 모드입니다.",
    meta: "베타 · 실제 기기 검증 필요",
    href: "/listen",
    action: "베타 살펴보기",
    featured: false,
  },
] as const;

const tools = [
  { number: "01", href: "/prep", title: "준비 시트", subtitle: "본문과 용어, 문맥을 미리 정리", mark: "PREP" },
  { number: "02", href: "/booth-preflight", title: "부스 사전 점검", subtitle: "마이크·믹서 입력과 신호 확인", mark: "CHECK" },
  { number: "03", href: "/sessions", title: "지난 세션", subtitle: "통역 기록 복기와 내보내기", mark: "REVIEW" },
] as const;

export function HomeScreen() {
  return (
    <div data-surface="launcher" className={styles.page}>
      <div className={styles.ambientGrid} aria-hidden="true" />
      <header className={styles.header}>
        <Link href="/" aria-label="ASAD 홈" className={styles.logo}>
          <Wordmark variant="compact" />
          <span className={styles.logoDescriptor}>INTERPRETATION COPILOT</span>
        </Link>

        <nav aria-label="주 메뉴" className={styles.nav}>
          <a href="#workflows">사용 모드</a>
          <a href="#toolkit">시작 전 준비</a>
          <Link href="/booth-preflight">장비 점검</Link>
        </nav>
        <Link href="/live" className={styles.headerAction}>
          통역 시작 <ArrowIcon />
        </Link>
      </header>

      <main id="main-content" className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span className={styles.eyebrowDot} aria-hidden="true" /> HUMAN FIRST. AI ASSISTED.</p>
            <h1 id="hero-title" className={styles.heroTitle}>
              말을 듣는 동안,<br />
              <span className={styles.heroHighlight}>다음 문장</span>을<br />
              준비합니다<span className={styles.period}>.</span>
            </h1>
            <p className={styles.heroSubcopy}>
              실시간 통역은 사람이 합니다. ASAD는 흘러가는 말을 붙잡고,
              문맥과 표현을 한눈에 확인할 수 있게 돕습니다.
            </p>
            <p className={styles.heroTagline}>{BRAND.tagline}</p>
            <div className={styles.heroActions}>
              <Link href="/live" className={styles.primaryButton}>
                라이브 통역 시작 <ArrowIcon />
              </Link>
              <Link href="/counter" className={styles.secondaryButton}>
                현장 응대 열기 <ArrowIcon />
              </Link>
            </div>
            <div className={styles.heroMeta}>
              <span>설치 없이 브라우저에서</span>
              <span className={styles.metaDivider} aria-hidden="true" />
              <span>통역자가 최종 확인</span>
            </div>
          </div>

          <div className={styles.previewWrap}>
            <div className={styles.previewFloat} aria-hidden="true">ASAD <span>↗</span></div>
            <div className={styles.preview} role="img" aria-label="ASAD 라이브 통역 화면의 설명용 예시. 실제 음성 인식이 진행 중인 화면은 아닙니다.">
              <div className={styles.previewTop}>
                <span className={styles.previewApp}><span className={styles.previewDot} aria-hidden="true" /> ASAD / CONSOLE</span>
                <span className={styles.previewDemo}>화면 예시</span>
              </div>
              <div className={styles.previewBody}>
                <div className={styles.previewLabelRow}>
                  <span>01 / ORIGINAL</span>
                  <span>KO</span>
                </div>
                <p className={styles.previewKorean}>오늘 우리는 서로의 이야기를 듣는 것에서 시작합니다.</p>
                <div className={styles.previewRule} />
                <div className={styles.previewLabelRow}>
                  <span>02 / INTERPRETATION HINT</span>
                  <span>EN</span>
                </div>
                <p className={styles.previewEnglish}>
                  We begin today by <span>listening to one another.</span>
                </p>
              </div>
              <div className={styles.previewFoot}>
                <div className={styles.wave} aria-hidden="true">
                  {waveHeights.map((height, index) => (
                    <i key={index} style={{ height: String(height) + "%" }} />
                  ))}
                </div>
                <div className={styles.previewFootText}>
                  <span>사람이 듣고, 판단하고, 말합니다.</span>
                  <span>DEMO / NOT LIVE</span>
                </div>
              </div>
            </div>
            <p className={styles.previewCaption}>FIG. 01 <span>사람을 중심에 둔 통역 도구</span></p>
          </div>
        </section>

        <section className={styles.modesSection} id="workflows" aria-labelledby="workflows-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.sectionKicker}>01 / CHOOSE YOUR FLOW</p>
              <h2 id="workflows-heading">지금, 어떤 통역이 필요한가요?</h2>
            </div>
            <p>사용하는 장소와 상황에 맞는 모드를 선택하세요.<br />상황에 따라 필요한 도구가 달라집니다.</p>
          </div>
          <div className={styles.modeGrid}>
            {modeLinks.map((mode) => (
              <Link
                href={mode.href}
                key={mode.href}
                className={[styles.modeCard, mode.featured ? styles.modeCardFeatured : ""].join(" ")}
              >
                <div className={styles.modeTop}>
                  <span>{mode.number} / {mode.category}</span>
                  <span className={styles.modeArrow}><ArrowIcon /></span>
                </div>
                <div>
                  <p className={styles.modeEnglish}>{mode.english}</p>
                  <h3>{mode.title}</h3>
                  <p className={styles.modeDescription}>{mode.description}</p>
                </div>
                <div className={styles.modeBottom}>
                  <span>{mode.meta}</span>
                  <span className={styles.modeCta}>{mode.action}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className={styles.toolkitSection} id="toolkit" aria-labelledby="toolkit-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.sectionKicker}>02 / GET READY</p>
              <h2 id="toolkit-heading">시작하기 전에, 필요한 것만.</h2>
            </div>
            <p>통역 중에 헤매지 않도록<br />준비와 확인을 미리 끝내세요.</p>
          </div>
          <div className={styles.toolkitGrid}>
            <div className={styles.toolsPanel}>
              {tools.map((tool) => (
                <Link href={tool.href} key={tool.href} className={styles.toolRow}>
                  <span className={styles.toolNumber}>{tool.number}</span>
                  <span className={styles.toolText}>
                    <strong>{tool.title}</strong>
                    <small>{tool.subtitle}</small>
                  </span>
                  <span className={styles.toolMark}>{tool.mark}</span>
                  <ArrowIcon />
                </Link>
              ))}
            </div>
            <DefaultLanguageSetting />
          </div>
        </section>

        <aside className={styles.endnote} aria-label="사용 전 안내">
          <span className={styles.endnoteSymbol} aria-hidden="true">?</span>
          <p>AI의 제안은 참고 자료입니다. 숫자, 이름, 부정 표현, 중요한 사실은 <strong>반드시 사람이 확인하세요.</strong></p>
          <span className={styles.endnoteIndex}>HUMAN IN THE LOOP / ALWAYS</span>
        </aside>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <span>ASAD<span className={styles.footerDot}>.</span></span>
          <small>{BRAND.secondaryMark}</small>
        </div>
        <div className={styles.footerInfo}>
          <span>현장 응대 기록은 세션 동안만 임시 보관됩니다.</span>
          <span>AI 통역 보조 · 최종 판단은 사용자에게</span>
        </div>
      </footer>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="20" height="20">
      <path d="M4 10h11m-4.5-4.5L15 10l-4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DefaultLanguageSetting() {
  const [preferences, setPreferences] = useLocalStore(counterPreferencesStore);
  const selected = findLanguage(preferences.hostLang) ?? COUNTER_LANGUAGES[0];

  return (
    <section aria-labelledby="default-language-label" className={styles.languagePanel}>
      <div className={styles.languageHeader}>
        <span className={styles.languageIcon} aria-hidden="true">文</span>
        <span>SETTING / COUNTER MODE</span>
      </div>
      <h3 id="default-language-label">기본 언어 설정</h3>
      <p className={styles.languageDescription}>현장 응대에서 직원이 사용하는 언어를 지정하세요.</p>
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
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="18" height="18"><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </label>
      <p className={styles.languageStatus}>현재 {selected.ko}로 설정됨 · 라이브 통역은 현재 한국어 → 영어 고정</p>
    </section>
  );
}
