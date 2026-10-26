/**
 * Remote Microphone copy for the phone page.
 *
 * Any phone: iPhone (Safari), Android (Chrome, Samsung Internet) or anything
 * else with a modern browser. Wording is device-neutral; the few instructions
 * that differ by platform — where the microphone permission lives, how to stop
 * the screen locking — come from PLATFORM_TEXT.
 *
 * Korean first, because the person holding the phone at a Korean church is
 * most likely Korean; English one tap away.
 */
import type { SenderErrorCode, SenderPhase } from "@/remote-mic/sender";
import type { PhonePlatform } from "./platform";

export type RemoteMicLang = "ko" | "en";

export const SENDER_TEXT = {
  ko: {
    title: "ASAD 원격 마이크",
    subtitle: "이 휴대폰을 컴퓨터의 무선 마이크로 씁니다.",
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
    transport: "전송 방식",
    transportDirect: "직접 연결",
    transportRelay: "서버 중계",
    confirmTitle: "컴퓨터 화면의 번호와 같은지 확인하세요",
    confirmBody: "같으면 컴퓨터에서 「승인」을 누르세요.",
    voiceProcessing: "소음·에코 제거 (주변이 시끄러울 때만 켜세요)",
    keepOpen:
      "이 화면을 켜 둔 채로 두세요. 화면이 잠기거나 다른 앱으로 가면 휴대폰이 마이크를 멈출 수 있습니다.",
    wakeLockHeld: "화면 꺼짐 방지: 켜짐",
    wakeLockPending: "화면 꺼짐 방지를 켜는 중…",
    hiddenWarning:
      "다른 화면에 다녀오는 동안 오디오가 끊겼을 수 있습니다. 컴퓨터의 레벨 막대를 확인하세요.",
    routeChanged: "오디오 경로가 바뀌었습니다(이어폰·블루투스 등). 컴퓨터에서 레벨을 다시 확인하세요.",
    interrupted: "전화·음성 비서·다른 앱이 마이크를 쓰고 있어 소리가 잠시 끊겼습니다.",
    relayNote:
      "같은 Wi-Fi가 아니어도 됩니다. 지금은 ASAD 서버를 거쳐 보내는 중이라 직접 연결보다 1초 정도 늦을 수 있습니다.",
    usingInput: "사용 중인 입력",
    language: "English",
    ended: "연결이 종료되었습니다. 컴퓨터에서 새 QR 코드를 만들어 다시 스캔하세요.",
    privacy:
      "오디오는 암호화되어 전송됩니다. 가능하면 컴퓨터로 직접 가고, 직접 연결이 안 되는 네트워크(모바일 데이터 등)에서는 ASAD 서버를 거쳐 중계됩니다. 중계 오디오는 서버에 최대 1분만 머문 뒤 지워지고, 연결을 끝내면 바로 지워집니다.",
    noPairing: "연결 정보가 없는 주소입니다. 컴퓨터 ASAD 화면의 QR 코드를 휴대폰 카메라로 스캔하세요.",
    inApp: (app: string) =>
      `${app} 안의 브라우저에서는 마이크가 막히는 경우가 많습니다. 오른쪽 위 메뉴(⋮ 또는 ⋯)에서 「다른 브라우저로 열기」를 누르세요.`,
    openExternal: "기본 브라우저로 열기",
  },
  en: {
    title: "ASAD Remote Microphone",
    subtitle: "Use this phone as a wireless microphone for the computer.",
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
    transport: "Route",
    transportDirect: "Direct",
    transportRelay: "Server relay",
    confirmTitle: "Check this number matches the computer",
    confirmBody: "If it matches, press Approve on the computer.",
    voiceProcessing: "Noise & echo reduction (only in noisy rooms)",
    keepOpen:
      "Keep this page open on screen. If the screen locks or you switch apps, the phone may stop the microphone.",
    wakeLockHeld: "Keep-awake: on",
    wakeLockPending: "Turning on keep-awake…",
    hiddenWarning: "Audio may have stopped while you were away. Check the level on the computer.",
    routeChanged: "The audio route changed (headphones or Bluetooth). Re-check the level on the computer.",
    interrupted: "A call, a voice assistant or another app took the microphone; audio paused.",
    relayNote:
      "No shared Wi-Fi needed. Audio is going through the ASAD server right now, about a second later than a direct link.",
    usingInput: "Input in use",
    language: "한국어",
    ended: "Connection ended. Create a new QR code on the computer and scan it again.",
    privacy:
      "Audio is encrypted in transit. It goes straight to the computer when it can; on networks that block that (mobile data, guest Wi-Fi) it is relayed through ASAD's server, where it stays at most a minute and is deleted as soon as you end the connection.",
    noPairing: "This address has no pairing information. Scan the QR code on the computer's ASAD screen with the phone camera.",
    inApp: (app: string) =>
      `Browsers inside ${app} often block the microphone. Open the menu (⋮ or ⋯) and choose "Open in browser".`,
    openExternal: "Open in default browser",
  },
} as const;

/** Instructions that depend on the phone's platform. */
export const PLATFORM_TEXT: Record<RemoteMicLang, Record<PhonePlatform, { permission: string; autoLock: string }>> = {
  ko: {
    ios: {
      permission:
        "주소창의 「aA」 › 웹 사이트 설정 › 마이크 › 허용으로 바꾼 뒤 다시 시작하세요. (설정 › Safari › 마이크에서도 바꿀 수 있습니다.)",
      autoLock:
        "이 기기는 화면 꺼짐 방지를 자동으로 켤 수 없습니다. 설정 › 디스플레이 및 밝기 › 자동 잠금을 「안 함」으로 바꾸고 충전기에 연결해 두세요.",
    },
    android: {
      permission:
        "주소창 왼쪽의 자물쇠(또는 ⓘ) 아이콘 › 권한 › 마이크 › 허용으로 바꾼 뒤 다시 시작하세요. (설정 › 애플리케이션 › Chrome › 권한 › 마이크에서도 바꿀 수 있습니다.)",
      autoLock:
        "이 기기는 화면 꺼짐 방지를 자동으로 켤 수 없습니다. 설정 › 디스플레이 › 화면 자동 꺼짐 시간을 가장 길게 하고 충전기에 연결해 두세요.",
    },
    other: {
      permission: "브라우저 주소창의 사이트 설정에서 마이크를 「허용」으로 바꾼 뒤 다시 시작하세요.",
      autoLock: "이 기기는 화면 꺼짐 방지를 자동으로 켤 수 없습니다. 화면 자동 잠금을 끄고 충전기에 연결해 두세요.",
    },
  },
  en: {
    ios: {
      permission:
        "Tap “aA” in the address bar › Website Settings › Microphone › Allow, then start again. (Also under Settings › Safari › Microphone.)",
      autoLock:
        "This device cannot keep the screen awake automatically. Set Settings › Display & Brightness › Auto-Lock to Never and keep it charging.",
    },
    android: {
      permission:
        "Tap the lock (or ⓘ) icon left of the address › Permissions › Microphone › Allow, then start again. (Also under Settings › Apps › Chrome › Permissions.)",
      autoLock:
        "This device cannot keep the screen awake automatically. Set Settings › Display › Screen timeout to the longest value and keep it charging.",
    },
    other: {
      permission: "Allow the microphone in your browser's site settings (address bar), then start again.",
      autoLock: "This device cannot keep the screen awake automatically. Turn off auto-lock and keep it charging.",
    },
  },
};

export const SENDER_PHASE_TEXT: Record<RemoteMicLang, Record<SenderPhase, string>> = {
  ko: {
    idle: "시작 전",
    "requesting-mic": "마이크 권한 요청 중…",
    claiming: "컴퓨터에 연결 요청 중…",
    "awaiting-approval": "컴퓨터의 승인을 기다리는 중",
    connecting: "컴퓨터와 연결하는 중…",
    connected: "컴퓨터로 전송 중",
    reconnecting: "연결이 끊겨 다시 연결하는 중…",
    stopped: "마이크를 멈췄습니다",
    failed: "연결할 수 없습니다",
    ended: "연결 종료됨",
  },
  en: {
    idle: "Not started",
    "requesting-mic": "Requesting microphone…",
    claiming: "Contacting the computer…",
    "awaiting-approval": "Waiting for the computer to approve",
    connecting: "Connecting to the computer…",
    connected: "Sending to the computer",
    reconnecting: "Connection lost — reconnecting…",
    stopped: "Microphone stopped",
    failed: "Cannot connect",
    ended: "Connection ended",
  },
};

export const SENDER_ERROR_TEXT: Record<RemoteMicLang, Record<SenderErrorCode, string>> = {
  ko: {
    INSECURE_CONTEXT: "보안 연결(HTTPS)에서만 마이크를 쓸 수 있습니다. https:// 로 시작하는 주소로 여세요.",
    UNSUPPORTED:
      "이 브라우저는 원격 마이크를 지원하지 않습니다. iPhone은 Safari(iOS 16 이상), Android는 최신 Chrome 또는 삼성 인터넷으로 여세요.",
    PERMISSION_DENIED: "마이크 권한이 거부되었습니다.",
    NO_MICROPHONE: "사용할 수 있는 마이크를 찾지 못했습니다.",
    MIC_BUSY: "다른 앱(통화·녹음 등)이 마이크를 쓰고 있습니다. 그 앱을 닫고 다시 시작하세요.",
    MIC_INTERRUPTED: "휴대폰이 마이크를 멈췄습니다(전화·화면 잠금 등). 「마이크 시작」을 다시 누르세요.",
    INVALID_LINK: "유효하지 않은 연결 링크입니다. 컴퓨터에서 QR 코드를 다시 스캔하세요.",
    EXPIRED: "연결 링크가 만료되었습니다. 컴퓨터에서 「휴대폰 연결」을 다시 눌러 새 QR 코드를 스캔하세요.",
    ALREADY_CLAIMED: "이 QR 코드는 이미 다른 기기에서 사용되었습니다. 컴퓨터에서 새 QR 코드를 만드세요.",
    REJECTED: "컴퓨터에서 연결을 거부했습니다.",
    SIGNALING_UNAVAILABLE: "연결 서버에 닿지 않습니다. Wi-Fi나 모바일 데이터가 켜져 있는지 확인하고 다시 시도하세요.",
    ICE_FAILED:
      "컴퓨터와 연결하지 못했습니다. 직접 연결도 서버 중계도 되지 않았습니다. 인터넷 연결을 확인하고 「다시 연결」을 누르세요.",
    RATE_LIMITED: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
  },
  en: {
    INSECURE_CONTEXT: "The microphone only works over a secure (HTTPS) connection. Open an https:// address.",
    UNSUPPORTED:
      "This browser does not support the remote microphone. On iPhone use Safari (iOS 16+); on Android use a current Chrome or Samsung Internet.",
    PERMISSION_DENIED: "Microphone permission was denied.",
    NO_MICROPHONE: "No usable microphone was found.",
    MIC_BUSY: "Another app (a call or recorder) is using the microphone. Close it and start again.",
    MIC_INTERRUPTED: "The phone stopped the microphone (a call, the screen locking). Tap Start Microphone again.",
    INVALID_LINK: "This pairing link is not valid. Scan the QR code on the computer again.",
    EXPIRED: "This pairing link has expired. Press Pair phone on the computer again and scan the new QR code.",
    ALREADY_CLAIMED: "This QR code was already used by another device. Create a new one on the computer.",
    REJECTED: "The computer declined the connection.",
    SIGNALING_UNAVAILABLE: "Cannot reach the connection server. Check Wi-Fi or mobile data and try again.",
    ICE_FAILED:
      "Could not reach the computer, directly or through the server relay. Check the internet connection and tap Reconnect.",
    RATE_LIMITED: "Too many requests. Wait a moment and try again.",
  },
};
