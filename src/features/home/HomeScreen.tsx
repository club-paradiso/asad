"use client";

import Link from "next/link";
import { useState } from "react";
import { Wordmark } from "@/components/brand/Wordmark";
import { COUNTER_LANGUAGES, findLanguage } from "@/counter/languages";
import { counterPreferencesStore } from "@/features/counter/preferences";
import { useLocalStore } from "@/lib/local-store";
import { BRAND } from "@/lib/brand";
import styles from "./home.module.css";

const scenes = [
  {
    id: "live",
    number: "01",
    name: "예배·행사 통역",
    short: "여러 사람 앞에서",
    channel: "INTERPRETER / LIVE",
    sourceLabel: "KO / ORIGINAL",
    targetLabel: "EN / SUGGESTION",
    source: "오늘 우리는 서로의 이야기를 듣는 것에서 시작합니다.",
    translated: "We begin today by ",
    emphasis: "listening to one another.",
    question: "내 목소리로 통역하고, ASAD의 도움을 받고 싶다면.",
    description: "통역자가 직접 말하는 동안 원문 흐름과 영어 표현 제안을 함께 확인하는 방식입니다.",
    steps: ["마이크·입력 경로 확인", "본문과 용어 사전 준비", "라이브 통역 시작"],
    href: "/live",
    preparation: "/booth-preflight",
    preparationLabel: "장비 먼저 점검",
    action: "라이브 통역 시작",
  },
  {
    id: "counter",
    number: "02",
    name: "일대일 현장 응대",
    short: "마주 보고 대화할 때",
    channel: "COUNTER / FACE TO FACE",
    sourceLabel: "KO / ORIGINAL",
    targetLabel: "EN / EXAMPLE",
    source: "예약 내역을 함께 확인해 볼게요.",
    translated: "Let's check ",
    emphasis: "your reservation together.",
    question: "서로 다른 언어로, 같은 자리에서 대화해야 한다면.",
    description: "직원은 자신의 기기를 사용하고, 방문자는 QR로 참여하는 대면 대화 흐름입니다.",
    steps: ["직원 기본 언어 선택", "방문자에게 QR 코드 공유", "대화 내용 함께 확인"],
    href: "/counter",
    preparation: "/counter",
    preparationLabel: "현장 응대 설정",
    action: "현장 응대 시작",
  },
  {
    id: "listen",
    number: "03",
    name: "이어폰 청취",
    short: "내 귀로 듣고 싶을 때",
    channel: "EARBUD / EXPERIMENTAL",
    sourceLabel: "EN / ORIGINAL",
    targetLabel: "KO / EXAMPLE",
    source: "The meeting will begin in five minutes.",
    translated: "회의는 ",
    emphasis: "5분 후에 시작합니다.",
    question: "외국어 발화를 한국어로 듣는 방식을 시험해 보고 싶다면.",
    description: "한국어 자막과 이어폰 출력을 사용하는 실험 기능입니다. 실제 기기에서 확인이 필요합니다.",
    steps: ["이어폰과 출력 장치 확인", "권한 및 지원 환경 확인", "베타 기능 시험"],
    href: "/listen",
    preparation: "/listen",
    preparationLabel: "베타 안내 보기",
    action: "이어폰 베타 열기",
  },
] as const;

type SceneId = (typeof scenes)[number]["id"];

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
  const [sceneId, setSceneId] = useState<SceneId>("live");
  const scene = scenes.find((entry) => entry.id === sceneId) ?? scenes[0];

  return (
    <div data-surface="launcher" className={styles.page}>
      <div className={styles.ambientGrid} aria-hidden="true" />
      <header className={styles.header}>
        <Link href="/" aria-label="ASAD 홈" className={styles.logo}>
          <Wordmark variant="compact" />
          <span className={styles.logoDescriptor}>INTERPRETATION COPILOT</span>
        </Link>

        <nav aria-label="주 메뉴" className={styles.nav}>
          <a href="#finder">시작점 찾기</a>
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
            <p className={styles.eyebrow}><span className={styles.eyebrowDot} aria-hidden="true" /> MADE FOR PEOPLE, NOT REPLACEMENT.</p>
            <h1 id="hero-title" className={styles.heroTitle}>
              말은 흘러가도,<br />
              <span className={styles.heroHighlight}>의미는 이어지게</span><span className={styles.period}>.</span>
            </h1>
            <p className={styles.heroSubcopy}>
              말을 알아듣는 순간부터, 다른 언어로 전하는 순간까지.
              사람의 판단을 중심에 두고, ASAD가 그 사이를 돕습니다.
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

          <div className={styles.previewWrap} data-scene={scene.id}>
            <div className={styles.sceneOverline}>
              <span>THE TRANSLATION SPACE</span>
              <span>INTERACTIVE PREVIEW / 03</span>
            </div>
            <div className={styles.preview}>
              <div className={styles.previewTop}>
                <span className={styles.previewApp}><span className={styles.previewDot} aria-hidden="true" /> ASAD / SIGNAL STUDIO</span>
                <span className={styles.previewDemo}>시뮬레이션 · 실제 통역 아님</span>
              </div>
              <div className={styles.sceneTabs} role="group" aria-label="통역 시나리오 미리보기">
                {scenes.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={styles.sceneTab}
                    aria-pressed={sceneId === entry.id}
                    onClick={() => setSceneId(entry.id)}
                  >
                    <span>{entry.number}</span>
                    {entry.name}
                  </button>
                ))}
              </div>
              <div className={styles.previewBody} aria-live="polite" aria-atomic="true">
                <div className={styles.previewLabelRow}>
                  <span>{scene.channel}</span>
                  <span>SIMULATED</span>
                </div>
                <div className={styles.previewSpeech}>
                  <span className={styles.previewField}>{scene.sourceLabel}</span>
                  <p className={styles.previewKorean}>{scene.source}</p>
                </div>
                <div className={styles.signalDivider} aria-hidden="true">
                  <span className={styles.signalDot} />
                  <span className={styles.signalTrack} />
                  <span className={styles.signalCaption}>HUMAN IN CONTROL</span>
                </div>
                <div className={styles.previewSpeech}>
                  <span className={styles.previewField}>{scene.targetLabel}</span>
                  <p className={styles.previewEnglish}>{scene.translated}<span>{scene.emphasis}</span></p>
                </div>
              </div>
              <div className={styles.previewFoot}>
                <div className={styles.wave} aria-hidden="true">
                  {waveHeights.map((height, index) => (
                    <i key={index} style={{ height: String(height) + "%" }} />
                  ))}
                </div>
                <div className={styles.previewFootText}>
                  <span>장면 전환은 예시만 변경합니다. 마이크는 켜지지 않습니다.</span>
                  <span>DEMO / NOT LIVE</span>
                </div>
              </div>
            </div>
            <div className={styles.previewUnder}>
              <span><span className={styles.previewUnderDot} aria-hidden="true" /> VOICES CONNECTED BY PEOPLE</span>
              <Link href={scene.href} className={styles.previewLaunch}>
                {scene.action} <ArrowIcon />
              </Link>
            </div>
          </div>
        </section>

        <section className={styles.finder} id="finder" aria-labelledby="finder-title">
          <div className={styles.finderIntro}>
            <span className={styles.sectionKicker}>00 / FIND YOUR FLOW</span>
            <h2 id="finder-title">지금 당신의 상황은?</h2>
            <p>기능 이름을 외울 필요 없습니다. 현재 필요한 일을 선택하면 출발점을 알려드립니다.</p>
          </div>
          <div className={styles.finderShell}>
            <div className={styles.finderOptions} role="group" aria-label="사용 상황 선택">
              {scenes.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className={styles.finderOption}
                  aria-pressed={scene.id === entry.id}
                  onClick={() => setSceneId(entry.id)}
                >
                  <span className={styles.finderNumber}>{entry.number}</span>
                  <span><strong>{entry.short}</strong><small>{entry.name}</small></span>
                  <span className={styles.finderOptionArrow} aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
            <div className={styles.finderResult} aria-live="polite" aria-atomic="true">
              <p className={styles.finderResultEyebrow}>RECOMMENDED / {scene.channel}</p>
              <h3>{scene.question}</h3>
              <p className={styles.finderResultCopy}>{scene.description}</p>
              <ol className={styles.finderSteps}>
                {scene.steps.map((step, index) => (
                  <li key={step}><span>0{index + 1}</span>{step}</li>
                ))}
              </ol>
              <div className={styles.finderResultActions}>
                <Link href={scene.href} className={styles.finderPrimary}>
                  {scene.action} <ArrowIcon />
                </Link>
                <Link href={scene.preparation} className={styles.finderSecondary}>
                  {scene.preparationLabel}
                </Link>
              </div>
            </div>
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
