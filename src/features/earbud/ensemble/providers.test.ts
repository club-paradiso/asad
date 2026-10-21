import { describe, expect, it, vi } from "vitest";
import { translateIndex, translateAzure, azureSourceLanguage } from "./providers";
const input = { source: "en-US", text: "My E-7-1 visa expires on Friday." };
describe("official provider wire contracts", () => {
  it("disables Index reasoning and does not send API credentials", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({choices:[{message:{content:"제 E-7-1 비자는 금요일에 만료됩니다."}}]}),
        {status:200})) as unknown as typeof fetch;
    expect(await translateIndex(input, new AbortController().signal, fetcher))
      .toContain("E-7-1");
    const [url, opts] = vi.mocked(fetcher).mock.calls[0];
    expect(String(url)).toBe("https://index-translate.bilibili.com/v1/chat/completions");
    const payload = JSON.parse(String(opts?.body));
    expect(payload.chat_template_kwargs.enable_thinking).toBe(false);
    expect(payload.model).toBe("Index-Translate-35B-A3B");
    expect(JSON.stringify(opts?.headers)).not.toContain("Bearer");
  });
  it("passes target English to the real API contract when Korean is the source", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({choices:[{message:{content:"My passport is expiring."}}]}), {status:200})
    ) as unknown as typeof fetch;
    await translateIndex({ source: "ko-KR", target: "en-US", text: "여권 유효기간이 만료됩니다." },
      new AbortController().signal, fetcher);
    const body = JSON.parse(String(vi.mocked(fetcher).mock.calls[0][1]?.body));
    expect(body.messages[0].content).toContain("English");
    expect(body.messages[0].content).toContain("en-US");
  });
  it("uses Azure from=ko to=en for Korean source and English output", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      {translations:[{to:"en",text:"My passport is expiring."}]}
    ]), {status:200})) as unknown as typeof fetch;
    await translateAzure({source:"ko-KR",target:"en-US",text:"여권이 만료됩니다."},
      new AbortController().signal,"TEST",undefined,fetcher);
    const url = String(vi.mocked(fetcher).mock.calls[0][0]);
    expect(url).toContain("from=ko");
    expect(url).toContain("to=en");
  });
  it("uses documented Azure F0 REST translate endpoint and region header", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify([{translations:[{to:"ko",text:"체류기간이 만료됩니다."}]}]),
      {status:200})) as unknown as typeof fetch;
    expect(await translateAzure(input, new AbortController().signal,
      "TEST_KEY", "koreacentral", fetcher)).toContain("만료");
    const [url, opts] = vi.mocked(fetcher).mock.calls[0];
    expect(String(url)).toContain("api-version=3.0");
    expect(String(url)).toContain("from=en");
    expect(opts?.headers).toEqual(expect.objectContaining({
      "Ocp-Apim-Subscription-Key": "TEST_KEY",
      "Ocp-Apim-Subscription-Region": "koreacentral",
    }));
  });
  it("maps simplified/traditional Chinese, and rejects bad payloads", async () => {
    expect(azureSourceLanguage("zh-CN")).toBe("zh-Hans");
    expect(azureSourceLanguage("zh-TW")).toBe("zh-Hant");
    const broken = vi.fn(async () => new Response("{}")) as unknown as typeof fetch;
    await expect(translateIndex(input, new AbortController().signal, broken)).rejects.toThrow();
  });
});
