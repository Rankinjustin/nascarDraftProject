import { Router } from "express";
import { z } from "zod";
import { toPublicUser } from "../auth/publicUser";
import { clearSessionCookie, currentUser, requireAuth, setSessionCookie } from "../auth/sessions";
import { loginLimitByIp, loginLimitByPhone } from "../middleware/rateLimits";
import { logIn, logOut, setPassword } from "../services/auth";

export const authRouter = Router();

// The body is validated by the AuthProvider, which owns the credential shape.
authRouter.post("/login", loginLimitByIp, loginLimitByPhone, async (req, res) => {
  const { user, token } = await logIn(req.body);
  setSessionCookie(res, token);
  res.json(user);
});

authRouter.post("/logout", async (req, res) => {
  await logOut(req.sessionId);
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
  const signedIn = await setPassword(token, password);
  setSessionCookie(res, signedIn.token);
  res.json(signedIn.user);
});
