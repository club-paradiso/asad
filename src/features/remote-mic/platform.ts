/**
 * Which kind of phone opened the pairing page — only to pick the right
 * instructions (where the microphone permission lives, how to keep the screen
 * on). The pairing itself never depends on it: any browser with getUserMedia
 * and Web Audio can send.
 */
export type PhonePlatform = "ios" | "android" | "other";

export interface PhoneEnvironment {
  platform: PhonePlatform;
  /** An app's built-in browser (KakaoTalk, NAVER, Instagram…), which often blocks the mic. */
  inAppBrowser: string | null;
}

const IN_APP: Array<[RegExp, string]> = [
  [/KAKAOTALK/i, "카카오톡"],
  [/NAVER\(inapp|NAVER\/|whale.*inapp/i, "네이버 앱"],
  [/Instagram/i, "Instagram"],
  [/FBAN|FBAV|FB_IAB/i, "Facebook"],
  [/\bLine\//i, "LINE"],
  [/DaumApps/i, "다음 앱"],
  [/BAND\//i, "BAND"],
  [/everytimeApp/i, "에브리타임"],
];

export function detectPhoneEnvironment(userAgent: string, maxTouchPoints = 0): PhoneEnvironment {
  const ios =
    /iPhone|iPad|iPod/i.test(userAgent) ||
    // iPadOS reports a Mac user agent; touch support gives it away.
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  const platform: PhonePlatform = ios ? "ios" : /Android/i.test(userAgent) ? "android" : "other";
  const inApp = IN_APP.find(([pattern]) => pattern.test(userAgent));
  return { platform, inAppBrowser: inApp ? inApp[1] : null };
}

/**
 * KakaoTalk's in-app browser honours this scheme and reopens the page in the
 * phone's default browser. Other apps have no such scheme; the page shows
 * manual instructions instead.
 */
export function externalBrowserUrl(env: PhoneEnvironment, href: string): string | null {
  return env.inAppBrowser === "카카오톡" ? `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}` : null;
}
