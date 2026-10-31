import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mailer, type Mail } from "../../src/lib/mailer";
import { prisma } from "../../src/lib/prisma";
import { auth, newApi, setupWorld } from "./helpers";

let api: ReturnType<typeof newApi>;
let sent: Mail[];

beforeEach(async () => {
  await setupWorld();
  api = newApi();
  sent = [];
  spyOn(mailer, "send").mockImplementation(async (mail) => {
    sent.push(mail);
  });
});

afterEach(() => {
  (mailer.send as unknown as { mockRestore: () => void }).mockRestore();
});

const codeFrom = (mail: Mail | undefined) => mail!.text.match(/\b(\d{6})\b/)![1]!;

async function requestCode(email: string) {
  const res = await api.post("/auth/request-code").send({ email });
  expect(res.status).toBe(202);
  return codeFrom(sent.at(-1));
}

describe("magic code login", () => {
  test("code logs in once and gives a working session", async () => {
    const code = await requestCode("staff@test.in");
    const ok = await api.post("/auth/verify").send({ email: "STAFF@test.in", code });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe("STAFF");

    const me = await api.get("/auth/me").set(auth(ok.body.token));
    expect(me.body.email).toBe("staff@test.in");

    const reuse = await api.post("/auth/verify").send({ email: "staff@test.in", code });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe("INVALID_CODE");
  });

  test("code is never stored in plain text", async () => {
    const code = await requestCode("staff@test.in");
    const row = await prisma.loginCode.findFirstOrThrow({ where: { email: "staff@test.in" } });
    expect(row.codeHash).not.toContain(code);
  });

  test("unknown email gets the same response and no mail", async () => {
    const res = await api.post("/auth/request-code").send({ email: "nobody@test.in" });
    expect(res.status).toBe(202);
    expect(sent).toHaveLength(0);
  });

  test("expired code is rejected", async () => {
    const code = await requestCode("staff@test.in");
    await prisma.loginCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await api.post("/auth/verify").send({ email: "staff@test.in", code });
    expect(res.status).toBe(400);
  });

  test("five wrong attempts kill the code, even for the right value", async () => {
    const code = await requestCode("staff@test.in");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      expect((await api.post("/auth/verify").send({ email: "staff@test.in", code: wrong })).status).toBe(400);
    }
    const res = await api.post("/auth/verify").send({ email: "staff@test.in", code });
    expect(res.status).toBe(400);
  });

  test("parallel wrong guesses cannot exceed the attempt limit", async () => {
    await requestCode("staff@test.in");
    await Promise.all(
      Array.from({ length: 12 }, () => api.post("/auth/verify").send({ email: "staff@test.in", code: "999999" })),
    );
    const row = await prisma.loginCode.findFirstOrThrow({ where: { email: "staff@test.in", usedAt: null } });
    expect(row.attempts).toBe(5);
  });

  test("a new code invalidates the previous one", async () => {
    const first = await requestCode("staff@test.in");
    const second = await requestCode("staff@test.in");
    if (first !== second) {
      expect((await api.post("/auth/verify").send({ email: "staff@test.in", code: first })).status).toBe(400);
    }
    expect((await api.post("/auth/verify").send({ email: "staff@test.in", code: second })).status).toBe(200);
  });

  test("code requests are rate limited per email", async () => {
    for (let i = 0; i < 3; i++) await requestCode("staff@test.in");
    const res = await api.post("/auth/request-code").send({ email: "staff@test.in" });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
    expect((await api.post("/auth/request-code").send({ email: "manager@test.in" })).status).toBe(202);
  });

  test("code requests are rate limited per IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await api.post("/auth/request-code").send({ email: `user${i}@test.in` })).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 202)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  test("deactivated user loses access", async () => {
    const code = await requestCode("staff@test.in");
    const { body } = await api.post("/auth/verify").send({ email: "staff@test.in", code });
    await prisma.user.update({ where: { email: "staff@test.in" }, data: { active: false } });
    expect((await api.get("/auth/me").set(auth(body.token))).status).toBe(401);
  });

  test("logout ends the session", async () => {
    const code = await requestCode("staff@test.in");
    const { body } = await api.post("/auth/verify").send({ email: "staff@test.in", code });
    expect((await api.post("/auth/logout").set(auth(body.token))).status).toBe(204);
    expect((await api.get("/auth/me").set(auth(body.token))).status).toBe(401);
  });
});
