# 오프라인 통역 검증 보고서

## 재현

- 프로젝트 검사: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
- 기존 브라우저 회귀: `npm run e2e:live-fallback`, `npm run e2e:live-failure`, `npm run e2e:live-quota-bypass`, `npm run e2e:live-two-lane`, `npm run e2e:live-languages`를 각각 별도의 프로덕션 빌드 로컬 서버에서 실행한다. 여러 테스트가 하나의 서버 주소 및 레이트 제한을 동시에 공유하면 테스트에서 429가 발생할 수 있다.
- 실모델 브라우저 검증: 클라우드 자격 증명 없이 `npm run build && npm run start`로 서버를 실행하고 `npm run e2e:offline -- http://localhost:3000`을 실행한다. 이 테스트는 브라우저의 가짜 마이크에 라이선스가 확인된 실제 한국어 음성을 입력한다. `ASAD_MODEL_ROOT`에 사전 준비된 가중치 디렉터리를 지정하면 다운로드 응답을 고정 파일로 제공한다. SHA-256 점검, Worker, WASM, AudioWorklet, 캐시, 자막까지의 제품 코드는 그대로 실행된다.
- 벤치마크: 모델별 Hugging Face 파일을 아래 구조로 모은 후 `npm run bench:offline -- /path/to/models opus`를 실행한다. 같은 명령에서 `qwen` 및 `whisper`를 선택한다. `ASAD_BENCH_ROUNDS`로 반복 횟수를 조정한다. 명령은 로컬 파일만 읽는다.
  - `<root>/Xenova/opus-mt-ko-en/`과 `<root>/Xenova/whisper-tiny/`에는 [등록부](../src/providers/offline/models.json)의 파일을 지정 경로에 둔다.
  - `<root>/onnx-community/Qwen3-0.6B-ONNX/`에는 고정 리비전 `79346d370dfae34801d26993fda9ae2372900fd0`의 `config.json`, `generation_config.json`, `tokenizer.json`, `tokenizer_config.json`, `onnx/model_quantized.onnx`를 둔다.
- 45분 가상 시계 회귀: `npm run soak:two-lane`. 환경에서 tsx 로컬 IPC가 막힌 경우 `node --import tsx scripts/soak-two-lane.mjs`로 같은 스크립트를 실행한다.

## 결과

- lint, typecheck, production build 통과. Vitest 1,917건 통과, 기존 2건 건너뜀.
- 기존 Live 회귀 5종 통과. fallback 7/7, failure 14/14, quota bypass 4/4, two-lane 16/16, language-pair 전체 통과. 기존 E2E의 Web Speech 및 Chrome Translator는 mock이다.
- 원격 마이크 회귀 검사는 안내문을 영어 결과로 세던 넓은 정규식 대신, 테스트 한국어가 실제 번역 요청에 도달하고 해당 영어 응답이 자막에 표시되는지 확인한다. WebRTC와 오디오 캡처는 실제 브라우저 경로를 거치며 STT와 번역 공급자는 고정 응답을 사용한다.
- Chromium 156.0.8078.79의 실제 ONNX/WASM E2E 통과. 다운로드 연결 오류 후 재시도, 200/quota fallback의 영어 출력 및 이후 서버 우회, 서버 키가 없는 상태의 영어 출력, 연결을 끊고 `/live`를 새로고침한 뒤 실제 WAV 마이크 입력 → 한국어 원문 → 영어 자막, 외부 및 `/api/*` 요청 0건을 확인했다. 모델 다운로드 응답은 검증된 고정 파일로 제공했다. 두 건의 same-origin 네트워크 실패 로그가 있었고 Worker, 캐시, 한국어 인식과 영어 출력은 완료됐다.
- 45분 가상 시계 시뮬레이션 11/11. 499개 턴 중 유실 0, 커밋된 영어 덮어쓰기 0, 동시 cloud 호출 최대 1, 대기 턴 최대 2, 종료 후 heap 증가 4.8 MB. 실모델 또는 실제 45분 기기 메모리·발열 측정과 구분한다.
- [OPUS-MT 원시 출력 및 시간](../benchmarks/results/offline-opus-cpu.json), [Qwen3](../benchmarks/results/offline-qwen-cpu.json), [Whisper Tiny](../benchmarks/results/offline-whisper-cpu.json). 모델별 p50, p95, 초기화 시간 및 RSS는 [성능 보고서](ipad-offline-performance.md)에 있다.
- Whisper의 점검 샘플에서 공평하지 않았다는 내용과 문장 순서를 보존했다. RSS와 시간이 기록된 변형은 무음, 약한 합성 잡음, 1.25배 속도, 중간 절단을 도입했다. 별도 FLEURS 문장 탐색에서는 히브리 가족, 가나안 같은 용어를 놓쳤다. 실제 한국어·영어 혼용 설교와 여러 화자의 정확도는 미검증이다.
- iPad Air 4, Safari, 모바일 WebGPU 실패 전환, iPad 메모리 압력과 실제 45분 설교는 미검증이다. 기본 모델은 단일 스레드 WASM 경로를 사용한다.
