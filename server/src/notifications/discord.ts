import { prisma } from "../db";
import { env } from "../env";
import { BROADCAST_KINDS, TURN_KINDS, type NotificationChannel } from "./types";

/**
 * One unauthenticated POST per message. Broadcast kinds post a plain message; turn kinds mention the
 * person on the clock (or name them, when they have no discordUserId). Commissioner-only kinds aren't posted.
 */
export const discordChannel: NotificationChannel = {
  key: "discord",
  broadcastAsOne: true,
  async canReach(payload) {
    if (!env.DISCORD_WEBHOOK_URL) return false;
    return payload.userId === null ? BROADCAST_KINDS.includes(payload.kind) : TURN_KINDS.includes(payload.kind);
  },
  async send(payload) {
    const link = `${env.FRONTEND_ORIGIN}${payload.url}`;
    let content = `**${payload.title}** — ${payload.body}\n${link}`;
    let mentions: string[] = [];
    if (payload.userId) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.userId } });
      const who = user.discordUserId ? `<@${user.discordUserId}>` : `**${user.displayName}**`;
      if (user.discordUserId) mentions = [user.discordUserId];
      content = `${who} ${payload.body}\n${link}`;
    }

    const res = await fetch(env.DISCORD_WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { users: mentions } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Discord webhook returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  },
};
