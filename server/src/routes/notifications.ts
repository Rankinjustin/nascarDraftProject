import { Router } from "express";
import { z } from "zod";
import { currentUser, requireAuth } from "../auth/sessions";
import { prisma } from "../db";
import { HttpError } from "../errors";
import { pushToUser, webPushConfigured } from "../notifications/webPush";

export const notificationsRouter = Router();

const subscription = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) }),
});

// Upsert on endpoint: a new login on the same device moves the row to the new user.
notificationsRouter.post("/subscribe", requireAuth, async (req, res) => {
  const { endpoint, keys } = subscription.parse(req.body);
  const userId = currentUser(req).id;
  const userAgent = req.get("user-agent")?.slice(0, 300) ?? null;
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    update: { userId, p256dh: keys.p256dh, auth: keys.auth, userAgent },
  });
  res.status(204).end();
});

notificationsRouter.delete("/subscribe", requireAuth, async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.url().max(1000) }).parse(req.body);
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: currentUser(req).id } });
  res.status(204).end();
});

/** Sends a push to the caller's own devices, bypassing the ledger. Essential for debugging iOS. */
notificationsRouter.post("/test", requireAuth, async (req, res) => {
  if (!webPushConfigured) throw new HttpError(503, "PUSH_NOT_CONFIGURED", "Push isn't set up on the server yet.");
  try {
    const devices = await pushToUser(currentUser(req).id, {
      title: "Test notification",
      body: "Push works on this device. You'll get a ping like this when you're on the clock.",
      url: "/settings",
      tag: "test",
    });
    res.json({ devices });
  } catch (err) {
    throw new HttpError(409, "PUSH_FAILED", err instanceof Error ? err.message : "Push failed.");
  }
});
