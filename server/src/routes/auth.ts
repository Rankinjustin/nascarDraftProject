import { Router } from "express";
import { z } from "zod";
import { authProvider } from "../auth/provider";
import { hashPassword } from "../auth/passwords";
import { toPublicUser } from "../auth/publicUser";
import { clearSessionCookie, createSession, currentUser, requireAuth } from "../auth/sessions";
import { hashToken } from "../auth/tokens";
import { prisma } from "../db";
import { HttpError } from "../errors";
import { loginLimitByIp, loginLimitByPhone } from "../middleware/rateLimits";

export const authRouter = Router();

authRouter.post("/login", loginLimitByIp, loginLimitByPhone, async (req, res) => {
  const user = await authProvider.verify(req.body);
  if (!user) throw new HttpError(401, "INVALID_CREDENTIALS", "Wrong phone number or password.");
  await createSession(res, user.id);
  res.json(toPublicUser(user));
});

authRouter.post("/logout", async (req, res) => {
  if (req.sessionId) await prisma.session.deleteMany({ where: { id: req.sessionId } });
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json(toPublicUser(currentUser(req)));
});

const setPasswordBody = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
});

authRouter.post("/set-password", async (req, res) => {
  const { token, password } = setPasswordBody.parse(req.body);
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
  const user = await prisma.$transaction(async (tx) => {
    // Conditional update so two simultaneous submits can't both consume the token.
    const consumed = await tx.setupToken.updateMany({
      where: { id: setup.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 0) throw invalid;
    const updated = await tx.user.update({ where: { id: setup.userId }, data: { passwordHash } });
    // A reset must actually lock out whoever had the old password.
    await tx.session.deleteMany({ where: { userId: setup.userId } });
    await createSession(res, setup.userId, tx);
    return updated;
  });

  res.json(toPublicUser(user));
});
