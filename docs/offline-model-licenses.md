# 모델 및 음성 샘플 라이선스

| 배포물 | 원본과 변환본 | 적용 판단 |
| --- | --- | --- |
| OPUS-MT q8 | [Helsinki-NLP 원본](https://huggingface.co/Helsinki-NLP/opus-mt-ko-en)은 Apache-2.0. [Xenova 변환본](https://huggingface.co/Xenova/opus-mt-ko-en)은 원본을 명시한 ONNX 변환이며 카드에 별도 라이선스 필드가 없다. | 공개 변환본을 직접 받는다. 원본 조건을 유지하며 별도 권리를 주장하지 않는다. |
| Whisper Tiny q8 | [OpenAI 원본](https://huggingface.co/openai/whisper-tiny)과 [Xenova 변환본](https://huggingface.co/Xenova/whisper-tiny)은 Apache-2.0. | 공개 변환본을 직접 받는다. |
| Qwen3-0.6B q8 | [Qwen 원본](https://huggingface.co/Qwen/Qwen3-0.6B)은 Apache-2.0. [ONNX 변환본](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX)은 원본을 명시하며 별도 라이선스 필드가 없다. | 개발 벤치마크에서만 사용했다. |
| Qwen3-ASR-0.6B | [Qwen 원본](https://huggingface.co/Qwen/Qwen3-ASR-0.6B-hf)은 Apache-2.0. 변환본은 채택되지 않았다. | 가중치 다운로드와 앱 설정을 추가하지 않았다. |
| HY-MT1.5 | [Tencent 라이선스](https://huggingface.co/tencent/HY-MT1.5-1.8B-GPTQ-Int4/blob/750452ea56d8200f92d487acef5bba089d1629f4/License.txt)는 대한민국을 허용 지역에서 제외한다. | 가중치 및 파생물은 사용 대상에서 제외했다. |

[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)에는 한국 지역 제외 또는 비상업적 이용 조건이 없다. 공급자의 원본 출처와 라이선스를 유지하고 별도 미러에서 재배포하는 경우 해당 조건의 라이선스 및 고지 전달 요건을 적용한다. ASAD는 모델 가중치를 앱, 서버, Git에 번들하지 않는다. 지정된 Hugging Face 리비전에서 브라우저가 내려받을 때 SHA-256을 대조한다. 다운로드 서버에 접속하는 동안 일반 HTTP 접속 정보는 전달되며 오디오와 통역 내용은 모델 파일 요청에 포함되지 않는다.

`public/offline-v1/ko-check.wav`는 [Google FLEURS](https://huggingface.co/datasets/google/fleurs)의 `ko_kr/dev` 표본 `1577 / 10977160254378908804.wav`이다. CC BY 4.0으로 공개된 음성을 시작 무음 제거 후 16 kHz mono PCM으로 변환했다. 원문은 “그게 저에겐 말이 안 되는 것 같았습니다. 확실히 공평하지 않았어요.”다. 실제 사용자 발화는 테스트 자산에 사용하지 않는다.
