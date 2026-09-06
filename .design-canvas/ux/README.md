# UX 개선안 — 아트보드 소스

발행된 캔버스:
https://claude.ai/code/artifact/35b205c8-2ad2-469d-bb68-a6f19d4e54da

`.design-canvas/`의 캔버스가 **지금 출시된 디자인 시스템**을 기록하는 것과 달리,
이쪽은 **아직 만들지 않은 제안**입니다. 두 개를 섞지 마세요.

| 파일 | 아트보드 | 크기 |
|---|---|---|
| `Before.dc.html` | 현재 `/live` 시작 화면 | 390×1260 |
| `Main.dc.html` | 개선안 — 시작 화면 (동작함) | 390×844 |
| `Recovery.dc.html` | 개선안 — 오류 복구 (동작함) | 390×790 |
| `LiveStatus.dc.html` | 개선안 — 콘솔 품질 표시 (동작함) | 844×446 |
| `canvas.json` | 배치 · 스티키 노트 · 진입 화면 |  |

`LiveStatus`의 콘솔 자체는 844×390입니다. 아래 56px는 아트보드용 조작기이고
제품이 아닙니다.

## 지키는 것

토큰과 컴포넌트 수치는 `src/app/globals.css`와
`src/components/ui/primitives.tsx`에서 그대로 가져왔습니다. 손으로 복제한
값이므로 어긋나면 **코드가 맞습니다**.

인용한 숫자와 문자열도 코드에서 가져왔습니다 — Gemini 무료 한도 1,000회는
`providers/llm/capabilities.ts`, 영어 오류 문자열 세 개는
`features/live/useLiveSession.ts`, 단축키는 `features/live/LiveConsole.tsx`
입니다. 이 값들이 바뀌면 아트보드도 같이 바꾸세요. 화면에 잘못된 숫자를 띄운
목업은 목업이 아니라 오답입니다.

## 고치는 법

아트보드를 편집한 뒤 `/design` 스킬의 헬퍼로 다시 시드하고 **같은 URL**로
발행합니다. URL 없이 발행하면 이 캔버스가 갱신되는 게 아니라 두 번째 캔버스가
생깁니다. 시드 결과물(`asad-ux-improvements.html`)은 빌드 산출물이므로
커밋하지 않습니다.
