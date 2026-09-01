# 아무튼서로알아들었으면된거아닌가요

> **정확한지는 모르겠고, 아무튼 알아들었어요.**
>
> 네. 진짜 프로젝트 이름이 이겁니다.

**ASAD**는 라이브 통역과 현장 응대를 위한 AI 통역 보조 서비스입니다.

정식 명칭은 **아무튼서로알아들었으면된거아닌가요**입니다. 줄여서 ASAD라고 부릅니다. 왜 ASAD냐고요? 풀네임을 매번 타이핑하다가는 통역보다 프로젝트 이름 입력이 더 오래 걸리기 때문입니다.

이 프로젝트의 목표는 거창하게 "언어의 장벽을 혁신적으로 제거"하는 것이 아닙니다.

그냥 이겁니다.

> A: 뭐라고 했어요?
>
> B: 대충 이런 말이래요.
>
> A: 아 이해했어요.
>
> **ASAD: 아무튼 서로 알아들었으면 된 거 아닌가요?**

다만 실제 구현은 이름만큼 대충 만들지 않았습니다. 그랬다가는 날짜 하나 잘못 번역해서 예약이 날아가고, 이름 하나 잘못 알아들어서 사람 하나가 갑자기 다른 사람이 되는 기적을 보게 됩니다.

---

## 그래서 이게 뭐 하는 물건인가요

ASAD에는 크게 두 가지 모드가 있습니다.

### 1. Live Interpretation

**한 사람이 계속 말하고, 사람이 통역하는 상황**을 보조합니다.

예:

- 설교
- 강연
- 회의
- 인터뷰
- 기타 "말은 계속 나오는데 통역사의 뇌는 하나뿐인" 상황

ASAD가 하는 일:

- 놓치기 쉬운 문맥 붙잡기
- 고유명사와 용어 기억하기
- 성경 구절 참조 잡기
- 한국어의 뒤늦게 등장하는 술어 때문에 통역사가 영혼까지 기다리지 않도록 문장 골격 보조하기
- 말장난, 관용어, 문화적 표현 감지하기
- 이미 통역사가 말해버린 문장을 뒤늦게 몰래 갈아엎지 않기

즉, **통역사를 없애는 AI가 아니라 통역사 옆에서 메모 잘하는 매우 과몰입한 조수**에 가깝습니다.

### 2. Counter Mode

**두 사람이 창구나 현장에서 마주 앉아 서로 다른 언어를 쓰는 상황**을 위한 모드입니다.

직원은 `/counter`를 열고 QR 코드를 띄웁니다. 방문자는 자기 휴대폰으로 QR을 찍고 자기 언어를 고릅니다. 앱 설치는 없습니다. 회원가입도 없습니다. 인간은 이미 충분히 많은 회원가입을 하고 있습니다.

그다음 양쪽이 채팅 또는 음성으로 대화합니다.

예:

- 민원실
- 안내 데스크
- 접수창구
- 병원 접수
- 행사 안내
- 기타 "상대방 말은 모르겠는데 일단 업무는 끝내야 하는" 장소

---

## 이름은 대충인데 왜 내부는 이렇게 진지한가요

통역은 틀려도 웃고 넘길 수 있는 문장과 **틀리면 일이 터지는 문장**이 섞여 있습니다.

"제주도 날씨 좋네요"가 조금 이상하게 번역되는 건 인류가 감당할 수 있습니다.

하지만 아래는 아닙니다.

- `3시`가 `13시`가 됨
- `150,000원`이 `15,000원`이 됨
- `좌영춘`가 갑자기 `자영춘`가 됨
- `9월 12일`이 `12월 9일`이 됨

그래서 ASAD는 번역 문장을 예쁘게 만드는 것보다 **언제 확정했고, 무엇이 위험하고, 사용자가 어디를 다시 확인해야 하는지**를 중요하게 봅니다.

### Live가 지키는 것

- **Temporal locking**: 이미 통역사가 말했을 가능성이 높은 문장은 뒤늦게 슬쩍 수정하지 않습니다.
- **확정 / 예상 분리**: 아직 확정되지 않은 예상 출력은 확정 번역과 다르게 보입니다.
- **짧은 thought unit**: 소설을 써주는 게 아니라 실제 입 밖으로 꺼낼 수 있는 길이로 제시합니다.
- **한국어 지연 구조 대응**: 핵심 술어가 문장 맨 끝에서 뒤늦게 등장하는 한국어의 장난질에 대응합니다.
- **고유명사 교정**: 이름이나 용어를 한 번 수정하면 이후 흐름에 반영합니다.
- **성경 본문 보호**: 모르면 성경을 새로 집필하지 않습니다. 기본값은 reference-only입니다.

### Counter가 지키는 것

- **양쪽 화면에 양쪽 언어를 함께 표시**합니다.
- **자주 쓰는 빠른 문구는 고정 번역**으로 처리할 수 있습니다.
- **숫자, 날짜, 시간, 금액, 이름**처럼 사고 나기 좋은 값은 다시 확인하기 쉽게 만듭니다.
- **음성 인식 결과를 전송 전에 직접 수정**할 수 있습니다.
- 번역에 실패하면 실패했다고 말합니다. 아무 문자열이나 번역인 척 내밀지 않습니다.
- 방문자가 세션을 끝내면 방문자 화면은 종료되고, 직원 화면은 유지됩니다. 직원까지 같이 쫓아내면 다음 민원인은 누가 받습니까.

---

## 현재 화면들

| 경로 | 인간이 여기서 하는 일 |
| --- | --- |
| `/` | 시작합니다. 모든 실수의 출발점입니다. |
| `/live` | 라이브 통역 콘솔 |
| `/counter` | 현장 응대 직원 화면 |
| `/c/...` | QR을 찍고 들어오는 방문자 화면 |
| `/prep` | 설교자, 본문, 용어 등을 미리 넣어 AI에게 예습을 시킵니다 |
| `/booth-preflight` | 믹서 입력, 신호 레벨, mix-minus 등을 점검합니다. 공연 시작 후 깨닫지 마세요 |
| `/sessions` | 저장한 세션 복기 및 내보내기 |
| `/diagnostics` | "왜 안 되지?"를 감정이 아니라 데이터로 확인하는 곳 |

홈 화면에서는 **라이브 통역**, **현장 응대**, **준비 시트**, **부스 사전 점검**, **지난 세션**으로 바로 들어갈 수 있습니다.

---

## Counter Mode 언어 지원

현재 Counter UI에는 **24개 언어**가 들어 있습니다.

- 한국어
- 영어
- 중국어 간체 / 번체
- 일본어
- 베트남어
- 태국어
- 인도네시아어
- 러시아어
- 우즈베크어
- 몽골어
- 네팔어
- 크메르어
- 미얀마어
- 타갈로그어
- 스페인어
- 프랑스어
- 독일어
- 포르투갈어
- 아랍어
- 힌디어
- 벵골어
- 우르두어
- 터키어

방문자에게는 언어 이름을 한국어가 아니라 **각 언어의 자기 표기(endonym)** 로 보여줍니다.

예를 들어 중국어 사용자가 언어 선택 화면에서 굳이 `중국어`라는 한글부터 해독해야 한다면 이미 UX가 패배한 겁니다.

브라우저 SpeechRecognition 지원 수준은 언어와 브라우저마다 다릅니다. 일부 언어는 음성보다 텍스트 입력이 더 안정적입니다. 브라우저 제조사들이 모두 같은 세상에 사는 것처럼 API를 지원해 주면 좋겠지만 현실은 그렇지 않습니다.

Counter 음성 인식은 기본 경로가 실패했을 때 선택적으로 **Hugging Face Whisper STT fallback**도 사용할 수 있습니다.

---

## 일단 실행부터 해보기

```bash
npm install
npm run dev
```

그리고:

```text
http://localhost:3000
```

끝입니다.

API 키가 없어도 앱은 실행됩니다. 기본 구성에서는 demo/local 경로로 라이브 흐름을 확인할 수 있습니다.

환경 변수 파일이 필요하면:

```bash
cp .env.example .env.local
```

그리고 제발 `.env.local`을 GitHub에 올리지 마세요.

API 키를 공개 저장소에 올리는 것은 "내 돈을 인터넷 여러분과 나누겠습니다"와 거의 같은 뜻입니다.

---

## 무료로 어디까지 버틸 수 있나요

무료로 실제 마이크 입력까지 시험하려면 대략 이렇게 시작할 수 있습니다.

```bash
STT_PROVIDER=webspeech
LLM_ROUTING_MODE=auto-free
GEMINI_API_KEY=your-free-key
BIBLE_PROVIDER=reference-only
```

### 무료의 대가

무료는 가격이 0원이지 제약이 0개라는 뜻이 아닙니다.

- Web Speech API는 브라우저 영향을 많이 받습니다.
- Chrome/Edge가 대체로 안정적이고 Safari/iOS는 상황에 따라 인류애를 시험합니다.
- 무료 LLM에는 사용량 제한이 있습니다.
- 무료 공급자의 데이터 사용 정책은 유료 API와 다를 수 있습니다.
- 민감한 설교, 상담, 개인정보가 포함된 발화를 보내기 전에 공급자의 최신 데이터 정책을 확인해야 합니다.

클라우드로 아무것도 보내고 싶지 않다면:

```bash
LLM_ROUTING_MODE=local
```

훈련 가능성이 있는 공급자를 제외하고 싶다면:

```bash
LLM_PRIVACY_MODE=strict
```

자세한 내용: [`docs/free-tier-deployment.md`](docs/free-tier-deployment.md)

---

## 실제 현장에 들고 갈 거라면 갑자기 진지해집니다

로컬에서 버튼 몇 번 눌러보고 "오 되네"라고 말하는 것과 실제 설교/민원 현장에서 40분 이상 안정적으로 돌아가는 것은 완전히 다른 문제입니다.

권장 production preset:

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

배포 전에:

```bash
npm run health:openrouter
```

반드시 실제 요청을 보내 확인하세요.

설정 파일에 모델 이름이 적혀 있다고 그 모델이 오늘도 존재하고, 응답하고, 원하는 파라미터를 받아줄 것이라는 보장은 없습니다. 외부 API 세계는 생각보다 자유분방합니다.

ASAD는 라이브 통역에서 모델의 벤치마크 점수만큼 **지연 시간과 세션 중 일관성**을 중요하게 봅니다.

완벽한 번역이 8초 뒤에 도착하면 통역사 입장에서는 완벽하게 늦은 번역입니다.

그래서 같은 세션 안에서는 가능한 한 모델을 고정하는 pinned routing을 지원합니다.

---

## Counter Mode + Redis: 서버리스가 인간을 괴롭히는 방식

Counter Mode는 직원 기기와 방문자 기기가 **같은 세션**을 봐야 합니다.

당연해 보이죠?

Vercel 같은 serverless 환경에서는 요청마다 서로 다른 인스턴스로 갈 수 있습니다.

즉:

```text
직원: 방 만들었어요
서버 A: 네
방문자: 저 들어갈게요
서버 B: 무슨 방이요?
```

이 아름다운 상황을 막으려면 production에서는 공유 Redis가 필요합니다.

지원하는 환경 변수:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

또는 Vercel KV 스타일:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

별도 `COUNTER_STORE` 플래그는 없습니다.

완전한 Redis URL/token 쌍이 있으면 공유 저장소를 사용하고, 로컬 단일 프로세스 개발에서는 메모리 fallback을 사용할 수 있습니다.

활성 Counter 세션은 짧은 수명을 전제로 하며, 종료 시 세션 데이터를 삭제합니다.

자세한 내용: [`docs/counter-storage.md`](docs/counter-storage.md)

---

## 음성 인식이 끝까지 말을 안 들을 때

Counter Mode에서 브라우저/기본 음성 인식 경로가 실패했을 때 선택적으로 Hugging Face ASR을 마지막 폴백으로 사용할 수 있습니다.

```bash
HF_TOKEN=...
HF_STT_MODEL=openai/whisper-large-v3-turbo
```

주의사항:

- `HF_TOKEN`은 **서버 측 secret**입니다.
- `NEXT_PUBLIC_HF_TOKEN` 같은 걸 만들지 마세요. 이름부터 이미 사고 예고편입니다.
- ASAD는 Counter turn 하나의 짧은 오디오만 전송하도록 설계되어 있습니다.
- 특정 민감 서비스 프로필에서는 이 fallback을 차단합니다.
- Hugging Face routed inference는 무료 크레딧 소진 후 과금될 수 있습니다.
- 완전 무료 운영을 원하면 공급자 계정 측 지출 한도도 설정하세요.

자세한 내용: [`docs/hugging-face-stt-strategy.md`](docs/hugging-face-stt-strategy.md)

---

## 보안과 개인정보

여기서부터는 별로 안 웃깁니다. 돈과 개인정보가 걸려 있기 때문입니다.

외부 API를 사용하는 배포에서는 다음 경로가 실제 비용 또는 민감 데이터를 다룰 수 있습니다.

- `/api/interpret`
- `/api/prep`
- `/api/counter/message`
- `/api/stt/token`

ASAD에는 다음 보호 장치가 있습니다.

- same-origin 검증
- 요청 본문 크기 제한
- 서버 발급 세션 토큰
- 세션/주소 단위 rate limit
- 공유 Redis가 있을 때 serverless 인스턴스 전체 shared rate limit
- Redis 기반 portable session enforcement
- `APP_ACCESS_KEY`를 통한 비공개 배포 게이트
- `SESSION_SECRET`을 통한 다중 인스턴스 세션 서명 일관성
- API 키를 브라우저에 직접 노출하지 않는 서버 프록시 구조

Vercel이나 다중 인스턴스 환경에서는 `SESSION_SECRET` 또는 이를 대신할 `APP_ACCESS_KEY`를 안정적으로 설정해야 합니다.

Counter Mode에 Redis를 사용하면 활성 대화 상태가 관리형 Redis에 잠시 저장됩니다. 민감한 기관에서 사용한다면 Redis 접근 권한과 secret 관리까지 운영 정책에 포함해야 합니다.

더 읽기:

- [`docs/privacy.md`](docs/privacy.md)
- [`docs/prep-privacy.md`](docs/prep-privacy.md)
- [`docs/counter-storage.md`](docs/counter-storage.md)

---

## 성경을 AI가 새로 쓰지 않게 하는 법

기본값:

```bash
BIBLE_PROVIDER=reference-only
```

이 모드에서는 성경 구절의 **참조(reference)** 만 정규화하고 표시합니다.

NIV, ESV, NLT, NASB, NKJV 등 저작권이 있는 번역본을 라이선스 없이 번들하지 않습니다. 모델이 기억나는 대로 구절을 재창작하도록 내버려두지도 않습니다.

지원 모드:

```text
reference-only  참조만 표시
public-domain   공개 도메인 번역 사용
api-bible       사용자가 권리를 가진 API/번역본 연결
```

모르면 모른다고 하는 편이 성경을 즉흥 창작하는 것보다 낫습니다. 놀랍게도 이 원칙은 성경 밖의 세계에도 적용됩니다.

---

## 기술 스택

이름만 보면 학교 축제에서 새벽 3시에 만든 프로젝트 같지만, 스택은 멀쩡합니다.

- **Next.js 16** App Router
- **React 19**
- **TypeScript 6**
- **Tailwind CSS 4**
- **Zod**
- **Vitest + Testing Library**
- **Playwright** 기반 E2E 도구
- **Vercel** 배포 대응
- 선택적 **Upstash Redis / Vercel KV REST**
- STT: Demo / Web Speech / Deepgram / OpenAI Realtime
- Counter STT fallback: Hugging Face Whisper
- LLM routing: Local / Gemini / Groq / OpenRouter / OpenAI / Anthropic

---

## 개발 명령어

평범한 것들:

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

조금 더 의심이 많은 사람들을 위한 것들:

```bash
npm run e2e
npm run bench:llm
npm run bench:live
npm run smoke:llm
npm run health:openrouter
npm run soak -- --minutes 5
```

그리고 "나는 모든 것을 한 번에 의심하겠다" 모드:

```bash
npm run verify
```

`verify`는 lint, typecheck, tests, build와 추가 smoke/soak 검증을 묶습니다. 일부 외부 공급자 검증에는 환경 변수와 네트워크 구성이 필요합니다.

---

## 문서가 왜 이렇게 많아요

처음에는 통역 앱 하나 만들려고 했는데 인간은 기능을 추가하고, 기능은 문서를 낳고, 문서는 또 다른 문서를 낳았습니다.

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

참고로 이 프로젝트는 이전에 `tong-yuck`이라는 코드명을 사용했습니다.

그래서 일부 내부 문서, 환경 변수 설명, 패키지 메타데이터에는 아직 예전 이름이 남아 있을 수 있습니다. 고고학 유적이 아니라 브랜딩 마이그레이션 중입니다.

실제 현재 동작은 코드와 `/diagnostics`를 최종 기준으로 확인하세요.

---

## 알려진 한계

ASAD라는 이름이 이미 충분한 경고처럼 보이지만 그래도 적어둡니다.

- 브라우저 SpeechRecognition은 운영체제, 브라우저, 언어별 편차가 큽니다.
- 무료 LLM/STT 티어의 호출량, 지연 시간, 데이터 정책은 바뀔 수 있습니다.
- AI 번역은 날짜, 시간, 금액, 이름, 법률/의료/행정 의미를 항상 정확하게 보장하지 않습니다.
- Live는 **사람 통역사를 보조**하는 도구입니다. 무감독 자동통역의 정확성을 보장하지 않습니다.
- Counter Mode에서도 중요한 값은 원문과 번역을 함께 확인하는 흐름을 전제로 합니다.
- serverless Counter 배포에서 공유 Redis 없이 안정적인 다기기 세션을 기대하지 마세요.
- 무료 API 여러 개를 이어 붙였다고 갑자기 AWS가 되는 것은 아닙니다.

---

## 기여

PR은 환영합니다.

다만 "제 컴퓨터에서는 됐는데요"만 남기고 떠나지는 마세요.

최소한:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

아키텍처, 프라이버시 경계, 데이터 흐름을 바꾸는 PR이라면 관련 `docs/`도 함께 업데이트해 주세요.

코드가 바뀌었는데 문서가 그대로면 미래의 누군가가 README를 믿고 배포합니다.

그리고 그 미래의 누군가는 높은 확률로 우리입니다.

---

## License

MIT License.

[`LICENSE`](LICENSE)를 참고하세요.

---

<p align="center">
  <strong>정확한지는 모르겠고, 아무튼 알아들었어요.</strong><br />
  <sub>Communication successful. Accuracy unconfirmed.</sub>
</p>
