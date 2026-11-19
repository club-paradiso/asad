import { afterEach, describe, expect, it } from "vitest";
import liveCatalog from "../../public/compat/data.json";
import demoCatalog from "../../apps/visitor-intake/data.json";
import {
  __setIntakeStore, createMemoryIntakeStore, isStaff, publicEntries,
  validCode, INTAKE_TTL_MS, NOTICE_IDS,
} from "./store";
import {
  POST as createSession, GET as readSession, PATCH as markSession,
} from "@/app/api/intake/session/route";
import { POST as submit } from "@/app/api/intake/submission/route";
import { POST as postLive } from "@/app/api/intake/live/route";
import { GET as readNotice, POST as postNotice } from "@/app/api/intake/notice/route";

const HOST = "http://localhost:3000";
const headers = { origin: HOST, "content-type": "application/json" };
const post = (path: string, body: object) => new Request(HOST + path, {
  method: "POST", headers, body: JSON.stringify(body),
});
const staff = (path: string, token: string, method: "GET" | "PATCH" | "DELETE" = "GET", body?: object) =>
  new Request(HOST + path, {
    method,
    headers: {
      ...headers,
      "x-asad-intake-staff-token": token,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

afterEach(() => __setIntakeStore(null));

describe("intake service catalog", () => {
  it("keeps live and demo catalogs aligned with 20 translated services", () => {
    expect(liveCatalog).toEqual(demoCatalog);
    expect(Object.keys(liveCatalog.locales)).toHaveLength(12);
    for (const locale of Object.values(liveCatalog.locales)) {
      expect(locale.services).toHaveLength(20);
      expect(locale.services[19]).toBeTruthy();
      expect(locale.review.phoneChangeNote).toBeTruthy();
    }
  });

  it("localizes every visitor-facing kiosk control in all 12 languages", () => {
    const keys = Object.keys(liveCatalog.locales.KO.kiosk).sort();
    expect(keys).toHaveLength(14);
    for (const locale of Object.values(liveCatalog.locales)) {
      expect(Object.keys(locale.kiosk).sort()).toEqual(keys);
      for (const value of Object.values(locale.kiosk)) {
        expect(value.trim()).not.toBe("");
        expect(value).not.toMatch(/[\u202f\u00a0]/);
      }
      expect(locale.kiosk.autoReset).toContain("{s}");
      expect(locale.kiosk.counter).toContain("{n}");
    }
    expect(liveCatalog.locales.KO.services[19]).toBe("전화번호(연락처) 변경 신고");
  });
});

describe("staff notice phrases", () => {
  it("translates every fixed phrase in all 12 languages and lists each one exactly once for staff", () => {
    const cfg = liveCatalog.notices;
    const listed = cfg.groups.flatMap(g => g.items.map(i => i.id));
    expect([...listed].sort()).toEqual([...NOTICE_IDS].sort());
    expect(cfg.counters.length).toBeGreaterThan(0);
    for (const locale of Object.values(liveCatalog.locales)) {
      expect(Object.keys(locale.notice.texts).sort()).toEqual([...NOTICE_IDS].sort());
      expect(locale.notice.ok.trim()).not.toBe("");
      for (const value of Object.values(locale.notice.texts)) {
        expect(value.trim()).not.toBe("");
        expect(value).not.toMatch(/[\u202f\u00a0]/);
      }
      expect(locale.notice.texts.counter).toContain("{n}");
    }
  });
});

describe("intake session store", () => {
  it("isolates staff capability and expires data", async () => {
    let now = 10_000;
    const store = createMemoryIntakeStore(() => now);
    const { session, staffToken } = await store.create();
    expect(validCode(session.code)).toBe(true);
    expect(isStaff(session, staffToken)).toBe(true);
    expect(isStaff(session, "someone-elses-token")).toBe(false);
    expect(isStaff(session, null)).toBe(false);
    await store.modify(session.code, s => {
      s.entries.push({
        seq: 1, requestId: crypto.randomUUID(), language: "EN", serviceIndex: 0,
        booking: "unsure", receivedAt: now, verification: "unchecked", ticket: "pending",
      });
    });
    const saved = await store.read(session.code);
    expect(saved?.entries).toHaveLength(1);
    expect(publicEntries(saved!)[0]).not.toHaveProperty("requestId");
    now += INTAKE_TTL_MS + 1;
    expect(await store.read(session.code)).toBeUndefined();
  });
});

describe("intake cross-device API", () => {
  it("accepts phone-number change as service 20, without collecting contact details", async () => {
    __setIntakeStore(createMemoryIntakeStore());
    const created = await createSession(post("/api/intake/session", {}));
    expect(created.status).toBe(201);
    const { code, staffToken } = await created.json() as { code: string; staffToken: string };
    const requestId = crypto.randomUUID();
    const response = await submit(post("/api/intake/submission", {
      code, requestId, language: "EN", serviceIndex: 19, booking: "unsure",
    }));
    expect(response.status).toBe(201);
    const staffResult = await readSession(staff("/api/intake/session?code=" + code, staffToken));
    const entries = (await staffResult.json() as { entries: Array<Record<string, unknown>> }).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].serviceIndex).toBe(19);
    expect(entries[0]).not.toHaveProperty("phoneNumber");
    expect(entries[0]).not.toHaveProperty("requestId");

    // A 21st index and extra phone-number fields must be rejected.
    expect((await submit(post("/api/intake/submission", {
      code, requestId: crypto.randomUUID(), language: "EN", serviceIndex: 20, booking: "no",
    }))).status).toBe(400);
    expect((await submit(post("/api/intake/submission", {
      code, requestId: crypto.randomUUID(), language: "EN", serviceIndex: 19, booking: "no",
      phoneNumber: "01012345678",
    }))).status).toBe(400);
  });


  it("transmits a visitor's choice to exactly one staff queue and records manual decisions", async () => {
    __setIntakeStore(createMemoryIntakeStore());
    const created = await createSession(post("/api/intake/session", {}));
    expect(created.status).toBe(201);
    const { code, staffToken } = await created.json() as { code: string; staffToken: string };
    const req = {
      code, language: "EN", serviceIndex: 5, booking: "yes",
      requestId: crypto.randomUUID(),
    };
    const sent = await submit(post("/api/intake/submission", req));
    expect(sent.status).toBe(201);
    const { seq } = await sent.json() as { seq: number };
    expect(seq).toBe(1);

    // Duplicate retry is idempotent.
    expect((await submit(post("/api/intake/submission", req))).status).toBe(201);

    const unauthorized = await readSession(new Request(HOST + "/api/intake/session?code=" + code));
    expect(unauthorized.status).toBe(401);
    const bogus = await readSession(staff("/api/intake/session?code=" + code, "wrong"));
    expect(bogus.status).toBe(403);

    const read = await readSession(staff("/api/intake/session?code=" + code, staffToken));
    const data = await read.json() as { entries: Array<{ seq: number; booking: string; language: string; serviceIndex: number }> };
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]).toMatchObject({ seq: 1, booking: "yes", language: "EN", serviceIndex: 5 });
    expect(data.entries[0]).not.toHaveProperty("requestId");

    const disallowed = await markSession(staff("/api/intake/session", staffToken, "PATCH", {
      code, seq: 1, ticket: "issued",
    }));
    expect(disallowed.status).toBe(409);

    const verified = await markSession(staff("/api/intake/session", staffToken, "PATCH", {
      code, seq: 1, verification: "confirmed",
    }));
    expect(verified.status).toBe(200);
    const issued = await markSession(staff("/api/intake/session", staffToken, "PATCH", {
      code, seq: 1, ticket: "issued",
    }));
    expect(issued.status).toBe(200);
    const result = await issued.json() as { entries: Array<{ ticket: string }> };
    expect(result.entries[0].ticket).toBe("issued");

    const other = await createSession(post("/api/intake/session", {}));
    expect(other.status).toBe(201);
    const otherSession = await other.json() as { code: string; staffToken: string };
    const crossRead = await readSession(staff("/api/intake/session?code=" + code, otherSession.staffToken));
    expect(crossRead.status).toBe(403);
  });

  it("stamps every request with its desk's counter number and keeps an optional reservation number", async () => {
    const memory = createMemoryIntakeStore();
    __setIntakeStore(memory);
    const one = await (await createSession(post("/api/intake/session", { station: 3 }))).json() as { code: string; staffToken: string; station: number };
    expect(one.station).toBe(3);
    // Second desk made directly in the store: the create endpoint is rate limited per minute.
    const made = await memory.create();
    await memory.modify(made.session.code, s => { s.station = 7; });
    const two = { code: made.session.code, staffToken: made.staffToken };

    expect((await submit(post("/api/intake/submission", {
      code: one.code, requestId: crypto.randomUUID(), language: "EN", serviceIndex: 0, booking: "yes",
      reservationNo: "ab12-3456",
    }))).status).toBe(201);
    expect((await submit(post("/api/intake/submission", {
      code: two.code, requestId: crypto.randomUUID(), language: "VI", serviceIndex: 1, booking: "no",
    }))).status).toBe(201);
    // A reservation number only goes with "booked", and must be letters, digits or hyphens.
    expect((await submit(post("/api/intake/submission", {
      code: one.code, requestId: crypto.randomUUID(), language: "EN", serviceIndex: 0, booking: "no", reservationNo: "1234",
    }))).status).toBe(400);
    expect((await submit(post("/api/intake/submission", {
      code: one.code, requestId: crypto.randomUUID(), language: "EN", serviceIndex: 0, booking: "yes", reservationNo: "12 34<script>",
    }))).status).toBe(400);

    const a = await (await readSession(staff("/api/intake/session?code=" + one.code, one.staffToken))).json() as
      { station: number; entries: Array<{ station: number; reservationNo?: string }> };
    expect(a.station).toBe(3);
    expect(a.entries).toHaveLength(1);
    expect(a.entries[0]).toMatchObject({ station: 3, reservationNo: "AB12-3456" });
    const b = await (await readSession(staff("/api/intake/session?code=" + two.code, two.staffToken))).json() as
      { entries: Array<{ station: number; reservationNo?: string }> };
    expect(b.entries).toHaveLength(1);
    expect(b.entries[0].station).toBe(7);
    expect(b.entries[0]).not.toHaveProperty("reservationNo");
  });

  it("mirrors the visitor's current screen to the staff desk only", async () => {
    __setIntakeStore(createMemoryIntakeStore());
    const created = await createSession(post("/api/intake/session", {}));
    const { code, staffToken } = await created.json() as { code: string; staffToken: string };
    const before = await readSession(staff("/api/intake/session?code=" + code, staffToken));
    expect((await before.json() as { live: unknown }).live).toBeNull();

    expect((await postLive(post("/api/intake/live", { code, step: "language" }))).status).toBe(200);
    expect((await postLive(post("/api/intake/live", {
      code, step: "review", language: "VI", serviceIndex: 4, booking: "no",
    }))).status).toBe(200);
    const read = await readSession(staff("/api/intake/session?code=" + code, staffToken));
    const { live } = await read.json() as { live: Record<string, unknown> };
    expect(live).toMatchObject({ step: "review", language: "VI", serviceIndex: 4, booking: "no" });
    expect(typeof live.updatedAt).toBe("number");

    // Out-of-order delivery within one kiosk page: an older revision arriving late is ignored.
    const epoch = "kioskpageA1234";
    expect((await postLive(post("/api/intake/live", { code, step: "sent", language: "VI", serviceIndex: 4, booking: "no", seq: 1, epoch, rev: 5 }))).status).toBe(200);
    const late = await postLive(post("/api/intake/live", { code, step: "services", language: "VI", epoch, rev: 3 }));
    expect(late.status).toBe(200);
    expect((await late.json() as { stale: boolean }).stale).toBe(true);
    const kept = await readSession(staff("/api/intake/session?code=" + code, staffToken));
    expect((await kept.json() as { live: { step: string } }).live.step).toBe("sent");
    // A reloaded kiosk (new epoch, counter back at 1) is accepted regardless of earlier revisions.
    expect((await postLive(post("/api/intake/live", { code, step: "language", epoch: "kioskpageB5678", rev: 1 }))).status).toBe(200);
    const next = await readSession(staff("/api/intake/session?code=" + code, staffToken));
    expect((await next.json() as { live: { step: string } }).live.step).toBe("language");

    // Unknown steps, languages, indices and free-text fields are rejected; unknown desks 404.
    for (const bad of [
      { code, step: "typing" },
      { code, step: "services", language: "XX" },
      { code, step: "review", serviceIndex: 20 },
      { code, step: "review", note: "passport M1234567" },
    ]) expect((await postLive(post("/api/intake/live", bad))).status).toBe(400);
    expect((await postLive(post("/api/intake/live", { code: "ABCDEFGHJK", step: "language" }))).status).toBe(404);
    expect((await postLive(new Request(HOST + "/api/intake/live", {
      method: "POST", headers: { origin: "https://other.example", "content-type": "application/json" },
      body: JSON.stringify({ code, step: "language" }),
    }))).status).toBe(403);
  });

  it("refuses invalid input, incorrect origin and unrelated free text", async () => {
    __setIntakeStore(createMemoryIntakeStore());
    const created = await createSession(post("/api/intake/session", {}));
    const { code } = await created.json() as { code: string };
    const invalid = await submit(post("/api/intake/submission", {
      code, requestId: crypto.randomUUID(), language: "EN", serviceIndex: 55,
      booking: "yes", passportNumber: "M1234567",
    }));
    expect(invalid.status).toBe(400);
    const blocked = await submit(new Request(HOST + "/api/intake/submission", {
      method: "POST", headers: { origin: "https://other.example", "content-type": "application/json" },
      body: JSON.stringify({
        code, requestId: crypto.randomUUID(), language: "EN", serviceIndex: 3, booking: "no",
      }),
    }));
    expect(blocked.status).toBe(403);
  });

  it("lets only the staff desk show or clear a fixed phrase on the visitor screen", async () => {
    // Created directly in the store: the session-create route is rate-limited across this file.
    const store = createMemoryIntakeStore();
    __setIntakeStore(store);
    const { session: { code }, staffToken } = await store.create();
    const visitor = () => readNotice(new Request(HOST + "/api/intake/notice?code=" + code));
    const send = (body: object, token: string | null = staffToken) => postNotice(new Request(HOST + "/api/intake/notice", {
      method: "POST",
      headers: token ? { ...headers, "x-asad-intake-staff-token": token } : headers,
      body: JSON.stringify(body),
    }));
    expect(await (await visitor()).json()).toEqual({ notice: null, seq: 0 });

    expect((await send({ code, id: "ticket" }, null)).status).toBe(401);
    expect((await send({ code, id: "ticket" }, "x".repeat(43))).status).toBe(403);
    for (const bad of [
      { code, id: "counter" },
      { code, id: "ticket", counter: 3 },
      { code, id: "counter", counter: 31 },
      { code, id: "hello" },
      { code, id: "ticket", text: "free text" },
    ]) expect((await send(bad)).status).toBe(400);

    expect((await send({ code, id: "counter", counter: 3 })).status).toBe(200);
    const shown = await (await visitor()).json() as { notice: Record<string, unknown>; seq: number };
    expect(shown.notice).toMatchObject({ id: "counter", counter: 3, n: 1 });
    expect(shown.seq).toBe(1);
    const desk = await readSession(staff("/api/intake/session?code=" + code, staffToken));
    expect((await desk.json() as { notice: { id: string } }).notice.id).toBe("counter");

    // Repeating the same phrase is a new event so a dismissed screen shows it again.
    await send({ code, id: "counter", counter: 3 });
    expect((await (await visitor()).json() as { seq: number }).seq).toBe(2);
    expect((await send({ code, id: null })).status).toBe(200);
    expect(await (await visitor()).json()).toEqual({ notice: null, seq: 3 });

    expect((await readNotice(new Request(HOST + "/api/intake/notice?code=ABCDEFGHJK"))).status).toBe(404);
    expect((await readNotice(new Request(HOST + "/api/intake/notice?code=bad"))).status).toBe(400);
  });
});
