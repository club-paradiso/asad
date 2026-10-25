/**
 * Remote Microphone copy for the iPhone page.
 *
 * Korean first, because the person holding the phone at a Korean church is
 * most likely Korean; English one tap away. The MacBook launcher stays Korean
 * like the rest of the launcher, and the live console stays English like the
 * rest of the console.
 */
import type { SenderErrorCode, SenderPhase } from "@/remote-mic/sender";

export type RemoteMicLang = "ko" | "en";

export const SENDER_TEXT = {
  ko: {
    title: "ASAD 원격 마이크",
    subtitle: "이 iPhone을 맥북의 무선 마이크로 씁니다.",
    start: "마이크 시작",
    stop: "마이크 정지",
    mute: "음소거",
    unmute: "음소거 해제",
    reconnect: "다시 연결",
    leave: "연결 종료",
    micActive: "마이크 켜짐",
    micOff: "마이크 꺼짐",
    mutedBadge: "음소거 중",
    level: "입력 레벨",
    permission: "마이크 권한",
    connection: "연결 상태",
    confirmTitle: "맥북 화면의 번호와 같은지 확인하세요",
    confirmBody: "같으면 맥북에서 「승인」을 누르세요.",
    voiceProcessing: "소음·에코 제거 (주변이 시끄러울 때만 켜세요)",
    keepOpen:
      "Safari를 이 화면에 켜 둔 채로 두세요. 화면이 잠기거나 다른 앱으로 이동하면 iOS가 마이크를 멈출 수 있습니다.",
    wakeLockHeld: "화면 꺼짐 방지: 켜짐",
    wakeLockUnsupported:
      "이 기기는 화면 꺼짐 방지를 지원하지 않습니다. 설정 › 디스플레이 및 밝기 › 자동 잠금을 「안 함」으로 바꾸고 충전기에 연결해 두세요.",
    wakeLockPending: "화면 꺼짐 방지를 켜는 중…",
    hiddenWarning:
      "다른 화면에 다녀오는 동안 오디오가 끊겼을 수 있습니다. 맥북의 레벨 막대를 확인하세요.",
    routeChanged: "오디오 경로가 바뀌었습니다(이어폰·블루투스 등). 맥북에서 레벨을 다시 확인하세요.",
    interrupted: "전화·Siri·다른 앱이 마이크를 쓰고 있어 소리가 잠시 끊겼습니다.",
    usingInput: "사용 중인 입력",
    language: "English",
    ended: "연결이 종료되었습니다. 맥북에서 새 QR 코드를 만들어 다시 스캔하세요.",
    privacy:
      "오디오는 이 iPhone에서 맥북으로 직접, 암호화되어 전송됩니다. ASAD 서버에는 저장되지 않습니다.",
    noPairing: "연결 정보가 없는 주소입니다. 맥북 ASAD 화면의 QR 코드를 iPhone 카메라로 스캔하세요.",
  },
  en: {
    title: "ASAD Remote Microphone",
    subtitle: "Use this iPhone as a wireless microphone for the MacBook.",
    start: "Start Microphone",
    stop: "Stop Microphone",
    mute: "Mute",
    unmute: "Unmute",
    reconnect: "Reconnect",
    leave: "End connection",
    micActive: "Microphone on",
    micOff: "Microphone off",
    mutedBadge: "Muted",
    level: "Input level",
    permission: "Microphone permission",
    connection: "Connection",
    confirmTitle: "Check this number matches the MacBook",
    confirmBody: "If it matches, press Approve on the MacBook.",
    voiceProcessing: "Noise & echo reduction (only in noisy rooms)",
    keepOpen:
      "Keep Safari open on this screen. If the screen locks or you switch apps, iOS may stop the microphone.",
    wakeLockHeld: "Keep-awake: on",
    wakeLockUnsupported:
      "This device cannot keep the screen awake automatically. Set Settings › Display & Brightness › Auto-Lock to Never and keep it charging.",
    wakeLockPending: "Turning on keep-awake…",
    hiddenWarning: "Audio may have stopped while you were away. Check the level on the MacBook.",
    routeChanged: "The audio route changed (headphones or Bluetooth). Re-check the level on the MacBook.",
    interrupted: "A call, Siri or another app took the microphone; audio paused.",
    usingInput: "Input in use",
    language: "한국어",
    ended: "Connection ended. Create a new QR code on the MacBook and scan it again.",
    privacy:
      "Audio goes directly from this iPhone to the MacBook, encrypted. It is not stored on ASAD's servers.",
    noPairing: "This address has no pairing information. Scan the QR code on the MacBook's ASAD screen with the iPhone camera.",
  },
} as const;

export const SENDER_PHASE_TEXT: Record<RemoteMicLang, Record<SenderPhase, string>> = {
  ko: {
    idle: "시작 전",
    "requesting-mic": "마이크 권한 요청 중…",
    claiming: "맥북에 연결 요청 중…",
    "awaiting-approval": "맥북의 승인을 기다리는 중",
    connecting: "맥북과 연결하는 중…",
    connected: "맥북으로 전송 중",
    reconnecting: "연결이 끊겨 다시 연결하는 중…",
    stopped: "마이크를 멈췄습니다",
    failed: "연결할 수 없습니다",
    ended: "연결 종료됨",
  },
  en: {
    idle: "Not started",
    "requesting-mic": "Requesting microphone…",
    claiming: "Contacting the MacBook…",
    "awaiting-approval": "Waiting for the MacBook to approve",
    connecting: "Connecting to the MacBook…",
    connected: "Sending to the MacBook",
    reconnecting: "Connection lost — reconnecting…",
    stopped: "Microphone stopped",
    failed: "Cannot connect",
    ended: "Connection ended",
  },
};

export const SENDER_ERROR_TEXT: Record<RemoteMicLang, Record<SenderErrorCode, string>> = {
  ko: {
    INSECURE_CONTEXT: "보안 연결(HTTPS)에서만 마이크를 쓸 수 있습니다. https:// 로 시작하는 주소로 여세요.",
    UNSUPPORTED: "이 브라우저는 원격 마이크를 지원하지 않습니다. iPhone의 Safari(iOS 16 이상)로 여세요.",
    PERMISSION_DENIED:
      "마이크 권한이 거부되었습니다. 주소창의 「aA」 › 웹 사이트 설정 › 마이크 › 허용으로 바꾼 뒤 다시 시작하세요. (설정 › Safari › 마이크에서도 바꿀 수 있습니다.)",
    NO_MICROPHONE: "사용할 수 있는 마이크를 찾지 못했습니다.",
    MIC_BUSY: "다른 앱(통화·녹음 등)이 마이크를 쓰고 있습니다. 그 앱을 닫고 다시 시작하세요.",
    MIC_INTERRUPTED: "iOS가 마이크를 멈췄습니다(전화·화면 잠금 등). 「마이크 시작」을 다시 누르세요.",
    INVALID_LINK: "유효하지 않은 연결 링크입니다. 맥북에서 QR 코드를 다시 스캔하세요.",
    EXPIRED: "연결 링크가 만료되었습니다. 맥북에서 「iPhone 연결」을 다시 눌러 새 QR 코드를 스캔하세요.",
    ALREADY_CLAIMED: "이 QR 코드는 이미 다른 기기에서 사용되었습니다. 맥북에서 새 QR 코드를 만드세요.",
    REJECTED: "맥북에서 연결을 거부했습니다.",
    SIGNALING_UNAVAILABLE: "연결 서버에 닿지 않습니다. Wi-Fi를 확인하고 다시 시도하세요.",
    ICE_FAILED:
      "맥북과 직접 연결하지 못했습니다. 두 기기가 같은 Wi-Fi에 있는지 확인하세요. 게스트 Wi-Fi는 기기 간 통신을 막는 경우가 많습니다.",
    RATE_LIMITED: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
  },
  en: {
    INSECURE_CONTEXT: "The microphone only works over a secure (HTTPS) connection. Open an https:// address.",
    UNSUPPORTED: "This browser does not support the remote microphone. Open it in Safari on iPhone (iOS 16 or later).",
    PERMISSION_DENIED:
      "Microphone permission was denied. Tap “aA” in the address bar › Website Settings › Microphone › Allow, then start again.",
    NO_MICROPHONE: "No usable microphone was found.",
    MIC_BUSY: "Another app (a call or recorder) is using the microphone. Close it and start again.",
    MIC_INTERRUPTED: "iOS stopped the microphone (a call, the screen locking). Tap Start Microphone again.",
    INVALID_LINK: "This pairing link is not valid. Scan the QR code on the MacBook again.",
    EXPIRED: "This pairing link has expired. Press Pair iPhone on the MacBook again and scan the new QR code.",
    ALREADY_CLAIMED: "This QR code was already used by another device. Create a new one on the MacBook.",
    REJECTED: "The MacBook declined the connection.",
    SIGNALING_UNAVAILABLE: "Cannot reach the connection server. Check Wi-Fi and try again.",
    ICE_FAILED:
      "Could not connect directly to the MacBook. Make sure both are on the same Wi-Fi. Guest Wi-Fi often blocks device-to-device traffic.",
    RATE_LIMITED: "Too many requests. Wait a moment and try again.",
  },
};
