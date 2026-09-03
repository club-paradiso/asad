import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The counter API, exercised through its route handlers.
 *
 * The domain modules are unit-tested next to themselves; what these cover is
 * the part a browser actually touches — status codes, the shape of the JSON,
 * and the two paths that deliberately do NOT call a model.
 *
 * The translation service is mocked: it is tested separately, it needs a
 * server-only import, and a network call has no place in a unit test.
 */
const translateForCounter = vi.hoisted(() => vi.fn());
vi.mock("@/counter/translate", () => ({
  translateForCounter,
  COUNTER_DEADLINE_MS: 6000,
}));

import { DELETE, GET, PATCH, POST } from "./session/route";
import { POST as SEND } from "./message/route";
import { __setCounterStore, createMemoryStore } from "@/counter/store";
import { SESSION_COOKIE, issueSessionToken } from "@/lib/guard";
import type { SessionView } from "@/counter/types";
import { COUNTER_TOKEN_HEADER } from "@/counter/access";

/**
 * A browser that has loaded the application.
 *
 * `/api/counter/message` reaches a model, so it is guarded like every other
 * paid route: same-origin, session-bound, body-capped and rate limited. These
 * tests send what a real visitor's phone sends.
 */
const authorised = () => ({
  origin: "http://localhost",
  cookie: `${SESSION_COOKIE}=${issueSessionToken()}`,
  "content-type": "application/json",
});

const post = (body: unknown) =>
  new Request("http://localhost/api/counter/session", {
    method: "POST",
    body: JSON.stringify(body),
  });

const participants = new Map<string, { host: string; guest?: string }>();

const patch = (body: { code: string; guestLang: string }) =>
  new Request("http://localhost/api/counter/session", {
    method: "PATCH",
    headers: participants.get(body.code)?.guest
      ? { [COUNTER_TOKEN_HEADER]: participants.get(body.code)!.guest! }
      : undefined,
    body: JSON.stringify(body),
  });

const send = (body: { code: string; from: "host" | "guest"; [key: string]: unknown }) =>
  new Request("http://localhost/api/counter/message", {
    method: "POST",
    headers: {
      ...authorised(),
      [COUNTER_TOKEN_HEADER]: participants.get(body.code)?.[body.from] ?? "invalid",
    },
    body: JSON.stringify(
      Object.fromEntries(Object.entries(body).filter(([key]) => key !== "from")),
    ),
  });

const get = (code: string, since = 0) =>
  new Request(`http://localhost/api/counter/session?code=${code}&since=${since}`, {
    headers: { [COUNTER_TOKEN_HEADER]: participants.get(code)?.host ?? "invalid" },
  });

const remove = (code: string) =>
  new Request(`http://localhost/api/counter/session?code=${code}`, {
    method: "DELETE",
    headers: { [COUNTER_TOKEN_HEADER]: participants.get(code)?.host ?? "invalid" },
  });

async function createSession(
  input: { hostLang: string; deskLabel?: string; profileId?: string } = { hostLang: "ko-KR" },
) {
  const response = await POST(post(input));
  const body = (await response.clone().json()) as {
    session?: SessionView;
    participantToken?: string;
  };
  if (body.session && body.participantToken) {
    participants.set(body.session.code, { host: body.participantToken });
  }
  return { response, ...body };
}

async function joinSession(code: string, guestLang: string) {
  const response = await PATCH(patch({ code, guestLang }));
  const body = (await response.clone().json()) as {
    session?: SessionView;
    participantToken?: string;
  };
  if (body.participantToken) {
    const current = participants.get(code);
    if (current) participants.set(code, { ...current, guest: body.participantToken });
  }
  return { response, ...body };
}

/** Create a session and have a guest join it. Returns the code. */
async function openSession(guestLang = "en-US"): Promise<string> {
  const created = await createSession();
  await joinSession(created.session!.code, guestLang);
  return created.session!.code;
}

beforeEach(() => {
  __setCounterStore(createMemoryStore());
  participants.clear();
  translateForCounter.mockReset();
  translateForCounter.mockResolvedValue({
    ok: true,
    output: { translation: "Please wait at counter 2 until 3:00.", confidence: "high" },
    provider: "groq",
    latencyMs: 400,
  });
});

describe("POST /api/counter/session", () => {
  it("creates a session waiting for a visitor", async () => {
    const response = await POST(
      post({ hostLang: "ko-KR", deskLabel: "접수 창구 2", profileId: "immigration" }),
    );
    expect(response.status).toBe(201);

    const { session, participantToken } = (await response.json()) as {
      session: SessionView;
      participantToken: string;
    };
    expect(session.state).toBe("waiting");
    expect(session.guestLang).toBeNull();
    expect(session.guestPresent).toBe(false);
    expect(session.deskLabel).toBe("접수 창구 2");
    expect(session.profileId).toBe("immigration");
    expect(typeof participantToken).toBe("string");
    expect(JSON.stringify(session)).not.toMatch(/token|hash/i);
  });

  it("refuses a language it cannot actually serve", async () => {
    // Better to fail at setup than to seat a visitor in front of a language
    // the picker will not offer them.
    expect((await POST(post({ hostLang: "xx-XX" }))).status).toBe(400);
  });

  it("rejects a malformed body rather than inventing defaults", async () => {
    expect((await POST(post({}))).status).toBe(400);
  });
});

describe("PATCH /api/counter/session — the visitor joining", () => {
  it("activates the session and records the language", async () => {
    const { session } = await createSession();

    const joined = await joinSession(session!.code, "vi-VN");
    expect(joined.response.status).toBe(200);

    const view = joined.session!;
    expect(view.state).toBe("active");
    expect(view.guestLang).toBe("vi-VN");
    expect(view.guestPresent).toBe(true);
  });

  it("accepts the code in whatever form the visitor typed it", async () => {
    const { session } = await createSession();
    const typed = `ty-${session!.code.toLowerCase()}`;
    const joined = await PATCH(patch({ code: typed, guestLang: "en-US" }));
    expect(joined.status).toBe(200);
  });

  it("lets a visitor fix a mis-tapped language before they have said anything", async () => {
    const code = await openSession("th-TH");
    const again = await PATCH(patch({ code, guestLang: "km-KH" }));
    expect(again.status).toBe(200);
    expect(((await again.json()) as { session: SessionView }).session.guestLang).toBe("km-KH");
  });

  it("refuses a second scanner even before the claimed visitor speaks", async () => {
    const code = await openSession("th-TH");
    const secondScanner = await PATCH(
      new Request("http://localhost/api/counter/session", {
        method: "PATCH",
        body: JSON.stringify({ code, guestLang: "th-TH" }),
      }),
    );
    expect(secondScanner.status).toBe(409);
  });

  it("refuses a different language once the visitor has spoken", async () => {
    const code = await openSession("th-TH");
    await SEND(send({ code, from: "guest", source: "text", text: "안녕하세요" }));

    // At this point a new language claim is a second person, not a correction.
    const hijack = await PATCH(patch({ code, guestLang: "ru-RU" }));
    expect(hijack.status).toBe(409);
  });

  it("404s on a code that is not live", async () => {
    expect((await PATCH(patch({ code: "AC34", guestLang: "en-US" }))).status).toBe(404);
  });
});

describe("GET /api/counter/session — polling", () => {
  it("returns only what is newer than the cursor", async () => {
    const code = await openSession();
    await SEND(send({ code, from: "host", source: "quick-phrase", text: "greeting" }));
    await SEND(send({ code, from: "host", source: "quick-phrase", text: "wait-moment" }));

    const all = ((await (await GET(get(code))).json()) as { session: SessionView }).session;
    expect(all.messages).toHaveLength(2);

    const rest = ((await (await GET(get(code, all.messages[0].seq))).json()) as {
      session: SessionView;
    }).session;
    expect(rest.messages).toHaveLength(1);
    expect(rest.messages[0].seq).toBe(2);
  });

  it("is never cached — a stale poll is a message you think you saw", async () => {
    const code = await openSession();
    expect((await GET(get(code))).headers.get("cache-control")).toBe("no-store");
  });

  it("does not treat the short desk code as permission to read the conversation", async () => {
    const code = await openSession();
    const withoutCapability = await GET(
      new Request(`http://localhost/api/counter/session?code=${code}`),
    );
    expect(withoutCapability.status).toBe(401);
  });

  it("404s once the session is gone", async () => {
    const code = await openSession();
    await DELETE(remove(code));
    expect((await GET(get(code))).status).toBe(404);
  });
});

describe("DELETE /api/counter/session", () => {
  it("discards the conversation outright", async () => {
    const code = await openSession();
    await SEND(send({ code, from: "host", source: "quick-phrase", text: "greeting" }));

    const response = await DELETE(remove(code));
    expect(await response.json()).toEqual({ ended: true });
    // Not marked ended and retained — gone.
    expect((await GET(get(code))).status).toBe(404);
  });

  it("does not treat the desk code as permission to end a conversation", async () => {
    const code = await openSession();
    const response = await DELETE(
      new Request(`http://localhost/api/counter/session?code=${code}`, { method: "DELETE" }),
    );
    expect(response.status).toBe(401);
    expect((await GET(get(code))).status).toBe(200);
  });
});

describe("POST /api/counter/message", () => {
  it("waits for the visitor's language rather than guessing one", async () => {
    const { session } = await createSession();

    const response = await SEND(
      send({ code: session!.code, from: "host", source: "text", text: "안녕하세요" }),
    );
    expect(response.status).toBe(409);
    expect(translateForCounter).not.toHaveBeenCalled();
  });

  it("serves a quick phrase from the table, never from the model", async () => {
    const code = await openSession("vi-VN");
    const response = await SEND(
      send({ code, from: "host", source: "quick-phrase", text: "greeting" }),
    );

    const body = await response.json();
    expect(body.viaModel).toBe(false);
    expect(translateForCounter).not.toHaveBeenCalled();
    expect(body.message.originalText).toBe("안녕하세요. 무엇을 도와드릴까요?");
    expect(body.message.translatedText).toBe("Xin chào. Tôi có thể giúp gì cho bạn?");
    expect(body.message.confidence).toBe("high");
  });

  it("falls back to the model when a phrase is missing for the pair", async () => {
    // Khmer has no quick-phrase translations; showing the Korean would be
    // worse than a model translation.
    const code = await openSession("km-KH");
    const response = await SEND(
      send({ code, from: "host", source: "quick-phrase", text: "greeting" }),
    );
    expect((await response.json()).viaModel).toBe(true);
    expect(translateForCounter).toHaveBeenCalledOnce();
  });

  it("echoes a confirmation verbatim instead of re-translating it", async () => {
    const code = await openSession();
    const response = await SEND(
      send({ code, from: "host", source: "confirm", text: "3:00 · 2" }),
    );

    const body = await response.json();
    expect(translateForCounter).not.toHaveBeenCalled();
    expect(body.message.originalText).toBe("3:00 · 2");
    expect(body.message.translatedText).toBe("3:00 · 2");
    expect(body.message.risks?.length).toBeGreaterThan(0);
  });

  it("translates ordinary text and flags the values worth confirming", async () => {
    const code = await openSession();
    const response = await SEND(
      send({ code, from: "host", source: "text", text: "3시까지 2번 창구에서 기다려 주세요." }),
    );

    const body = await response.json();
    expect(body.viaModel).toBe(true);
    expect(body.message.status).toBe("done");
    expect(body.message.originalLang).toBe("ko-KR");
    expect(body.message.targetLang).toBe("en-US");
    // Risks come off the TRANSLATED text: that is what the other party acts on.
    expect(body.message.risks?.some((r: { kind: string }) => r.kind === "time")).toBe(true);
    expect(body.message.integrity.status).toBe("verified");
    expect(body.message.criticalValues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "time" })]),
    );
  });

  it("downgrades a translation when a critical date changes", async () => {
    translateForCounter.mockResolvedValue({
      ok: true,
      output: { translation: "The deadline is September 17, 2026.", confidence: "high" },
      provider: "test",
      latencyMs: 30,
    });
    const code = await openSession();
    const body = await (
      await SEND(
        send({
          code,
          from: "host",
          source: "text",
          text: "기한은 2026년 9월 7일입니다.",
        }),
      )
    ).json();

    expect(body.message.confidence).toBe("low");
    expect(body.message.integrity.status).toBe("mismatch");
    expect(body.message.integrity.issues).toContainEqual(
      expect.objectContaining({ kind: "date", reason: "changed" }),
    );
    expect(body.message.originalText).toContain("9월 7일");
  });

  it("uses the stored original for explicit simplify and retry actions", async () => {
    const { session } = await createSession({ hostLang: "ko-KR", profileId: "immigration" });
    await joinSession(session!.code, "en-US");
    const first = await (
      await SEND(
        send({ code: session!.code, from: "host", source: "text", text: "수수료는 50,000원입니다." }),
      )
    ).json();

    translateForCounter.mockClear();
    const response = await SEND(
      send({
        code: session!.code,
        from: "host",
        source: "text",
        text: "클라이언트가 바꾼 내용",
        action: "simplify",
        actionOf: first.message.id,
      }),
    );
    expect(response.status).toBe(200);
    expect(translateForCounter).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "수수료는 50,000원입니다.",
        action: "simplify",
        profileId: "immigration",
      }),
    );
  });

  it("rejects a translation action that does not reference an owned message", async () => {
    const code = await openSession();
    translateForCounter.mockClear();
    const response = await SEND(
      send({
        code,
        from: "host",
        source: "text",
        text: "anything",
        action: "retry",
        actionOf: "missing",
      }),
    );
    expect(response.status).toBe(400);
    expect(translateForCounter).not.toHaveBeenCalled();
  });

  it("uses the fail-closed privacy route while a general session is still unclassified", async () => {
    const code = await openSession();
    translateForCounter.mockClear();
    await SEND(send({ code, from: "host", source: "text", text: "잠시만 기다려 주세요." }));

    expect(translateForCounter).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "general",
        forceSensitiveRouting: true,
      }),
    );
  });

  it("stores a failure as a failure rather than inventing a translation", async () => {
    translateForCounter.mockResolvedValue({
      ok: false,
      latencyMs: 6000,
      error: "Every provider timed out.",
    });

    const code = await openSession();
    const response = await SEND(
      send({ code, from: "host", source: "text", text: "서류를 보여주세요." }),
    );

    const body = await response.json();
    expect(body.message.status).toBe("failed");
    expect(body.message.translatedText).toBe("");
    expect(body.message.error).toBe("Every provider timed out.");
  });

  it("translates the guest's language into the host's, not the reverse", async () => {
    const code = await openSession("ru-RU");
    const response = await SEND(
      send({ code, from: "guest", source: "voice", text: "Где я могу подать заявление?" }),
    );

    const body = await response.json();
    expect(body.message.originalLang).toBe("ru-RU");
    expect(body.message.targetLang).toBe("ko-KR");
  });

  it("derives the sender from the capability instead of trusting a claimed role", async () => {
    const code = await openSession("ru-RU");
    const response = await SEND(
      new Request("http://localhost/api/counter/message", {
        method: "POST",
        headers: {
          ...authorised(),
          [COUNTER_TOKEN_HEADER]: participants.get(code)!.host,
        },
        body: JSON.stringify({
          code,
          from: "guest",
          source: "text",
          text: "직원이 보낸 문장",
        }),
      }),
    );
    const body = await response.json();
    expect(body.message.from).toBe("host");
    expect(body.message.originalLang).toBe("ko-KR");
  });

  it("keeps staff-only review flags off the visitor response", async () => {
    translateForCounter.mockResolvedValue({
      ok: true,
      output: { translation: "도움이 필요합니다.", confidence: "low" },
      provider: "test",
      latencyMs: 30,
    });
    const code = await openSession();
    const guestResponse = await SEND(
      send({ code, from: "guest", source: "text", text: "I need help." }),
    );
    const guestBody = await guestResponse.json();
    expect(guestBody.message.reviewFlags).toBeUndefined();

    const hostView = ((await (await GET(get(code))).json()) as { session: SessionView }).session;
    expect(hostView.messages[0].reviewFlags).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "low-confidence" })]),
    );
  });

  it("gives every message a sequence number the poller can order by", async () => {
    const code = await openSession();
    const first = await (
      await SEND(send({ code, from: "host", source: "quick-phrase", text: "greeting" }))
    ).json();
    const second = await (
      await SEND(send({ code, from: "guest", source: "text", text: "Hello" }))
    ).json();
    expect(second.message.seq).toBe(first.message.seq + 1);
  });
});
