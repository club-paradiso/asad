# Hugging Face in ASAD

## Decision

Use Hugging Face only where it improves ASAD without creating a paid dependency. Hugging Face is primarily an optional speech-recognition and model-development layer, not another unconditional chat-LLM gateway.

**Hard cost rule:** ASAD must not intentionally consume paid Hugging Face inference. Only models/providers usable within the account's free allowance may be selected. If the free allowance is exhausted or a provider would require payment, the request must fall back to the existing zero-cost/browser/local path instead of charging money.

### 1. Counter speech fallback

Preferred candidate: `openai/whisper-large-v3-turbo` through Hugging Face Inference Providers when it is available inside the free allowance.

Use it for discrete Counter utterances when browser SpeechRecognition is unavailable, fails, or cannot reliably cover the selected language. Keep browser speech as the zero-cost fast path and never make paid HF inference a requirement for a conversation to continue.

A Vercel-side `HF_TOKEN` with only the required Inference Providers permission must be supplied before enabling this path. Never expose the token to the browser.

### 2. Free-only routing

The eventual HF integration must implement these rules explicitly rather than relying on a billing surprise:

- Prefer browser Web Speech for supported languages because its marginal ASAD cost is zero.
- Use HF only for unsupported/failed/low-confidence discrete utterances while free inference is available.
- Never opt into paid provider fallback, dedicated paid endpoints, or automatic credit purchases.
- Treat quota/credit exhaustion as a recoverable provider-unavailable state and immediately fall back to Web Speech, local typing, or the existing non-HF provider chain.
- Surface HF availability in diagnostics without exposing tokens or private account data.

### 3. Sensitive profiles

`refugee` and `judicial` remain fail-closed. Generic Hugging Face provider routing must not be added to those profiles. They may use a future dedicated/pinned endpoint only after its data-handling policy has been approved and only if it still satisfies the project's free-only rule. The current Learning Vault exclusion remains unchanged.

### 4. Retrieval and model development

Hugging Face remains a strong fit for free-tier experiments with embeddings over de-identified General Learning Vault material, evaluation datasets, LoRA/QLoRA experiments, and eventual hosting of an ASAD-specific open-weight model. These are separate from the real-time Counter request path and must not silently create paid jobs or endpoints.

## Rollout guardrails

- Do not replace a working browser transcript merely because a second provider disagrees.
- Record provider/latency/quality telemetry without storing raw sensitive audio in logs.
- Prefer `whisper-large-v3-turbo` for interactive latency; benchmark against `whisper-large-v3` before changing defaults.
- Keep all provider keys server-side.
- Keep `refugee` and `judicial` out of generic external-provider fallbacks and out of the Learning Vault.
- Treat Hugging Face free credits as a hard ceiling, not a trial that may spill into paid usage.
- When the free allowance is unavailable, degrade gracefully instead of billing.
