import type { Prisma, User } from "@prisma/client";
import type { CookieOptions, RequestHandler, Response } from "express";
import { prisma } from "../db";
import { env, isProduction } from "../env";
import { forbidden, unauthenticated } from "../errors";
import { hashToken, newToken } from "./tokens";

const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_MS = SESSION_DAYS * DAY_MS;

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax",
  path: "/",
};

type Db = Prisma.TransactionClient | typeof prisma;

export async function createSession(res: Response, userId: string, db: Db = prisma): Promise<void> {
  const token = newToken();
  await db.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + SESSION_MS) },
  });
  res.cookie(env.SESSION_COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(env.SESSION_COOKIE_NAME, cookieOptions);
}

/** Attaches req.user when a valid session cookie is present. Never rejects on its own. */
export const loadSession: RequestHandler = async (req, res, next) => {
  const token: unknown = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (typeof token !== "string" || token.length === 0) return next();

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  const now = Date.now();
  if (!session || session.expiresAt.getTime() <= now || !session.user.isActive) {
    clearSessionCookie(res);
    return next();
  }

  // Sliding renewal, written at most once a day so draft-room polling doesn't write on every request.
  if (session.expiresAt.getTime() < now + SESSION_MS - DAY_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(now + SESSION_MS) } });
    res.cookie(env.SESSION_COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_MS });
  }

  req.user = session.user;
  req.sessionId = session.id;
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw unauthenticated();
  next();
};

export const requireCommissioner: RequestHandler = (req, _res, next) => {
  if (!req.user) throw unauthenticated();
  if (req.user.role !== "COMMISSIONER") throw forbidden();
  next();
};

/** For handlers behind requireAuth. */
export function currentUser(req: { user?: User }): User {
  if (!req.user) throw unauthenticated();
  return req.user;
}
