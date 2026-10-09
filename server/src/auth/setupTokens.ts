import { prisma, type Db } from "../db";
import { env } from "../env";
import { hashToken, newToken } from "./tokens";

const SETUP_TOKEN_DAYS = 7;

/** Issues a single-use setup/reset link. Any outstanding links for this user stop working. */
export async function issueSetupLink(userId: string, db: Db = prisma): Promise<string> {
  const token = newToken();
  await db.setupToken.deleteMany({ where: { userId, usedAt: null } });
  await db.setupToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SETUP_TOKEN_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return `${env.FRONTEND_ORIGIN}/setup?token=${token}`;
}
