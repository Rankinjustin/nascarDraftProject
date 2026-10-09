import type { PushSubscriptionInput } from "@dnd/shared";
import { prisma } from "../db";
import { conflict, HttpError } from "../errors";
import { pushToUser, webPushConfigured } from "../notifications/webPush";

/** Upsert on endpoint: a new login on the same device moves the row to the new user. */
export async function subscribe(userId: string, { endpoint, keys }: PushSubscriptionInput, userAgent: string | null): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    update: { userId, p256dh: keys.p256dh, auth: keys.auth, userAgent },
  });
}

export async function unsubscribe(userId: string, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
}

/** Sends a push to the user's own devices, bypassing the ledger. Essential for debugging iOS. Returns devices reached. */
export async function sendTestPush(userId: string): Promise<number> {
  if (!webPushConfigured) throw new HttpError(503, "PUSH_NOT_CONFIGURED", "Push isn't set up on the server yet.");
  try {
    return await pushToUser(userId, {
      title: "Test notification",
      body: "Push works on this device. You'll get a ping like this when you're on the clock.",
      url: "/settings",
      tag: "test",
    });
  } catch (err) {
    throw conflict("PUSH_FAILED", err instanceof Error ? err.message : "Push failed.");
  }
}
