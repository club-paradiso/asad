# 아무튼서로알아들었으면된거아닌가요 (ASAD)

> **정확한지는 모르겠고, 아무튼 알아들었어요.**
>
> 라이브 통역과 현장 응대를 위한 AI 통역 보조 서비스.

ASAD는 통역사를 없애거나 사람 사이의 대화를 자동 번역 자막으로 대체하려는 프로젝트가 아닙니다.

한 사람이 계속 말하는 상황에서는 **통역사가 놓치기 쉬운 맥락, 용어, 고유명사, 성경 구절, 말장난과 문장 구조를 보조**하고, 창구나 현장에서는 **서로 다른 언어를 쓰는 두 사람이 각자의 기기로 대화할 수 있는 짧은 통역 세션**을 만듭니다.

프로젝트의 한국어 정식 명칭은 **아무튼서로알아들었으면된거아닌가요**이고, 기술 문맥에서는 짧게 **ASAD**를 사용합니다.

- **Live Interpretation**: 설교, 강연, 회의처럼 한 명의 발화를 사람이 실시간으로 옮기는 상황
- **Counter Mode**: 민원실, 안내 데스크, 접수창구처럼 두 사람이 마주 앉아 주고받는 상황
- **Prep / Booth Preflight / Sessions**: 통역 전 준비, 장비 점검, 세션 복기와 내보내기

> **Project status:** Active development. 실제 서비스 투입 전에는 반드시 `/diagnostics`와 현장 장비 테스트를 확인하세요.

---

## 왜 ASAD인가

일반적인 음성 번역 UI는 보통 `음성 인식 -> 번역 -> 자막`을 전제로 합니다. 하지만 동시통역과 현장 응대는 그보다 훨씬 까다롭습니다.

통역사는 이미 몇 초 뒤처진 채 다음 말을 듣고 있고, 이전 문장을 다시 읽을 시간도 없습니다. 창구에서는 날짜, 시간, 금액, 이름 하나가 틀리는 것만으로도 실제 업무가 꼬일 수 있습니다. 그래서 ASAD는 "문장을 예쁘게 번역하는 것"보다 **현장에서 언제, 무엇을, 얼마나 확실하게 보여줄 것인가**를 더 중요하게 취급합니다.

### Live의 원칙

- **Temporal locking**: 이미 통역사가 말했을 가능성이 높은 문장은 뒤늦게 조용히 고치지 않습니다. 중요한 수정은 별도 correction으로 붙습니다.
- **안전한 출력과 예상 출력 분리**: 아직 확정되지 않은 예상은 시각적으로 확정 번역과 구분됩니다.
- **짧은 발화 단위**: 긴 산문보다 실제로 입 밖에 낼 수 있는 짧은 thought unit을 우선합니다.
- **한국어 지연 구조 대응**: 술어가 늦게 나오는 한국어 문장을 무작정 기다리지 않고 안전한 문장 골격을 먼저 제시할 수 있습니다.
- **고유명사 교정**: 한 번 수정한 이름이나 용어를 이후 인식과 표기에 반영합니다.
- **성경 구절 보호**: 라이선스 없이 성경 본문을 지어내지 않습니다. 기본값은 reference-only입니다.

### Counter의 원칙

- **양쪽 화면에 양쪽 언어를 함께 표시**해 서로 번역 오류를 확인할 수 있게 합니다.
- **자주 쓰는 빠른 문구는 모델을 거치지 않고 고정 번역**으로 처리할 수 있습니다.
- **숫자, 날짜, 시간, 금액, 이름 같은 위험 값**을 별도로 확인하기 쉽게 만듭니다.
- **음성 인식 결과를 보내기 전에 직접 수정**할 수 있습니다. 고유명사나 인명 인식이 틀렸는데 그대로 번역기로 보내는 고전적인 참사를 줄이기 위한 장치입니다.
- 번역이 실패하면 실패했다고 표시합니다. 번역이 아닌 문자열을 그럴듯한 번역처럼 내보내지 않습니다.
- 방문자가 세션을 종료하면 방문자 화면은 종료 상태로 전환되고, 직원 측 호스트 화면은 유지됩니다.

---

## 주요 화면

| 경로 | 용도 |
| --- | --- |
| `/` | ASAD 런처 |
| `/live` | 라이브 통역 콘솔 |
| `/counter` | 현장 응대 호스트 화면 |
| `/c/...` | QR로 참가하는 방문자 화면 |
| `/prep` | 설교자, 본문, 용어 등 사전 준비 |
| `/booth-preflight` | 믹서 입력, 신호 레벨, mix-minus 등 부스 사전 점검 |
| `/sessions` | 저장한 라이브 세션 복기 및 내보내기 |
| `/diagnostics` | 실제 STT/LLM/보안/스토리지 구성 확인 |

홈 화면은 현재 **라이브 통역**, **현장 응대**, **준비 시트**, **부스 사전 점검**, **지난 세션**으로 진입점을 나눕니다.

---

## Counter Mode 지원 언어

Counter UI는 현재 24개 언어를 제공합니다.

한국어, 영어, 중국어 간체/번체, 일본어, 베트남어, 태국어, 인도네시아어, 러시아어, 우즈베크어, 몽골어, 네팔어, 크메르어, 미얀마어, 타갈로그어, 스페인어, 프랑스어, 독일어, 포르투갈어, 아랍어, 힌디어, 벵골어, 우르두어, 터키어.

방문자 언어 선택기는 각 언어를 **자기 언어 표기(endonym)** 로 보여줍니다. 브라우저 SpeechRecognition 지원 수준은 언어와 브라우저마다 다르며, 일부 언어는 음성보다 텍스트 입력이 더 안정적입니다.

Counter 음성 인식은 기본 인식 경로가 실패했을 때 선택적으로 **Hugging Face Whisper STT fallback**을 사용할 수 있습니다. 민감 프로필에서는 이 폴백이 차단되며, 음성은 짧은 WAV로 메모리에서 처리됩니다.

---

## 30초 만에 실행하기

```bash
npm install
npm run dev
```

브라우저에서 다음 주소를 엽니다.

```text
http://localhost:3000
```

API 키가 없어도 앱 자체는 실행됩니다. 기본 설정은 외부 유료 API에 의존하지 않도록 설계되어 있고, 라이브 통역은 demo/local 경로로 확인할 수 있습니다.

환경 변수 템플릿:

```bash
cp .env.example .env.local
```

`.env.local`은 커밋하지 마세요.

---

## 무료 라이브 구성

실제 마이크 입력을 최대한 무료로 시험하려면 다음과 같이 시작할 수 있습니다.

```bash
STT_PROVIDER=webspeech
LLM_ROUTING_MODE=auto-free
GEMINI_API_KEY=your-free-key
BIBLE_PROVIDER=reference-only
```

- Web Speech API는 브라우저 의존성이 큽니다. Chrome/Edge가 일반적으로 가장 안정적이고 Safari/iOS는 동작 편차가 있습니다.
- Gemini 무료 티어는 사용량 제한과 데이터 사용 정책이 있습니다.
- 민감한 설교, 상담, 개인정보가 포함된 발화를 무료 클라우드 모델에 전송하기 전에 반드시 해당 공급자의 최신 정책을 확인하세요.
- 클라우드 전송을 원하지 않으면 `LLM_ROUTING_MODE=local`을 사용할 수 있습니다.
- 훈련 가능성이 있는 공급자를 배제하려면 `LLM_PRIVACY_MODE=strict`을 검토하세요.

자세한 내용은 [`docs/free-tier-deployment.md`](docs/free-tier-deployment.md)를 참고하세요.

---

## 권장 프로덕션 구성

라이브 서비스를 실제 현장에 투입하려면 `.env.example`의 production preset을 기준으로 구성하는 것을 권장합니다.

```bash
STT_PROVIDER=deepgram
DEEPGRAM_API_KEY=...
DEEPGRAM_PROJECT_ID=...
DEEPGRAM_STT_MODEL=nova-3

LLM_ROUTING_MODE=pinned
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=...
OPENROUTER_PRIMARY_MODEL=google/gemini-3.7-flash

OPENROUTER_PROVIDER_SORT=latency
OPENROUTER_DATA_COLLECTION=deny
OPENROUTER_REQUIRE_PARAMETERS=true
OPENROUTER_ALLOW_PROVIDER_FALLBACKS=true

APP_ACCESS_KEY=...
SESSION_SECRET=...

BIBLE_PROVIDER=reference-only
```

OpenRouter 모델 ID와 공급자 상태는 계속 바뀔 수 있습니다. 배포 전에 실제 요청을 보내 확인하세요.

```bash
npm run health:openrouter
```

ASAD는 라이브 통역에서 모델의 절대 성능만큼이나 **지연 시간과 세션 중 일관성**을 중요하게 봅니다. 같은 세션에서 모델 계열이 계속 바뀌면 용어와 문체가 흔들리므로 pinned routing을 지원합니다.

---

## Counter Mode 공유 저장소

Counter Mode는 직원과 방문자의 두 기기가 같은 짧은 세션을 공유합니다.

로컬 단일 프로세스 개발에서는 메모리 저장소로 동작할 수 있지만, **Vercel처럼 여러 인스턴스가 요청을 처리하는 환경에서는 공유 Redis가 필요합니다.** 그렇지 않으면 호스트와 방문자가 서로 다른 서버 인스턴스에 도착했을 때 세션이 보이지 않을 수 있습니다. 서버리스는 늘 이런 식으로 사람의 평화를 시험합니다.

ASAD는 다음 환경 변수 조합을 자동 인식합니다.

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

또는 Vercel KV 스타일:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

별도 `COUNTER_STORE` 플래그는 필요하지 않습니다. 완전한 Redis URL/token 쌍이 있으면 공유 저장소를 사용하고, 로컬 개발에서는 메모리 fallback을 사용할 수 있습니다.

현재 Counter 세션은 짧은 수명을 전제로 하며, 종료 시 세션 데이터를 즉시 삭제하는 흐름을 갖고 있습니다.

자세한 내용은 [`docs/counter-storage.md`](docs/counter-storage.md)를 참고하세요.

---

## 선택적 Hugging Face STT fallback

Counter Mode에서 브라우저/기본 음성 인식이 실패했을 때 서버 측 Hugging Face ASR을 마지막 폴백으로 사용할 수 있습니다.

```bash
HF_TOKEN=...
HF_STT_MODEL=openai/whisper-large-v3-turbo
```

주의:

- `HF_TOKEN`은 반드시 서버 측 secret으로만 두세요. `NEXT_PUBLIC_` 접두사를 붙이면 안 됩니다.
- ASAD는 Counter turn 하나의 짧은 오디오만 전송하도록 구성되어 있습니다.
- 특정 민감 서비스 프로필에서는 이 폴백이 차단됩니다.
- Hugging Face routed inference는 무료 크레딧 이후 과금될 수 있습니다. 무료 전용 운영이라면 계정 측 지출 한도도 함께 설정하세요.

전략 문서: [`docs/hugging-face-stt-strategy.md`](docs/hugging-face-stt-strategy.md)

---

## 보안과 개인정보

외부 API를 사용하는 배포는 단순한 정적 웹페이지가 아닙니다. `/api/interpret`, `/api/prep`, `/api/counter/message`, `/api/stt/token` 같은 경로는 실제 API 비용이나 민감한 데이터를 다룰 수 있습니다.

ASAD는 다음 보호 장치를 사용합니다.

- same-origin 검증
- 요청 본문 크기 제한
- 서버 발급 세션 토큰
- 세션/주소 단위 rate limit
- 공유 Redis가 구성된 경우 serverless 인스턴스 전체에 걸친 공유 rate limit과 portable session enforcement
- `APP_ACCESS_KEY`를 통한 비공개 배포 게이트
- `SESSION_SECRET`을 통한 다중 인스턴스 세션 서명 일관성
- API 키를 브라우저에 직접 노출하지 않는 서버 프록시 구조

Vercel이나 다중 인스턴스 환경에서는 `SESSION_SECRET` 또는 이를 대신할 `APP_ACCESS_KEY`를 안정적으로 설정해야 합니다.

Counter Mode의 Redis 공유 저장소를 사용하면 활성 대화 상태가 관리형 Redis에 잠시 저장된다는 점도 고려해야 합니다. 민감한 기관에서 사용할 경우 Redis 프로젝트 접근 권한과 secret 관리까지 포함해 운영 정책을 세워야 합니다.

상세 문서:

- [`docs/privacy.md`](docs/privacy.md)
- [`docs/prep-privacy.md`](docs/prep-privacy.md)
- [`docs/counter-storage.md`](docs/counter-storage.md)

---

## 성경 본문

기본값은 다음과 같습니다.

```bash
BIBLE_PROVIDER=reference-only
```

이 모드에서는 성경 구절의 **참조(reference)** 만 정규화하고 표시합니다. NIV, ESV, NLT, NASB, NKJV 등 저작권이 있는 번역본 본문을 라이선스 없이 번들하거나 임의로 생성하지 않습니다.

사용 가능한 모드:

```text
reference-only  참조만 표시
public-domain   공개 도메인 번역 사용
api-bible       사용자가 권리를 가진 API/번역본 연결
```

---

## 기술 스택

- **Next.js 16** App Router
- **React 19**
- **TypeScript 6**
- **Tailwind CSS 4**
- **Zod**
- **Vitest + Testing Library**
- **Playwright** 기반 E2E 도구
- **Vercel** 배포 대응
- 선택적 **Upstash Redis / Vercel KV REST** 공유 저장소
- STT: Demo / Web Speech / Deepgram / OpenAI Realtime + Counter용 선택적 Hugging Face fallback
- LLM routing: Local / Gemini / Groq / OpenRouter / OpenAI / Anthropic

---

## 개발 명령어

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

추가 검증/운영 도구:

```bash
npm run e2e
npm run bench:llm
npm run bench:live
npm run smoke:llm
npm run health:openrouter
npm run soak -- --minutes 5
```

`npm run verify`는 lint, typecheck, tests, build와 추가 smoke/soak 검증까지 묶은 강한 검증 경로입니다. 일부 외부 공급자 관련 검증은 환경 변수나 네트워크 구성이 필요할 수 있습니다.

---

## 문서

| 문서 | 내용 |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | 전체 아키텍처 |
| [`docs/interpreter-engine.md`](docs/interpreter-engine.md) | 라이브 통역 엔진 |
| [`docs/sermon-booth.md`](docs/sermon-booth.md) | 설교 통역/부스 운영 |
| [`docs/counter-mode.md`](docs/counter-mode.md) | Counter Mode 설계 |
| [`docs/counter-storage.md`](docs/counter-storage.md) | Counter 공유 저장소 |
| [`docs/free-tier-deployment.md`](docs/free-tier-deployment.md) | 무료 티어 운영 |
| [`docs/hugging-face-stt-strategy.md`](docs/hugging-face-stt-strategy.md) | HF STT fallback |
| [`docs/privacy.md`](docs/privacy.md) | 개인정보 및 공급자 데이터 흐름 |
| [`docs/cost.md`](docs/cost.md) | 비용 모델 |
| [`docs/llm-benchmark.md`](docs/llm-benchmark.md) | LLM 벤치마크 |
| [`docs/learning-vault.md`](docs/learning-vault.md) | 비식별 학습 후보 저장 전략 |
| [`docs/rescue-mode.md`](docs/rescue-mode.md) | 장애/복구 모드 |

프로젝트가 `tong-yuck`에서 ASAD로 브랜딩을 전환하는 과정에서 일부 내부 문서나 패키지 메타데이터에는 이전 코드명이 남아 있을 수 있습니다. 기능 설명은 실제 코드와 `/diagnostics`를 최종 기준으로 확인하세요.

---

## 알려진 한계

- 브라우저 SpeechRecognition은 운영체제, 브라우저, 언어별 편차가 큽니다.
- 무료 LLM/STT 티어는 호출량, 지연 시간, 데이터 정책이 언제든 바뀔 수 있습니다.
- AI 번역은 날짜, 시간, 금액, 이름, 법률/의료/행정적 의미를 항상 정확하게 보장하지 않습니다.
- Live는 **사람 통역사를 보조**하기 위한 도구이지 무감독 자동통역을 안전하다고 선언하는 시스템이 아닙니다.
- Counter Mode에서도 중요한 결정은 양쪽 사용자가 원문과 번역을 함께 확인하는 것을 전제로 합니다.
- 서버리스 Counter 배포에서 공유 Redis 없이 안정적인 다기기 세션을 기대하면 안 됩니다.

---

## 기여

이 저장소는 빠르게 변경되고 있습니다. 변경 전 관련 문서와 테스트를 확인하고, 최소한 아래 검증을 통과시키는 것을 권장합니다.

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

아키텍처나 프라이버시 경계를 바꾸는 PR은 동작만 맞는 것으로 끝내지 말고 관련 `docs/`도 함께 업데이트해 주세요.

---

## License

MIT License. 자세한 내용은 [`LICENSE`](LICENSE)를 참고하세요.
