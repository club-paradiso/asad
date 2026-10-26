/**
 * Remote Microphone end-to-end check — REAL browser WebRTC, real audio.
 *
 * Two Chromium contexts against a running server:
 *
 *   desktop  /live launcher, Remote Microphone selected (the MacBook)
 *   phone    the pairing link, iPhone viewport + touch (the iPhone)
 *
 * The phone's microphone is Chromium's fake capture device fed from a
 * generated speech-band WAV, so the audio is real samples travelling over a
 * real RTCPeerConnection (DTLS-SRTP, Opus) between two browser contexts. The
 * only mocks are at the edges ASAD does not own: `/api/config` is told a
 * Deepgram key exists, `/api/stt/token` returns a dummy credential, and the
 * Deepgram WebSocket is answered by an in-test mock that MEASURES the PCM16
 * frames it receives and replies with a Korean transcript.
 *
 * What this is NOT: iOS Safari. It is Chromium with an iPhone viewport.
 * Physical iPhone + MacBook verification remains a separate, manual step.
 *
 *   node scripts/e2e-remote-mic.mjs http://localhost:3000 ./e2e-out/remote-mic
 *
 * Variants (environment):
 *   E2E_PHONE=android            emulate an Android phone (Pixel 7) instead of an iPhone
 *   E2E_EXPECT_TRANSPORT=relay   the server runs with REMOTE_MIC_TRANSPORT=relay: assert
 *                                the audio took the ASAD server relay, not WebRTC
 *
 * Exits non-zero if any check fails.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromiumLaunchOptions } from "./browser.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const outDir = process.argv[3] ?? "./e2e-out/remote-mic";
mkdirSync(outDir, { recursive: true });

const results = [];
const metrics = {};
const check = (name, passed, detail = "") => {
  results.push({ name, passed: !!passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, timeoutMs = 15_000, stepMs = 100) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      // keep polling
    }
    if (Date.now() > deadline) return null;
    await sleep(stepMs);
  }
}

/* --- A speech-band test signal: 48 kHz mono PCM16 WAV, syllable-rate envelope -- */
function speechLikeWav(path, seconds = 12, rate = 48_000) {
  const samples = seconds * rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const t = i / rate;
    // ~4 Hz syllable envelope with short gaps, voiced harmonics of 140 Hz.
    const envelope = Math.max(0, Math.sin(2 * Math.PI * 4 * t)) ** 0.6;
    const voiced =
      0.55 * Math.sin(2 * Math.PI * 140 * t) +
      0.3 * Math.sin(2 * Math.PI * 280 * t) +
      0.15 * Math.sin(2 * Math.PI * 1100 * t);
    const value = Math.max(-1, Math.min(1, 0.45 * envelope * voiced));
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

const wavPath = join(outDir, "speech-like.wav");
speechLikeWav(wavPath);

const browser = await chromium.launch(
  chromiumLaunchOptions({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wavPath}`,
      "--autoplay-policy=no-user-gesture-required",
      // Containers often lack multicast DNS; expose host candidates directly.
      "--disable-features=WebRtcHideLocalIpsWithMdns",
    ],
  }),
);

const PHONE_DEVICE = process.env.E2E_PHONE === "android" ? "Pixel 7" : "iPhone 13";
const RELAY = process.env.E2E_EXPECT_TRANSPORT === "relay";

const KOREAN = "안녕하세요. 지금 아이폰 마이크를 이용해서 실시간 한국어 받아쓰기 기능을 테스트하고 있습니다.";

/* --- Mock Deepgram: measures what the existing capture pipeline sends --------- */
const stt = { connections: 0, frames: 0, bytes: 0, nonSilent: 0, lastRms: 0, transcriptsSent: 0, firstNonSilentAt: 0 };
function pcmRms(buffer) {
  const view = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 2));
  let sum = 0;
  for (const sample of view) sum += (sample / 32768) ** 2;
  return view.length ? Math.sqrt(sum / view.length) : 0;
}

async function desktopContext() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  await context.addInitScript(() => {
    // The privacy disclosure is covered by its own tests; acknowledge it so the
    // launcher can be driven. Recorded, not hidden: see the report.
    localStorage.setItem("tong-yuck:free-tier-privacy-ack-v2", "1");
    // Count MacBook microphone opens. Remote mode must never call this.
    window.__gumCalls = 0;
    const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (original) {
      navigator.mediaDevices.getUserMedia = (constraints) => {
        window.__gumCalls += 1;
        return original(constraints);
      };
    }
  });
  await context.route("**/api/config", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.stt = { configured: "deepgram", cloudAvailable: true };
    await route.fulfill({ response, json: body });
  });
  await context.route("**/api/stt/token", (route) =>
    route.fulfill({ json: { provider: "deepgram", token: "e2e-temporary", url: "ws://stt.e2e.test/v1/listen" } }),
  );
  await context.routeWebSocket(/stt\.e2e\.test/, (ws) => {
    stt.connections += 1;
    let sentPartial = false;
    let nonSilentHere = 0;
    ws.onMessage((message) => {
      if (typeof message === "string") return;
      stt.frames += 1;
      stt.bytes += message.length;
      const rms = pcmRms(message);
      stt.lastRms = rms;
      if (rms > 0.01) {
        stt.nonSilent += 1;
        nonSilentHere += 1;
        if (!stt.firstNonSilentAt) stt.firstNonSilentAt = Date.now();
      }
      if (nonSilentHere === 12 && !sentPartial) {
        sentPartial = true;
        ws.send(JSON.stringify({ type: "Results", is_final: false, channel: { alternatives: [{ transcript: "안녕하세요 지금 아이폰" }] } }));
      }
      if (nonSilentHere === 30) {
        stt.transcriptsSent += 1;
        ws.send(JSON.stringify({ type: "Results", is_final: true, channel: { alternatives: [{ transcript: KOREAN }] } }));
      }
    });
  });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(`exception: ${error.message}`));
  return { context, page, problems };
}

async function phoneContext(extraInit) {
  const context = await browser.newContext({ ...devices[PHONE_DEVICE], colorScheme: "dark" });
  if (extraInit) await context.addInitScript(extraInit);
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(`exception: ${error.message}`));
  return { context, page, problems };
}

const remoteState = (page) => page.evaluate(() => window.__asadRemoteMic ?? null);
const senderState = (page) => page.evaluate(() => window.__asadRemoteMicSender?.snapshot() ?? null);
const noHorizontalScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/* =============================================================================
 * 1. Desktop pairing UI
 * ========================================================================== */
const desk = await desktopContext();
await desk.page.goto(`${base}/live`, { waitUntil: "networkidle" });
await desk.page.getByRole("radio", { name: /원격 마이크/ }).click();
const panel = desk.page.getByTestId("remote-mic-panel");
check("desktop shows the Remote Microphone panel", await panel.isVisible());
check(
  "desktop offers Remote Microphone separately from device inputs (Continuity stays a device)",
  (await desk.page.getByRole("radio", { name: /이 맥의 입력 장치/ }).count()) === 1,
);
check(
  "Start is blocked before a phone is paired",
  await desk.page.getByRole("button", { name: /통역 시작/ }).isDisabled(),
);
await desk.page.screenshot({ path: join(outDir, "desktop-1440-idle.png") });

const pairClickedAt = Date.now();
await desk.page.getByRole("button", { name: "휴대폰 연결" }).click();
const linkInput = desk.page.getByTestId("remote-mic-link");
await linkInput.waitFor({ timeout: 10_000 });
const pairingLink = await linkInput.inputValue();
check("pairing link carries its secret in the URL fragment", /\/remote-mic#p=[\w-]{22}\.[\w-]{32}$/.test(pairingLink));
check("desktop renders a QR code", (await desk.page.getByRole("img", { name: /QR/ }).count()) > 0);
await desk.page.screenshot({ path: join(outDir, "desktop-1440-qr.png") });

/* =============================================================================
 * 2. Phone sender UI and pairing
 * ========================================================================== */
const phone = await phoneContext();
await phone.page.goto(pairingLink, { waitUntil: "networkidle" });
check("phone sender UI renders", await phone.page.getByRole("button", { name: "마이크 시작" }).isVisible());
check("phone layout has no horizontal scroll (390 px)", await noHorizontalScroll(phone.page));
await phone.page.screenshot({ path: join(outDir, "phone-390-idle-dark.png") });

await phone.page.getByRole("button", { name: "마이크 시작" }).click();
const phoneCode = await until(async () => {
  const el = phone.page.getByTestId("sender-confirm-code");
  return (await el.count()) ? (await el.textContent())?.trim() : null;
});
check("phone shows a 4-digit confirmation code", /^\d{4}$/.test(phoneCode ?? ""), phoneCode ?? "none");
check("pairing secret is removed from the phone's address bar after claim", !(await phone.page.evaluate(() => location.hash)));

const deskCode = await until(async () => {
  const el = desk.page.getByTestId("remote-mic-confirm-code");
  return (await el.count()) ? (await el.textContent())?.trim() : null;
});
metrics.pairingMs = Date.now() - pairClickedAt;
check("desktop shows the same code for approval", deskCode === phoneCode, `${deskCode} / ${phoneCode}`);
await desk.page.screenshot({ path: join(outDir, "desktop-1440-approve.png") });

/* --- A second phone with the same QR is refused (takeover protection) ------ */
const intruder = await phoneContext();
await intruder.page.goto(pairingLink, { waitUntil: "networkidle" });
// The first phone's claim stripped nothing from THIS copy of the link.
await intruder.page.getByRole("button", { name: "마이크 시작" }).click();
const intruderAlert = await until(async () => {
  const alert = intruder.page.getByRole("alert");
  return (await alert.count()) ? await alert.first().textContent() : null;
});
check("a second device using the same QR is refused", /이미 다른 기기/.test(intruderAlert ?? ""), intruderAlert ?? "");
await intruder.context.close();

/* --- Approve and connect ---------------------------------------------------- */
const approvedAt = Date.now();
await desk.page.getByRole("button", { name: "승인" }).click();
const connected = await until(async () => {
  const [d, p] = await Promise.all([remoteState(desk.page), senderState(phone.page)]);
  return d?.phase === "connected" && p?.phase === "connected" ? d : null;
}, 20_000);
metrics.approveToConnectedMs = Date.now() - approvedAt;
check(
  RELAY ? "server relay connects in real Chromium (no WebRTC)" : "WebRTC negotiation completes in real Chromium",
  !!connected,
  connected ? `${metrics.approveToConnectedMs} ms` : "timed out",
);
check(
  `audio takes the expected transport (${RELAY ? "relay" : "direct"})`,
  connected?.transport === (RELAY ? "relay" : "direct") && (await senderState(phone.page))?.transport === (RELAY ? "relay" : "direct"),
  `desktop=${connected?.transport} phone=${(await senderState(phone.page))?.transport}`,
);
check("receiver holds exactly one live remote audio track", connected?.liveTracks === 1);

/* --- Actual audio samples ----------------------------------------------------- */
const meterValue = await until(async () => {
  const value = Number(await desk.page.getByTestId("remote-mic-meter").getAttribute("aria-valuenow"));
  return value > 3 ? value : null;
}, 15_000);
check("desktop meter shows the ACTUAL received level", !!meterValue, `aria-valuenow=${meterValue}`);
const stats = await until(async () => {
  const s = await remoteState(desk.page);
  return s?.stats?.packetsReceived > (RELAY ? 10 : 50) && s.stats.rttMs !== null ? s.stats : null;
}, 15_000);
check(RELAY ? "relay frames are arriving" : "RTP packets are arriving (getStats)", !!stats, stats ? `${stats.packetsReceived} packets, ${stats.bytesReceived} bytes` : "");
Object.assign(metrics, {
  webrtcConnectMs: (await remoteState(desk.page))?.metrics?.connectMs ?? null,
  rttMs: stats?.rttMs ?? null,
  jitterMs: stats?.jitterMs ?? null,
  jitterBufferMs: stats?.jitterBufferMs ?? null,
  estimatedTransportMs: stats?.estimatedTransportMs ?? null,
  packetsLost: stats?.packetsLost ?? null,
  candidateType: stats?.localCandidateType ?? null,
});
const preflightOk = await until(async () => {
  const text = await desk.page.getByLabel("원격 마이크 점검").innerText();
  return /✓\s*1\./.test(text) && /✓\s*2\./.test(text) && /✓\s*3\./.test(text) ? text : null;
}, 15_000);
check("preflight separates pairing, samples and usable level (all verified)", !!preflightOk);
await desk.page.getByText("5. 올바른 소리입니다.").click();
await desk.page.screenshot({ path: join(outDir, "desktop-1440-connected.png") });
await phone.page.screenshot({ path: join(outDir, "phone-390-connected-dark.png") });

/* =============================================================================
 * 3. Real transcription session through the EXISTING pipeline
 * ========================================================================== */
const startButton = desk.page.getByRole("button", { name: /통역 시작/ });
check("Start is enabled once samples are verified", await startButton.isEnabled());
const startedAt = Date.now();
await startButton.click();
const sttFlowing = await until(() => (stt.nonSilent >= 30 ? stt : null), 20_000);
check(
  "existing MicrophoneCapture sends non-silent 16 kHz PCM16 frames to the STT socket",
  !!sttFlowing,
  `${stt.frames} frames, ${stt.nonSilent} non-silent, last RMS ${stt.lastRms.toFixed(3)}, ${stt.bytes} bytes`,
);
check("frames are 16 kHz mono PCM16 (~50 ms = 1600 bytes)", stt.frames > 0 && Math.round(stt.bytes / stt.frames) === 1600, `${Math.round(stt.bytes / Math.max(1, stt.frames))} bytes/frame`);
metrics.startToFirstAudioAtSttMs = stt.firstNonSilentAt ? stt.firstNonSilentAt - startedAt : null;
const koreanShown = await until(async () => /받아쓰기/.test(await desk.page.locator("body").innerText()), 15_000);
check("Korean transcript from the (mock) STT is displayed", !!koreanShown);
const englishShown = await until(async () => {
  const text = await desk.page.locator("main").first().innerText();
  return /[A-Za-z]{3,}/.test(text.replace(/Waiting for the speaker\.|Connecting…|Not listening\./g, "")) ? text : null;
}, 15_000);
check("interpretation pipeline produces English assistance", !!englishShown);
check("MacBook microphone was never opened (getUserMedia calls = 0)", (await desk.page.evaluate(() => window.__gumCalls)) === 0);
await desk.page.screenshot({ path: join(outDir, "desktop-1440-live.png") });

/* --- Stop on the phone stops the incoming audio ------------------------------ */
await phone.page.getByRole("button", { name: "마이크 정지" }).click();
const stripShown = await until(async () => {
  const strip = desk.page.getByTestId("remote-mic-strip");
  return (await strip.count()) ? await strip.textContent() : null;
}, 8000);
check("console reports the phone stopped, never a healthy status", /stopped|not connected|reconnect/i.test(stripShown ?? ""), stripShown ?? "");
const nonSilentAtStop = stt.nonSilent;
await sleep(2500);
// The relay's playout queue (~0.35 s ≈ 7 STT frames) still drains after the stop.
check("no audio reaches STT after the phone stops", stt.nonSilent - nonSilentAtStop <= (RELAY ? 10 : 2), `${stt.nonSilent - nonSilentAtStop} non-silent frames after stop`);
check("transcript is preserved after the phone stops", /받아쓰기/.test(await desk.page.locator("body").innerText()));

/* --- Restart does not duplicate the stream ----------------------------------- */
await phone.page.getByRole("button", { name: "마이크 시작" }).click();
const resumed = await until(async () => {
  const s = await remoteState(desk.page);
  return s?.phase === "connected" && s.liveTracks === 1 && stt.nonSilent > nonSilentAtStop + 20 ? s : null;
}, 25_000);
check("restart reconnects and audio flows again automatically", !!resumed, `${stt.connections} STT connections so far`);
check("restart does not duplicate the stream (one live track)", resumed?.liveTracks === 1);

/* --- Connection interruption ------------------------------------------------- */
const beforeDrop = stt.nonSilent;
if (process.env.E2E_DEBUG) {
  for (const [label, page] of [["phone", phone.page], ["desk", desk.page]]) {
    page.on("response", async (response) => {
      if (!response.url().includes("/api/remote-mic/")) return;
      const request = response.request();
      let action = "";
      try { action = JSON.parse(request.postData() ?? "{}").action ?? ""; } catch {}
      let body = "";
      try { body = (await response.text()).slice(0, 160); } catch {}
      console.log(`[${label}] ${request.method()} ${new URL(response.url()).pathname} ${action} -> ${response.status()} ${body.replace(/"sdp":"[^"]*"/g, '"sdp":"…"')}`);
    });
  }
}
await phone.page.evaluate(() => window.__asadRemoteMicSender.simulateNetworkDrop());
const recovered = await until(async () => {
  const [d, p] = await Promise.all([remoteState(desk.page), senderState(phone.page)]);
  return d?.phase === "connected" && p?.phase === "connected" && d.liveTracks === 1 && stt.nonSilent > beforeDrop + 20 ? d : null;
}, 30_000);
check(
  "abrupt peer loss: bounded reconnection restores audio to STT",
  !!recovered,
  recovered
    ? ""
    : JSON.stringify({
        desktop: await remoteState(desk.page).then((s) => s && { phase: s.phase, liveTracks: s.liveTracks, trackMuted: s.trackMuted }),
        phone: await senderState(phone.page),
        nonSilentSinceDrop: stt.nonSilent - beforeDrop,
        sttConnections: stt.connections,
      }),
);
check("transcript survives the interruption", /받아쓰기/.test(await desk.page.locator("body").innerText()));
check("still no MacBook microphone opened", (await desk.page.evaluate(() => window.__gumCalls)) === 0);

/* --- End session, then end the pairing --------------------------------------- */
await desk.page.getByRole("button", { name: "End session" }).click();
await desk.page.getByTestId("remote-mic-panel").waitFor({ timeout: 15_000 }).catch(() => {});
const endButton = desk.page.getByRole("button", { name: "연결 끊기" });
if (await endButton.count()) await endButton.click();
const phoneEnded = await until(async () => (await senderState(phone.page))?.phase === "ended", 15_000);
check("ending on the Mac closes the phone side", !!phoneEnded);
check("phone microphone released after end", (await senderState(phone.page))?.live === false);
check("desktop holds no remote track after end", (await remoteState(desk.page))?.liveTracks === 0);
await phone.page.screenshot({ path: join(outDir, "phone-390-ended-dark.png") });

/* =============================================================================
 * 4. Failure paths in fresh contexts
 * ========================================================================== */
{
  const p = await phoneContext();
  await p.page.goto(`${base}/remote-mic`, { waitUntil: "networkidle" });
  const text = await p.page.getByRole("alert").first().textContent().catch(() => "");
  check("invalid QR (no pairing data) explains what to do", /QR 코드/.test(text ?? ""), text ?? "");
  await p.page.goto(`${base}/remote-mic#p=${"A".repeat(22)}.${"b".repeat(32)}`, { waitUntil: "networkidle" });
  await p.page.reload({ waitUntil: "networkidle" });
  await p.page.getByRole("button", { name: "마이크 시작" }).click();
  const expired = await until(async () => {
    const alert = p.page.getByRole("alert");
    return (await alert.count()) ? await alert.first().textContent() : null;
  });
  check("unknown/expired pairing link is refused with guidance", /만료/.test(expired ?? ""), expired ?? "");
  await p.context.close();
}

{
  // Revoked pairing: the Mac cancels the QR before the phone uses it.
  const d = await desktopContext();
  await d.page.goto(`${base}/live`, { waitUntil: "networkidle" });
  await d.page.getByRole("radio", { name: /원격 마이크/ }).click();
  await d.page.getByRole("button", { name: "휴대폰 연결" }).click();
  await d.page.getByTestId("remote-mic-link").waitFor();
  const link = await d.page.getByTestId("remote-mic-link").inputValue();
  await d.page.getByRole("button", { name: "취소" }).click();
  const p = await phoneContext();
  await p.page.goto(link, { waitUntil: "networkidle" });
  await p.page.getByRole("button", { name: "마이크 시작" }).click();
  const revoked = await until(async () => {
    const alert = p.page.getByRole("alert");
    return (await alert.count()) ? await alert.first().textContent() : null;
  });
  check("revoked (cancelled) pairing cannot be joined", /만료/.test(revoked ?? ""), revoked ?? "");
  await d.page.setViewportSize({ width: 1280, height: 800 });
  await d.page.getByRole("button", { name: /새로 연결|휴대폰 연결/ }).click();
  await d.page.getByTestId("remote-mic-link").waitFor();
  check("MacBook Air 1280×800: no horizontal scroll", await noHorizontalScroll(d.page));
  await d.page.screenshot({ path: join(outDir, "desktop-1280-qr.png"), fullPage: true });
  await d.page.setViewportSize({ width: 820, height: 1180 });
  check("tablet 820×1180: no horizontal scroll", await noHorizontalScroll(d.page));
  await d.page.screenshot({ path: join(outDir, "tablet-820-qr.png"), fullPage: true });
  await d.context.close();
  await p.context.close();
}

{
  // Microphone permission denied.
  const d = await desktopContext();
  await d.page.goto(`${base}/live`, { waitUntil: "networkidle" });
  await d.page.getByRole("radio", { name: /원격 마이크/ }).click();
  await d.page.getByRole("button", { name: "휴대폰 연결" }).click();
  await d.page.getByTestId("remote-mic-link").waitFor();
  const link = await d.page.getByTestId("remote-mic-link").inputValue();
  const p = await phoneContext(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await p.page.goto(link, { waitUntil: "networkidle" });
  await p.page.getByRole("button", { name: "마이크 시작" }).click();
  const denied = await until(async () => {
    const alert = p.page.getByRole("alert");
    return (await alert.count()) ? await alert.first().textContent() : null;
  });
  check("microphone permission failure is explained on the phone", /권한이 거부/.test(denied ?? ""), denied ?? "");
  check("Mac is still waiting (a denied phone never claimed the pairing)", (await remoteState(d.page))?.phase === "waiting");
  await p.page.emulateMedia({ colorScheme: "light" });
  await p.page.screenshot({ path: join(outDir, "phone-390-denied-light.png") });
  await d.context.close();
  await p.context.close();
}

{
  // Browser-only recogniser: remote is explained and Start stays blocked.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => localStorage.setItem("tong-yuck:free-tier-privacy-ack-v2", "1"));
  await context.route("**/api/config", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.stt = { configured: "webspeech", cloudAvailable: false };
    await route.fulfill({ response, json: body });
  });
  const page = await context.newPage();
  await page.goto(`${base}/live`, { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /원격 마이크/ }).click();
  const notice = await page.getByTestId("remote-mic-panel").innerText();
  check(
    "with only browser STT, the incompatibility is explained (no silent substitution)",
    /Deepgram 또는 OpenAI/.test(notice),
  );
  check("…and Start is blocked", await page.getByRole("button", { name: /통역 시작|개인정보/ }).isDisabled());
  await context.close();
}

const problems = [...desk.problems, ...phone.problems];
check("no uncaught page exceptions", problems.length === 0, problems.slice(0, 3).join(" | "));

metrics.stt = { connections: stt.connections, frames: stt.frames, nonSilent: stt.nonSilent };
const report = {
  base,
  browser: `Chromium ${browser.version()} (${PHONE_DEVICE} emulation for the phone — NOT a real phone browser)`,
  transport: RELAY ? "relay" : "direct",
  at: new Date().toISOString(),
  metrics,
  results,
};
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log("\nMETRICS", JSON.stringify(metrics));
await browser.close();

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
