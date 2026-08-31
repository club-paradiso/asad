# Hugging Face in ASAD

## Decision

Use Hugging Face primarily as an optional speech-recognition and model-development layer, not as another unconditional chat-LLM gateway.

### 1. Counter speech fallback

Preferred candidate: `openai/whisper-large-v3-turbo` through Hugging Face Inference Providers.

Use it for discrete Counter utterances when browser SpeechRecognition is unavailable, fails, or cannot reliably cover the selected language. Keep browser speech as the zero-cost fast path while this integration is optional.

A Vercel-side `HF_TOKEN` with only the required Inference Providers permission must be supplied before enabling this path. Never expose the token to the browser.

### 2. Sensitive profiles

`refugee` and `judicial` remain fail-closed. Generic Hugging Face provider routing must not be added to those profiles. They may use a future dedicated/pinned endpoint only after its data-handling policy has been approved. The current Learning Vault exclusion remains unchanged.

### 3. Retrieval and model development

Hugging Face is a strong fit for embeddings over de-identified General Learning Vault material, evaluation datasets, LoRA/QLoRA training jobs, and eventual hosting of an ASAD-specific open-weight model. These are separate from the real-time Counter request path.

## Rollout guardrails

- Do not replace a working browser transcript merely because a second provider disagrees.
- Record provider/latency/quality telemetry without storing raw sensitive audio in logs.
- Prefer `whisper-large-v3-turbo` for interactive latency; benchmark against `whisper-large-v3` before changing defaults.
- Keep all provider keys server-side.
- Keep `refugee` and `judicial` out of generic external-provider fallbacks and out of the Learning Vault.
- Treat Hugging Face free credits as evaluation capacity, not production capacity. Production usage needs an explicit spending ceiling.
