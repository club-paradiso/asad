import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Administrative Meaning Layer and staff review, through the real routes.
 *
 * Translation is mocked; everything else — admission, profile detection, the
 * semantic checks, the analysis, staff-only stripping and the review
 * endpoint — is the production code path.
 */
const translateForCounter = vi.hoisted(() => vi.fn());
vi.mock("@/counter/translate", () => ({ translateForCounter, COUNTER_DEADLINE_MS: 6000 }));
const recordLearningCandidate = vi.hoisted(() => vi.fn(async () => ({ stored: true, durable: false })));
vi.mock("@/learning/vault", () => ({ recordLearningCandidate }));

import { PATCH, POST } from "./session/route";
import { POST as SEND } from "./message/route";
import { POST as REVIEW } from "./review/route";
import { __setCounterStore, counterStore, createMemoryStore } from "@/counter/store";
import { SESSION_COOKIE, __resetGuards, issueSessionToken } from "@/lib/guard";
import { COUNTER_TOKEN_HEADER } from "@/counter/access";
import type { CounterMessage, SessionView } from "@/counter/types";

let host = "";
let guest = "";

async function open(profileId = "immigration", guestLang = "zh-CN"): Promise<string> {
  const created = await POST(
    new Request("http://localhost/api/counter/session", {
      method: "POST",
      body: JSON.stringify({ hostLang: "ko-KR", profileId }),
    }),
  );
  const body = (await created.json()) as { session: SessionView; participantToken: string };
  host = body.participantToken;
  const joined = await PATCH(
    new Request("http://localhost/api/counter/session", {
      method: "PATCH",
      body: JSON.stringify({ code: body.session.code, guestLang }),
    }),
  );
  guest = ((await joined.json()) as { participantToken: string }).participantToken;
  return body.session.code;
}

const send = (code: string, as: "host" | "guest", payload: Record<string, unknown>) =>
  SEND(
    new Request("http://localhost/api/counter/message", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        cookie: `${SESSION_COOKIE}=${issueSessionToken()}`,
        "content-type": "application/json",
        [COUNTER_TOKEN_HEADER]: as === "host" ? host : guest,
      },
      body: JSON.stringify({ code, source: "text", ...payload }),
    }),
  );

const review = (code: string, token: string, payload: Record<string, unknown>) =>
  REVIEW(
    new Request("http://localhost/api/counter/review", {
      method: "POST",
      headers: { "content-type": "application/json", [COUNTER_TOKEN_HEADER]: token },
      body: JSON.stringify({ code, ...payload }),
    }),
  );

const translated = (translation: string, confidence: "high" | "medium" | "low" = "high") =>
  translateForCounter.mockResolvedValueOnce({
    ok: true,
    output: { translation, confidence },
    provider: "test",
    latencyMs: 10,
  });

beforeEach(() => {
  __setCounterStore(createMemoryStore());
  __resetGuards();
  translateForCounter.mockReset();
  recordLearningCandidate.mockClear();
  vi.unstubAllEnvs();
});

describe("Administrative Meaning Layer in the message route", () => {
  it("keeps the faithful translation untouched and puts the ambiguity beside it", async () => {
    const code = await open();
    translated("등록증을 연장하고 싶어요.", "medium");
    const response = await send(code, "guest", { text: "我想延期登录证。" });
    expect(response.status).toBe(200);

    // The visitor's copy: translation only, no staff analysis.
    const visitorCopy = ((await response.json()) as { message: CounterMessage }).message;
    expect(visitorCopy.translatedText).toBe("등록증을 연장하고 싶어요.");
    expect(visitorCopy.analysis).toBeUndefined();

    // The staff copy, as stored.
    const stored = (await counterStore().get(code))!.messages.at(-1)!;
    expect(stored.translatedText).toBe("등록증을 연장하고 싶어요.");
    expect(stored.originalText).toBe("我想延期登录证。");
    expect(stored.analysis?.ambiguities.map((finding) => finding.ruleId)).toEqual(["card-or-stay-extension"]);
    expect(stored.analysis?.clarifications[0].ko).toContain("체류기간");
    expect(stored.staffReview).toBeUndefined();
  });

  it("does not run ambiguity detection on the staff member's own guidance", async () => {
    const code = await open();
    translated("如果您换了工作，需要申报。");
    await send(code, "host", { text: "회사 옮기셨으면 신고하셔야 해요." });
    const stored = (await counterStore().get(code))!.messages.at(-1)!;
    expect(stored.analysis?.ambiguities ?? []).toEqual([]);
    expect(stored.analysis?.terms.length).toBeGreaterThan(0);
  });

  it("blocks a translation that turns an obligation into a permission", async () => {
    const code = await open("immigration", "en-US");
    translated("You may apply before your period of stay expires.");
    const response = await send(code, "host", { text: "체류기간 만료 전에 신청하셔야 합니다." });
    const message = ((await response.json()) as { message: CounterMessage }).message;
    expect(message.integrity?.status).toBe("mismatch");
    expect(message.integrity?.assessment).toBe("blocked");
    expect(message.confidence).toBe("low");
    expect(message.integrity?.semantic?.issues[0].check).toBe("obligation-to-permission");
    expect(message.reviewFlags?.[0].reason).toContain("행정적 의미");
  });

  it("states unverified rather than passed for a language without a semantic lexicon", async () => {
    const code = await open("immigration", "uz-UZ");
    translated("Pasportingizni bering.");
    const response = await send(code, "host", { text: "여권 주세요." });
    const message = ((await response.json()) as { message: CounterMessage }).message;
    expect(message.integrity?.assessment).toBe("unverified");
  });

  it("can be disabled by environment", async () => {
    vi.stubEnv("COUNTER_ADMIN_LAYER", "off");
    const code = await open();
    translated("등록증을 연장하고 싶어요.");
    await send(code, "guest", { text: "我想延期登录证。" });
    expect((await counterStore().get(code))!.messages.at(-1)!.analysis).toBeUndefined();
  });

  it("routes a humanitarian-stay turn to the refugee profile and keeps it out of the Learning Vault", async () => {
    const code = await open("general", "en-US");
    translated("인도적 체류 허가를 받았어요.");
    await send(code, "guest", { text: "I have a humanitarian stay permit." });
    expect((await counterStore().get(code))!.profileId).toBe("refugee");
    expect(translateForCounter.mock.calls.at(-1)![0].profileId).toBe("refugee");
  });
});

describe("corrections and clarification questions", () => {
  it("sends a correction as a new labelled message and keeps the original", async () => {
    const code = await open("immigration", "en-US");
    translated("Please come on May 3.");
    const first = ((await (await send(code, "host", { text: "5월 3일에 오세요." })).json()) as { message: CounterMessage }).message;
    translated("Please come on May 8.");
    const second = await send(code, "host", { text: "5월 8일에 오세요.", correctionOf: first.id });
    expect(second.status).toBe(200);
    const messages = (await counterStore().get(code))!.messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].originalText).toBe("5월 3일에 오세요.");
    expect(messages[1].correctionOf).toBe(first.id);
  });

  it("refuses to label someone else's message as corrected", async () => {
    const code = await open("immigration", "en-US");
    translated("여권 여기 있어요.");
    const visitor = ((await (await send(code, "guest", { text: "Here is my passport." })).json()) as { message: CounterMessage }).message;
    const response = await send(code, "host", { text: "여권 여기 있어요.", correctionOf: visitor.id });
    expect(response.status).toBe(400);
  });

  it("lets only staff ask a clarification, and only about a visitor message", async () => {
    const code = await open();
    translated("등록증을 연장하고 싶어요.");
    const visitor = ((await (await send(code, "guest", { text: "我想延期登录证。" })).json()) as { message: CounterMessage }).message;

    translated("您是来延长滞留期间的，还是来重新领取外国人登录证的？");
    const asked = await send(code, "host", {
      text: "체류기간을 연장하려고 오신 건가요, 아니면 외국인등록증 카드를 새로 받으려고 오신 건가요?",
      clarifies: visitor.id,
    });
    expect(asked.status).toBe(200);
    expect(((await asked.json()) as { message: CounterMessage }).message.clarifies).toBe(visitor.id);

    const byGuest = await send(code, "guest", { text: "?", clarifies: visitor.id });
    expect(byGuest.status).toBe(400);
  });
});

describe("POST /api/counter/review — explicit human decisions", () => {
  async function ambiguousTurn() {
    const code = await open();
    translated("등록증을 연장하고 싶어요.");
    const visitor = ((await (await send(code, "guest", { text: "我想延期登录证。" })).json()) as { message: CounterMessage }).message;
    return { code, id: visitor.id };
  }

  it("records a staff-confirmed interpretation from the offered candidates", async () => {
    const { code, id } = await ambiguousTurn();
    const response = await review(code, host, { messageId: id, decision: "confirmed", conceptId: "stay-extension" });
    expect(response.status).toBe(200);
    const stored = (await counterStore().get(code))!.messages.find((m) => m.id === id)!;
    expect(stored.staffReview).toMatchObject({ decision: "confirmed", conceptId: "stay-extension" });
    // The translation itself is never rewritten by a review.
    expect(stored.translatedText).toBe("등록증을 연장하고 싶어요.");
  });

  it("refuses a concept that was not a candidate", async () => {
    const { code, id } = await ambiguousTurn();
    expect((await review(code, host, { messageId: id, decision: "confirmed", conceptId: "deportation" })).status).toBe(400);
  });

  it("refuses the visitor and an unauthenticated caller", async () => {
    const { code, id } = await ambiguousTurn();
    expect((await review(code, guest, { messageId: id, decision: "confirmed" })).status).toBe(401);
    expect((await review(code, "nope", { messageId: id, decision: "confirmed" })).status).toBe(401);
  });

  it("supports reject and clear, and never leaks the decision to the visitor's poll", async () => {
    const { code, id } = await ambiguousTurn();
    await review(code, host, { messageId: id, decision: "rejected" });
    expect((await counterStore().get(code))!.messages.find((m) => m.id === id)!.staffReview?.decision).toBe("rejected");
    await review(code, host, { messageId: id, decision: "cleared" });
    expect((await counterStore().get(code))!.messages.find((m) => m.id === id)!.staffReview).toBeUndefined();

    await review(code, host, { messageId: id, decision: "confirmed" });
    const { GET } = await import("./session/route");
    const poll = await GET(
      new Request(`http://localhost/api/counter/session?code=${code}&since=0`, {
        headers: { [COUNTER_TOKEN_HEADER]: guest },
      }),
    );
    const view = (await poll.json()) as { session: SessionView };
    const seen = view.session.messages.find((m) => m.id === id)!;
    expect(seen.staffReview).toBeUndefined();
    expect(seen.analysis).toBeUndefined();
  });

  it("rejects a malformed body", async () => {
    const { code } = await ambiguousTurn();
    expect((await review(code, host, { messageId: "x", decision: "approve-visa" })).status).toBe(400);
  });
});
