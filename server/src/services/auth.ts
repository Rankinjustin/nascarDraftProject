import type { PublicUser } from "@dnd/shared";
import { hashPassword } from "../auth/passwords";
import { authProvider } from "../auth/provider";
import { toPublicUser } from "../auth/publicUser";
import { newSession } from "../auth/sessions";
import { hashToken } from "../auth/tokens";
import { prisma } from "../db";
import { HttpError } from "../errors";

/** The user, and the new session's token for the cookie. */
export interface SignedIn {
  user: PublicUser;
  token: string;
}

export async function logIn(credentials: unknown): Promise<SignedIn> {
  const user = await authProvider.verify(credentials);
  if (!user) throw new HttpError(401, "INVALID_CREDENTIALS", "Wrong phone number or password.");
  return { user: toPublicUser(user), token: await newSession(user.id) };
}

export async function logOut(sessionId: string | undefined): Promise<void> {
  if (sessionId) await prisma.session.deleteMany({ where: { id: sessionId } });
}

/** Consumes a setup link: sets the password, ends every existing session, and opens a new one. */
export async function setPassword(token: string, password: string): Promise<SignedIn> {
  const invalid = new HttpError(
    400,
    "INVALID_TOKEN",
    "This setup link is invalid or has expired. Ask the commissioner for a new one.",
  );

  const setup = await prisma.setupToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!setup || setup.usedAt || setup.expiresAt <= new Date() || !setup.user.isActive) throw invalid;

  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    // Conditional update so two simultaneous submits can't both consume the token.
    const consumed = await tx.setupToken.updateMany({
      where: { id: setup.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 0) throw invalid;
    const user = await tx.user.update({ where: { id: setup.userId }, data: { passwordHash } });
    // A reset must actually lock out whoever had the old password.
    await tx.session.deleteMany({ where: { userId: setup.userId } });
    return { user: toPublicUser(user), token: await newSession(setup.userId, tx) };
  });
}
