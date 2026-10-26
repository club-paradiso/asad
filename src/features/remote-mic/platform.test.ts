import { describe, expect, it } from "vitest";
import { detectPhoneEnvironment, externalBrowserUrl } from "./platform";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  galaxy: "Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-A546N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
  kakao: "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0 Mobile Safari/537.36 KAKAOTALK 25.6.0",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0",
};

describe("phone environment detection", () => {
  it("tells iPhone, iPadOS (Mac UA + touch), Android and Samsung Internet apart", () => {
    expect(detectPhoneEnvironment(UA.iphone).platform).toBe("ios");
    expect(detectPhoneEnvironment(UA.ipad, 5).platform).toBe("ios");
    expect(detectPhoneEnvironment(UA.ipad, 0).platform).toBe("other");
    expect(detectPhoneEnvironment(UA.galaxy)).toEqual({ platform: "android", inAppBrowser: null });
    expect(detectPhoneEnvironment(UA.samsung)).toEqual({ platform: "android", inAppBrowser: null });
  });

  it("flags in-app browsers and offers KakaoTalk's external-open scheme only for KakaoTalk", () => {
    const kakao = detectPhoneEnvironment(UA.kakao);
    expect(kakao).toEqual({ platform: "android", inAppBrowser: "카카오톡" });
    const href = "https://asad.example/remote-mic#p=abc.def";
    expect(externalBrowserUrl(kakao, href)).toBe(`kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`);
    const insta = detectPhoneEnvironment(UA.instagram);
    expect(insta).toEqual({ platform: "ios", inAppBrowser: "Instagram" });
    expect(externalBrowserUrl(insta, href)).toBeNull();
  });
});
