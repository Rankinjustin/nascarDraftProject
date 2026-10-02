import webpush from "web-push";
import { prisma } from "../db";
import { env } from "../env";
import type { NotificationChannel, NotificationPayload } from "./types";

export const webPushConfigured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
if (webPushConfigured) webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Sends to every device the user has subscribed. Dead subscriptions (404/410) are deleted; they expire routinely.
 * Resolves with the number of devices reached and throws if none were.
 */
export async function pushToUser(userId: string, message: { title: string; body: string; url: string; tag?: string }) {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) throw new Error("No push subscriptions for this user.");

  let reached = 0;
  let lastError: unknown;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(message),
        { TTL: DAY_SECONDS },
      );
      reached += 1;
      await prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastUsedAt: new Date() } });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
      } else {
        lastError = err;
      }
    }
  }
  if (reached === 0) {
    throw lastError instanceof Error ? lastError : new Error("Every push subscription for this user has expired.");
  }
  return reached;
}

export const webPushChannel: NotificationChannel = {
  key: "web_push",
  broadcastAsOne: false,
  async canReach(payload: NotificationPayload) {
    if (!payload.userId) return false;
    return (await prisma.pushSubscription.count({ where: { userId: payload.userId } })) > 0;
  },
  async send(payload) {
    await pushToUser(payload.userId!, {
      title: payload.title,
      body: payload.body,
      url: payload.url,
      // Same tag replaces an older notification for the same race and kind on the lock screen.
      tag: `${payload.raceId}:${payload.kind}`,
    });
  },
};
