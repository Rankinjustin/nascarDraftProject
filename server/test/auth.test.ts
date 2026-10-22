import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/passwords";
import { issueSetupLink } from "../src/auth/setupTokens";
import { env } from "../src/env";
import { call, hasTestDb, makeUser, prisma, resetDb, startServer, stopServer, type ApiResponse } from "./helpers";

describe.skipIf(!hasTestDb)("auth (integration)", () => {
  beforeAll(startServer);
  afterAll(stopServer);
  beforeEach(resetDb);

  // Logins come from their own client address unless a test says otherwise, so the per-IP limit (which lasts for the
  // whole file) only trips in the test that's about it.
  let address = 0;
  const login = (phoneNumber: string, password: string, from = `203.0.113.${(address += 1)}`) =>
    call(null, "POST", "/auth/login", { phoneNumber, password }, { "X-Forwarded-For": from });

  const sessionCookie = (res: ApiResponse) =>
    res.headers.getSetCookie().find((c) => c.startsWith(`${env.SESSION_COOKIE_NAME}=`));
  const cookieValue = (res: ApiResponse) => sessionCookie(res)!.split(";")[0]!;

  /** A member who has set a password. Their phone number is +1555010xxxx. */
  async function member(password = "correct horse") {
    const { user, cookie } = await makeUser();
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
    return { user, cookie, password };
  }
  const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;

  it("logs in however the number is written, with an HttpOnly, SameSite=Lax session cookie that works", async () => {
    const { user, password } = await member();
    const digits = user.phoneNumber.slice(2); // "+15550100001" → "5550100001"
    const written = [
      `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
      `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`,
      `+1-${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`,
      digits,
    ];
    for (const phoneNumber of written) {
      const res = await login(phoneNumber, password);
      expect(res.status, phoneNumber).toBe(200);
      expect(res.body.id).toBe(user.id);
    }

    const res = await login(digits, password);
    expect(sessionCookie(res)).toMatch(/HttpOnly/i);
    expect(sessionCookie(res)).toMatch(/SameSite=Lax/i);
    expect(sessionCookie(res)).toMatch(/Path=\//i);
    expect((await call(cookieValue(res), "GET", "/auth/me")).body.id).toBe(user.id);
  });

  it("a wrong password, an unknown number, a member with no password yet, and an inactive one all get the same 401", async () => {
    const { user, password } = await member();
    const { user: noPassword } = await makeUser();
    const { user: inactive } = await member();
    await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });

    const refusals = [
      await login(user.phoneNumber, "wrong password"),
      await login("+15559990000", password),
      await login(noPassword.phoneNumber, password),
      await login(inactive.phoneNumber, password),
    ];
    for (const res of refusals) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(refusals[0]!.body);
      expect(sessionCookie(res)).toBeUndefined();
    }
    expect(refusals[0]!.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("deactivating a member ends their sessions at once", async () => {
    const commish = await makeUser("COMMISSIONER");
    const { user, cookie } = await member();
    expect((await call(cookie, "GET", "/auth/me")).status).toBe(200);

    expect((await call(commish.cookie, "PATCH", `/users/${user.id}`, { isActive: false })).status).toBe(200);
    expect((await call(cookie, "GET", "/auth/me")).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("logout ends the session", async () => {
    const { user, password } = await member();
    const cookie = cookieValue(await login(user.phoneNumber, password));
    expect((await call(cookie, "POST", "/auth/logout")).status).toBe(204);
    expect((await call(cookie, "GET", "/auth/me")).status).toBe(401);
  });

  it("a setup link sets the password once, ends every other session, and signs in", async () => {
    const { user, cookie: oldSession } = await makeUser();
    const token = tokenOf(await issueSetupLink(user.id));

    const res = await call(null, "POST", "/auth/set-password", { token, password: "a new password" });
    expect(res.status).toBe(200);
    expect((await call(oldSession, "GET", "/auth/me")).status).toBe(401);
    expect((await call(cookieValue(res), "GET", "/auth/me")).body.id).toBe(user.id);
    expect((await login(user.phoneNumber, "a new password")).status).toBe(200);

    const again = await call(null, "POST", "/auth/set-password", { token, password: "another password" });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("INVALID_TOKEN");
  });

  it("a newer link replaces the older one; expired links and short passwords are refused", async () => {
    const { user } = await makeUser();
    const older = tokenOf(await issueSetupLink(user.id));
    const newer = tokenOf(await issueSetupLink(user.id));
    expect((await call(null, "POST", "/auth/set-password", { token: older, password: "a new password" })).body.code).toBe("INVALID_TOKEN");

    const short = await call(null, "POST", "/auth/set-password", { token: newer, password: "short" });
    expect(short.status).toBe(400);
    expect(short.body.code).toBe("VALIDATION_ERROR");

    await prisma.setupToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call(null, "POST", "/auth/set-password", { token: newer, password: "a new password" })).body.code).toBe("INVALID_TOKEN");
  });

  it("login rate limit: 10 tries per number, and 10 per client address, with each address behind the proxy its own bucket", async () => {
    const { user, password } = await member();
    for (let i = 0; i < 10; i++) expect((await login(user.phoneNumber, "wrong password")).status).toBe(401);
    // From a fresh address, with the right password: the number itself is locked for the window.
    const locked = await login(user.phoneNumber, password);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("RATE_LIMITED");

    const busy = "198.51.100.7";
    for (let i = 0; i < 10; i++) expect((await login(`+1555777${String(i).padStart(4, "0")}`, password, busy)).status).toBe(401);
    expect((await login("+15557779999", password, busy)).status).toBe(429);
    expect((await login("+15557779999", password, "198.51.100.8")).status).toBe(401);
  });
});
