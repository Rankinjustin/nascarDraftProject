import { Router } from "express";
import { z } from "zod";
import { currentUser, requireAuth } from "../auth/sessions";
import { sendTestPush, subscribe, unsubscribe } from "../services/notifications";

export const notificationsRouter = Router();

const subscription = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) }),
});

notificationsRouter.post("/subscribe", requireAuth, async (req, res) => {
  const userAgent = req.get("user-agent")?.slice(0, 300) ?? null;
  await subscribe(currentUser(req).id, subscription.parse(req.body), userAgent);
  res.status(204).end();
});

notificationsRouter.delete("/subscribe", requireAuth, async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.url().max(1000) }).parse(req.body);
  await unsubscribe(currentUser(req).id, endpoint);
  res.status(204).end();
});

notificationsRouter.post("/test", requireAuth, async (req, res) => {
  res.json({ devices: await sendTestPush(currentUser(req).id) });
});
