import type { Race, Role } from "@prisma/client";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app";
import { hashToken, newToken } from "../src/auth/tokens";
import { prisma } from "../src/db";
import { env } from "../src/env";
import type { ChannelKey, NotificationChannel, NotificationPayload } from "../src/notifications/types";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
export { prisma };

let server: Server | undefined;
let baseUrl = "";

export async function startServer(): Promise<void> {
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}

export async function stopServer(): Promise<void> {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
}

/** Empties every table between tests. */
export async function resetDb(): Promise<void> {
  const dbName = new URL(env.DATABASE_URL).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to truncate "${dbName}": not a _test database.`);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

let phoneCounter = 0;

/** A user with a live session; returns the cookie to send. */
export async function makeUser(role: Role = "MEMBER", displayName = `User ${phoneCounter + 1}`) {
  phoneCounter += 1;
  const user = await prisma.user.create({
    data: { phoneNumber: `+1555010${String(phoneCounter).padStart(4, "0")}`, displayName, role },
  });
  const token = newToken();
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86_400_000) },
  });
  return { user, cookie: `${env.SESSION_COOKIE_NAME}=${token}` };
}

export async function makeSeason() {
  return prisma.season.create({ data: { year: 2026, name: "2026 Test Season", isCurrent: true } });
}

const DAY = 86_400_000;

/** Test fixture setup may write status directly; app code never does. */
export async function makeRace(seasonId: string, data: Partial<Race> = {}) {
  return prisma.race.create({
    data: {
      seasonId,
      raceName: "Test 400",
      trackName: "Test Speedway",
      raceDate: new Date(Date.now() + 3 * DAY),
      ...data,
    },
  });
}

export async function makeDrivers(count: number) {
  const drivers = [];
  for (let i = 1; i <= count; i++) {
    drivers.push(await prisma.driver.create({ data: { driverName: `Driver ${i}`, carNumber: String(i) } }));
  }
  return drivers;
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

export async function call<T = any>(
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<ApiResponse<T>> {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      ...extraHeaders,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method === "GET" ? {} : { "Content-Type": "application/json", Origin: env.FRONTEND_ORIGIN }),
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

export interface FakeChannel extends NotificationChannel {
  sent: NotificationPayload[];
  attempts: NotificationPayload[];
  failUsers: Set<string | null>;
  delayMs: number;
}

export function fakeChannel(key: ChannelKey = "web_push", broadcastAsOne = false): FakeChannel {
  const channel: FakeChannel = {
    key,
    broadcastAsOne,
    sent: [],
    attempts: [],
    failUsers: new Set(),
    delayMs: 0,
    async canReach(p) {
      return broadcastAsOne || p.userId !== null;
    },
    async send(p) {
      channel.attempts.push(p);
      if (channel.delayMs) await new Promise((r) => setTimeout(r, channel.delayMs));
      if (channel.failUsers.has(p.userId)) throw new Error("push service said no");
      channel.sent.push(p);
    },
  };
  return channel;
}

export const ofKind = (list: NotificationPayload[], kind: string) => list.filter((p) => p.kind === kind);
