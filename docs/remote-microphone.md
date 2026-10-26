# Remote Microphone (원격 마이크)

Use a spare phone — **iPhone or Android** — as a wireless microphone for ASAD
running on a MacBook (or any computer). Scan a QR code, tap **마이크 시작**,
approve on the computer, and the phone's microphone becomes the live session's
audio input. No app install, and **no shared Wi-Fi required**.

The phone is **only an audio capture device**. Transcription, interpretation,
Scripture detection, terminology and every credential stay on the MacBook and
ASAD's server, exactly as with any other input.

> **Status.** Automated checks (unit, integration, real-Redis relay scripts,
> real-Chromium E2E over WebRTC **and** over the server relay, iPhone and
> Android viewports) pass. **Physical iPhone Safari / Android Chrome + MacBook
> testing has not been performed by the implementer** — see
> [Device test checklist](#device-test-checklist).

## Transports: direct first, server relay as fallback

| | Direct (WebRTC) | Server relay (fallback) |
| --- | --- | --- |
| When | Always tried first | No direct path within ~8 s, or a dropped direct link cannot be restored |
| Networks | Same Wi-Fi; different networks when STUN/TURN finds a path | **Any** network that can open the ASAD site (phone on LTE/5G, guest Wi-Fi, office Wi-Fi) |
| Audio | Opus, peer to peer (or via TURN), DTLS-SRTP | 16 kHz µ-law, 300 ms frames over HTTPS, through the shared store |
| Delay (measured, local Chromium) | ~0.07 s transport | ~1 s transport (frame + poll + playout queue) |
| Server sees audio | No | Yes, transiently: ≤ 40 frames (~12 s) per pairing, TTL 60 s after the last write, deleted when the pairing ends |
| Setup | None | None (uses the Upstash store pairing already needs) |

The phone decides: it negotiates WebRTC and, if that has not connected in
`relayFallbackMs` (8 s), it sends `{action:"transport", mode:"relay"}` and
starts posting frames to `POST /api/remote-mic/relay`; the computer sees
`transport: "relay"` on its next poll and reads `GET /api/remote-mic/relay`
every 300 ms into a Web Audio playout that produces an ordinary live
MediaStream track. Pressing **다시 연결** on the phone tries direct again.
`REMOTE_MIC_TRANSPORT=relay` skips WebRTC entirely (networks known to block
it; testing).

Relay cost (estimate, not measured on Vercel/Upstash): one function call and
one store command per frame per side ≈ 24 k requests and ~150 MB of store
traffic per hour of relayed audio. Direct connections cost nothing extra.
For heavy use, configure Cloudflare TURN (below) so most hard networks stay
on WebRTC.

---

## Three different "iPhone microphone" paths

| Launcher choice | What it is | Who routes the audio |
| --- | --- | --- |
| **이 맥의 입력 장치** → built-in / external / USB | A normal macOS input | macOS |
| **이 맥의 입력 장치** → "iPhone 마이크" | Apple **Continuity** (same Apple ID, nearby) — appears as an ordinary macOS input | macOS |
| **원격 마이크 (iPhone)** | ASAD **WebRTC pairing** described here — any iPhone, via QR | ASAD |

They are deliberately not conflated: Continuity is a system device the browser
enumerates; Remote Microphone is a peer connection ASAD negotiates.

---

## Architecture

```text
iPhone Safari (/remote-mic)                         MacBook (/live launcher → console)
 getUserMedia(audio only, user tap)
   │  one Opus track, DTLS-SRTP ─────── WebRTC (peer to peer, encrypted) ──────►  RTCPeerConnection
   │                                                                              │ one remote MediaStream
   │                                                                              ▼
   │                                                       MicrophoneCapture({ stream })   ← unchanged
   │                                                       16 kHz mono PCM16, input-health metering
   │                                                                              ▼
   │                                                       existing STT provider (Deepgram / OpenAI)
   │                                                                              ▼
   │                                                       existing InterpretationEngine, Scripture,
   │                                                       terminology, cloud lane, transport supervisor
   │
   └── signalling only (SDP, ICE candidates, flags) ──► /api/remote-mic/* ◄── signalling only
                                      short HTTP requests + Upstash/Vercel KV Redis (TTL)
```

Key decisions:

- **Reuse, not a parallel pipeline.** The remote stream is handed to the same
  `MicrophoneCapture` that already accepted an external `MediaStream`
  (`src/providers/stt/audio.ts`). Resampling, frame size, level metering,
  silence/clipping detection, STT, the engine and recovery are untouched.
  `useLiveSession` gains two options: `audioSource: "remote"` and a
  `remoteStream()` getter read on every (re)open.
- **HTTP polling signalling over WebSockets.** Signalling is a handful of small
  messages during ~1 s of negotiation, then a slow heartbeat. Short requests
  against shared Redis behave identically on every Vercel instance and need no
  new infrastructure; audio never touches these routes. Poll cadence: 350 ms
  while negotiating, 1 s while pairing, 4 s once connected.
- **Shared state in the existing Redis.** The store reuses
  `resolveCounterRedisConfig()` (Upstash or Vercel KV, including prefixed
  Marketplace variables) with an atomic Lua compare-and-set. On Vercel without
  Redis, creating a pairing returns **503 `SHARED_STORE_REQUIRED`** and the
  launcher says so — it never pretends a memory-only pairing works.
- **The phone offers, the Mac answers.** The sender adds exactly one
  `sendonly` audio transceiver plus a small control data channel. Video is
  refused by schema (server) and again by the receiver.
- **One track, always.** A replacement sender peer closes the old peer first;
  the receiver never holds more than one live track (`liveTracks` is asserted
  in tests). When a track is replaced the receiver fires `ended` on the old one
  so the live capture re-attaches instead of capturing a dead track.

### Files

| Path | Role |
| --- | --- |
| `src/remote-mic/protocol.ts` | Shared types, zod schemas, limits, pairing-link format |
| `src/remote-mic/session.ts` | Pure pairing state machine (roles, expiry, generations, hashing) |
| `src/remote-mic/store.ts` | Memory + Redis (CAS) store |
| `src/remote-mic/server.ts` | Same-origin, rate limits, body caps, store availability |
| `src/remote-mic/ice.ts` | STUN/TURN configuration from env |
| `src/remote-mic/client.ts` | Browser signalling client |
| `src/remote-mic/receiver.ts` | MacBook state machine (pair, approve, answer, stats) |
| `src/remote-mic/sender.ts` | iPhone state machine (capture, claim, offer, bounded recovery) |
| `src/app/api/remote-mic/{session,claim,signal}/route.ts` | Signalling routes |
| `src/app/remote-mic/page.tsx`, `src/features/remote-mic/RemoteMicSenderScreen.tsx` | iPhone page |
| `src/features/remote-mic/RemoteMicPanel.tsx` | Launcher panel: QR, approval, meter, preflight, stats |
| `src/features/remote-mic/RemoteMicStrip.tsx` | Live-console fault strip |
| `src/features/live/useLiveSession.ts` | `audioSource: "remote"` integration |

---

## Pairing sequence

1. **Mac** — 원격 마이크 (iPhone) → **iPhone 연결**. `POST /api/remote-mic/session`
   (operator route: access gate, same-origin, session token, rate limit).
   Returns a pairing id, a **receiver token** and a one-time **pairing secret**.
2. Mac shows a QR for `https://<host>/remote-mic#p=<id>.<secret>`. The secret
   is in the **fragment**, which browsers never send to servers — it cannot
   appear in access logs, proxies or a Referer.
3. **iPhone** opens the link in Safari, taps **마이크 시작** (the user gesture
   iOS requires). `getUserMedia({ audio, video: false })` runs first; only then
   `POST /api/remote-mic/claim` presents the secret. The secret's hash is
   cleared on success — the QR is **single-use** — and the phone receives a
   **sender token** and a 4-digit **confirmation code**. The secret is then
   removed from the address bar.
4. **Mac** shows the same code with **승인 / 거부**. Media negotiation is refused
   by the server until the Mac approves.
5. iPhone posts an SDP **offer** (generation 1, random peer id); Mac answers;
   both trickle ICE candidates. On `connected`, the Mac reports status and the
   server **deletes the SDP and candidates**.
6. Mac measures the received track (meter, preflight) and the operator starts
   the session. Heartbeats (15 s) keep the pairing alive; it expires 10 min
   after both stop, with a 6 h hard ceiling.

### Reconnection

| Event | What happens |
| --- | --- |
| Wi-Fi blip (ICE `disconnected`/`failed`) | Phone performs ICE restarts on the same peer (2 s, 5 s, 10 s). The Mac's track survives, so the live capture never notices beyond a gap. |
| ICE restarts fail / phone reloads | One fresh peer (new peer id). The Mac closes the old peer first, fires `ended`; the live session's transport supervisor retries (≈15 s budget) and re-attaches to the new stream. |
| Phone taps **마이크 정지** | Phone sends `stop` on the data channel; Mac closes the peer, shows "paused"; the console strip says so. Tapping **마이크 시작** again re-negotiates; the session auto-resumes. |
| Still not restored after 45 s | Mac shows **연결 실패** with network/TURN guidance. |
| Either side ends | Pairing is revoked server-side; the other side learns `ended` with a reason. |

Completed transcript segments are never discarded by any of the above.

---

## STT compatibility

Remote audio needs a recogniser that accepts **explicit raw audio**:
**Deepgram** or **OpenAI** (both already supported). The browser's Web Speech
API opens its own (local) microphone and cannot consume a remote stream.

- If the selected recogniser is Browser/Web Speech, the panel explains why and
  offers to switch to the deployment's configured raw-audio provider when one
  exists; otherwise it says the deployment lacks one. **Start stays blocked.**
- `useLiveSession` independently refuses (`unsupported`) any remote session
  whose effective provider is not Deepgram/OpenAI — including a token route
  that falls back to demo. ASAD never substitutes the Mac's microphone or a
  demo transcript.
- Pairing and the audio preflight still work without a raw-audio recogniser,
  so transport can be verified on any deployment.
- The iPhone never receives STT credentials; it never talks to the STT vendor.

---

## Network requirements

- **Same Wi-Fi:** direct host candidates; no STUN or TURN needed. Measured in
  Chromium: ~0.7–1 s approve→connected, 1–2 ms RTT.
- **Different networks** (phone on cellular, client-isolated guest Wi-Fi,
  strict firewalls): WebRTC may find no path. Pairing still works — the phone
  falls back to the **server relay** automatically. Configure TURN to keep
  these cases on WebRTC with lower delay.
- Both pages need **HTTPS** (browsers require a secure context for the microphone).
  Vercel Preview/Production URLs qualify. `localhost` is only usable on the
  Mac itself — the panel warns when the pairing link would be `localhost`.
- **Vercel Deployment Protection:** if the Preview requires Vercel login, the
  iPhone must be able to pass it too (log in on the phone, or use a protection
  bypass link you control).

## STUN / TURN

| Variable | Default | Meaning |
| --- | --- | --- |
| `REMOTE_MIC_STUN_URLS` | `stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302` | Comma list, or `none` to disable STUN |
| `REMOTE_MIC_TURN_URLS` | — | `turn:`/`turns:` URLs. Unset = **no relay** (no recurring cost introduced) |
| `REMOTE_MIC_TURN_SECRET` | — | coturn `use-auth-secret` shared secret → per-pairing credentials that expire (preferred) |
| `REMOTE_MIC_TURN_USERNAME` / `REMOTE_MIC_TURN_CREDENTIAL` | — | Static credential, if the relay has no REST secret |
| `REMOTE_MIC_ICE_TRANSPORT_POLICY` | `all` | `relay` forces TURN (testing); ignored if no TURN is configured |
| `REMOTE_MIC_CLOUDFLARE_TURN_KEY_ID` / `REMOTE_MIC_CLOUDFLARE_TURN_API_TOKEN` | — | Cloudflare Realtime TURN key: the server mints per-pairing ICE servers (`generate-ice-servers`, TTL 6 h, port-53 URLs dropped). Cloudflare lists 1,000 GB/month free; voice is ~30 MB/hour. Any Cloudflare failure falls back to the static config |
| `REMOTE_MIC_TRANSPORT` | `auto` | `relay` = skip WebRTC, always use the ASAD server relay |

STUN carries no audio and no credential (it reveals the devices' public IP to
the STUN operator). TURN credentials are returned **only** to an authenticated
pairing role, never via `/api/config` or diagnostics. ASAD ships with no relay
and no hard-coded relay credentials.

## Environment variables (summary)

| Needed for | Variables |
| --- | --- |
| Pairing on Vercel (required) | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` + `KV_REST_API_TOKEN`, or a prefixed Marketplace pair) — the same store Counter Mode uses |
| Transcribing the remote audio | `STT_PROVIDER=deepgram` + `DEEPGRAM_API_KEY` (+ `DEEPGRAM_PROJECT_ID` for short-lived keys), or `STT_PROVIDER=openai` + `OPENAI_API_KEY` |
| Lower delay on hard networks (optional) | `REMOTE_MIC_CLOUDFLARE_TURN_*` or `REMOTE_MIC_TURN_*` above — without them the server relay is used |
| Private deployment | existing `APP_ACCESS_KEY` / `SESSION_SECRET` — unchanged |

Note: the committed `vercel.json` sets `STT_PROVIDER=webspeech`. Remote
Microphone can pair and meter audio under that setting, but cannot transcribe
it until a raw-audio provider is configured for that environment.

---

## Security model

| Threat | Control |
| --- | --- |
| Guessing a pairing | 128-bit id + 192-bit one-time secret; claim rate-limited per address; 5-minute window |
| QR screenshot / second phone takes over | Secret hash cleared on first claim → `409 ALREADY_CLAIMED`; Mac must also **approve** the matching 4-digit code |
| Phone escalating to ASAD access | Sender token is scoped to one role in one pairing; it is not a cookie, grants no app session, cannot open pairings, mint STT credentials or reach any paid route (tested) |
| Cross-site request forgery | Capability tokens travel in a custom header (`x-asad-remote-mic-token`), never cookies; same-origin enforced on every route |
| Unrestricted audio ingestion | The only audio endpoint is the relay: writable only with the approved phone's token, only while that pairing is in relay mode (checked atomically in one Lua script with the write), ≤ 10 frames / 96 KB per request, ≤ 40 frames kept, 60 s TTL; readable only with the computer's token |
| Credential theft from storage | Every token/secret stored only as a domain-separated SHA-256 hash; constant-time comparison |
| Role confusion | Only the Mac approves/rejects/answers; only the phone offers; tested per route |
| Replay / stale negotiation | Monotonic generations; stale offers/answers/candidates refused |
| Abuse / flooding | Per-role and per-address limits (local floor + shared Redis counters); candidate count bounded per negotiation |
| Leaking network details | SDP/candidates deleted as soon as the Mac reports `connected`; ended pairings scrubbed and kept 2 min; whole record TTL'd |
| Logging sensitive data | Routes log nothing; store errors are never echoed (they could quote SDP) |
| Private deployment | Creating a pairing requires the existing access gate + session token; `APP_ACCESS_KEY`/`SESSION_SECRET` behaviour unchanged |

**Not stored on the server:** transcripts, SDP after connection, and — on
the direct path — audio. On the **relay** path, audio frames sit in the shared
store transiently (≤ ~12 s, 60 s TTL, deleted when the pairing ends); or IP addresses in persistent storage (shared rate-limit keys are
hashed by the existing limiter; the in-process limiter holds them in memory
only for its window). Media is encrypted end-to-end between the two browsers by WebRTC's
mandatory DTLS-SRTP; with TURN, the relay forwards encrypted packets only.

Cloud consent is unchanged: the launcher's existing disclosure gate still runs
before anything reaches the STT provider, and its Deepgram/OpenAI notice
covers the remote audio exactly as it covers a local microphone.

---

## Browser compatibility

| Role | Supported | Notes |
| --- | --- | --- |
| iPhone sender | Safari, iOS 16+ (WebRTC + getUserMedia + data channels). Screen Wake Lock needs iOS 16.4+ | Must be HTTPS and a direct tap on **마이크 시작** (also unlocks Web Audio for the relay) |
| Android sender | Current Chrome or Samsung Internet (getUserMedia + WebRTC or Web Audio) | Same. In-app browsers (KakaoTalk, NAVER, Instagram…) are detected and the page asks to open the default browser; KakaoTalk gets a one-tap `kakaotalk://web/openExternal` link (untested on device) |
| Mac receiver | Chrome / Edge (latest), Safari 17+ | Chrome needs the remote stream attached to a (muted) media element before Web Audio receives samples — handled |
| Automated tests | Chromium (Playwright) with iPhone viewport emulation | **Not** iOS Safari |

## Known iOS limitations

- **Background / lock:** iOS suspends microphone capture for web pages that are
  backgrounded or when the screen locks. ASAD does **not** claim otherwise.
  Keep Safari in the foreground; the page holds a Screen Wake Lock where
  supported and otherwise tells the user to set Auto-Lock to Never and keep the
  phone charging.
- **Calls, Siri, other audio apps** can mute or end the capture track. The page
  shows the interruption; an ended track needs a new tap on **마이크 시작**.
- **Route changes** (AirPods/Bluetooth/headphones) can change the active mic;
  the page notes it and shows the current input label — re-check the level.
- **Low Power Mode** may throttle the page; keep the phone charging.
- **Voice processing** (echo/noise reduction) is off by default (it can strip
  soft Korean consonants); a toggle exists for noisy rooms.
- A phone is a **room microphone**, not a console feed: it hears the room,
  reverb, the congregation and possibly the interpreter. The preflight warns
  about this in worship contexts. Prefer a clean mixer feed when available.

---

## Performance findings (Chromium, same host, automated)

Measured by `scripts/e2e-remote-mic.mjs` — two Chromium contexts on one
machine, host candidates, no STUN. **Not a Wi-Fi measurement**; real-world
numbers must come from the device test below.

| Metric | Result |
| --- | --- |
| Pairing (QR click → phone claimed; scripted, no human scanning) | ~2.2 s |
| Approve → WebRTC connected | ~0.75–1.0 s |
| Round-trip time (ICE candidate pair) | 1–2 ms |
| Jitter buffer | ~33 ms |
| Estimated transport delay (RTT/2 + jitter buffer + 20 ms Opus frame) | ~55 ms (target < 300 ms) |
| Packet loss | 0 |
| Session start → first non-silent frame at STT socket | ~120–130 ms |
| Frame format at STT | 1600 bytes / 50 ms = 16 kHz mono PCM16 ✓ |

Transport is measured separately from STT and LLM latency; the E2E uses a mock
STT socket, so recognition and translation latency are **not** represented.
The launcher shows live RTT, estimated transport delay, loss, jitter buffer,
pairing and connection times for real devices.

---

## Troubleshooting

| Symptom | Likely cause → fix |
| --- | --- |
| Launcher: "공유 저장소가 연결되지 않았습니다" | Vercel without Redis → connect Upstash Redis to the project and redeploy |
| Phone: "보안 연결(HTTPS)에서만…" | Opened over `http://` → use the HTTPS URL |
| Phone: "마이크 권한이 거부되었습니다" | Safari: **aA › 웹 사이트 설정 › 마이크 › 허용** (or Settings › Safari › Microphone) |
| Phone: "이미 다른 기기에서 사용" | QR already used → Mac: **새로 연결** for a fresh QR |
| Phone: "링크가 만료" | > 5 min, or the Mac cancelled → new QR |
| Mac stuck at "연결하는 중…" for > 10 s | Should not happen: the phone falls back to the server relay after ~8 s. Check the phone's 전송 방식 row and its internet connection |
| Relay delay feels long (~1 s) | Expected for the relay. Same Wi-Fi or a TURN relay keeps the call on WebRTC (~0.1 s) |
| Connected but meter flat | Phone muted, mic covered, Safari backgrounded, or iOS interruption → check the phone screen |
| Meter red / "너무 큼" | Phone too close to a speaker → move it back |
| "선택한 인식 방식과 함께 쓸 수 없음" | Browser STT selected → switch to Deepgram/OpenAI (or configure one) |
| Console strip "iPhone microphone stopped" | Someone tapped **마이크 정지** → tap **마이크 시작**; the session resumes |

---

## Device test checklist

Run on the deployed HTTPS URL. Mark each item only when actually observed.

**MacBook Air M1 (Chrome or Safari)**

1. Open `/live`. In 고급 설정 confirm 인식 = Deepgram (or OpenAI).
2. 오디오 입력 방식 → **원격 마이크 (iPhone)** → **iPhone 연결**. A QR appears.

**Phone (iPhone Safari or Android Chrome; same Wi-Fi first, then repeat on mobile data to exercise the relay)**

3. Camera → scan the QR → open in Safari.
4. Tap **마이크 시작** → allow the microphone. A 4-digit code appears.
5. Mac: confirm the same code → **승인**. Both show 연결됨 / 맥북으로 전송 중.
6. Speak: the Mac meter moves; checks 1–3 turn ✓; tick check 5.
7. Mac: **통역 시작**. Say:
   "안녕하세요. 지금 아이폰 마이크를 이용해서 실시간 한국어 받아쓰기 기능을 테스트하고 있습니다."
8. Expected: Korean appears in the console; English assistance follows.
9. Phone **마이크 정지** → console strip says the phone stopped; no new text.
10. Phone **마이크 시작** → audio resumes automatically; transcript is kept; no
    duplicated text.
11. 10-minute continuous run with Safari in the foreground (record any drops).
12. Toggle the iPhone's Wi-Fi off for ~5 s, then on → recovery within ~15 s,
    transcript kept (record time to recover).
13. Mac: End session → **연결 끊기** → phone shows 연결 종료됨, orange mic
    indicator disappears.
14. Note RTT / 추정 전송 지연 / 패킷 손실 from the Mac panel.

## Automated verification

```bash
npm test                         # includes remote-mic unit + integration tests
npm run build && npm start &
npm run e2e:remote-mic -- http://localhost:3000 ./e2e-out/remote-mic
```
